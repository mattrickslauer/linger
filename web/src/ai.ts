// The four AI Logic calls, with routing recorded so the UI can say which model ran.

import { InferenceSource, type InlineDataPart } from "firebase/ai";
import { cloudModel, judgeModel, liveCheckModel, promptModel, prompts, scorerModel, skepticModel, type V3Prompt } from "./firebase";
import { fmtDistance, fmtDuration } from "./geo";
import { fill, parseJson, pickFrames } from "./ai-util";
import type { AiOpinion, CheckMode, LiveCheck, Moment, Summary, Verdict, VerificationScore } from "./types";
import { judgeClaims, type Claim } from "./v4";


function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`timeout after ${ms} ms`)), ms)));
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const jpegPart = (b64: string): InlineDataPart => ({ type: "inlineData", inlineData: { data: b64, mimeType: "image/jpeg" } });

/**
 * On-device coach. Never verifies: "keep going" or "retake: <reason>". If no model can answer
 * (offline and no Nano), the frame is kept with mode "none" so recording never blocks.
 */
export async function liveCheck(intention: string, jpegB64: string): Promise<LiveCheck & { ms: number }> {
  const t0 = performance.now();
  try {
    const text =
      prompts.liveCheck.system +
      "\n\n" +
      fill(prompts.liveCheck.user, { intention, frame: "(the attached image)" }) +
      '\nReply as JSON: {"ok": boolean, "reason": string, "label": string}';
    const res = await withTimeout(liveCheckModel().generateContent([text, jpegPart(jpegB64)], { timeout: 20_000 }), 25_000);
    const j = parseJson<LiveCheck>(res.response.text());
    const mode: CheckMode = res.response.inferenceSource === InferenceSource.ON_DEVICE ? "on_device" : "cloud";
    const ok = j.ok !== false;
    return {
      ok,
      reason: String(j.reason ?? (ok ? "keep going" : "retake")).slice(0, 80),
      label: String(j.label ?? "").slice(0, 40),
      mode,
      ms: performance.now() - t0,
    };
  } catch (e) {
    console.warn("live check unavailable", e);
    return { ok: true, reason: "coach unavailable", label: "", mode: "none", ms: performance.now() - t0 };
  }
}

export function summaryText(s: Summary): string {
  return `duration ${fmtDuration(s.durationMs)}, distance ${fmtDistance(s.distanceM)}, ${s.gpsCount} GPS fixes, ${s.motionCount} motion samples, ${s.frameCount} proof frames`;
}

async function opinion(which: "judge" | "skeptic", m: Moment, frames: { t: number; jpegB64: string }[], claims: Claim[] = []): Promise<AiOpinion> {
  const model = which === "judge" ? judgeModel() : skepticModel();
  const p = prompts[which];
  const shape =
    which === "judge"
      ? '\nReply as JSON: {"verdict": "consistent"|"inconsistent"|"uncertain", "confidence": 0..1, "reasons": string[], "claims": [{"id": string, "verdict": "backed"|"not_backed"|"unclear", "confidence": 0..1}]}'
      : '\nReply as JSON: {"verdict": "consistent"|"inconsistent"|"uncertain", "confidence": 0..1, "reasons": string[]}';
  const text = fill(p.user, { ...promptValues(m, frames), claims: JSON.stringify(claims) }) + shape;
  const res = await withTimeout(model.generateContent([text, ...frames.map((f) => jpegPart(f.jpegB64))], { timeout: 60_000 }), 65_000);
  const j = parseJson<AiOpinion>(res.response.text());
  const verdict: Verdict = j.verdict === "consistent" || j.verdict === "inconsistent" ? j.verdict : "uncertain";
  const out: AiOpinion = {
    verdict,
    confidence: Math.max(0, Math.min(1, Number(j.confidence ?? 0))),
    reasons: (Array.isArray(j.reasons) ? j.reasons : []).map(String).slice(0, 4),
    model: cloudModel(),
    ranAt: Date.now(),
  };
  if (which === "judge") out.claims = judgeClaims(j.claims, claims);
  return out;
}

/** The judges see the structured claim too (goal, numbers, place) when the interview produced one. */
export function intentionForPrompt(i: Moment["intention"]): string {
  if (!i.v) return i.text;
  const bits = [i.text];
  if (i.goal) bits.push(`goal: ${i.goal}`);
  if (i.quantities?.length) bits.push("numbers: " + i.quantities.map((q) => `${q.metric} ${q.value} ${q.unit} (by ${q.measuredBy})`).join(", "));
  if (i.place?.name) bits.push(`place: ${[i.place.name, i.place.region, i.place.country].filter(Boolean).join(", ")}`);
  if (i.conditions?.length) bits.push(`conditions: ${i.conditions.join(", ")}`);
  return bits.join("; ");
}

function promptValues(m: Moment, frames: { t: number }[]) {
  return {
    intention: intentionForPrompt(m.intention),
    category: m.intention.category,
    summary: m.summary ? summaryText(m.summary) : "unavailable",
    frameOffsets: frames.map((f) => Math.round((f.t - m.startedAt) / 1000) + "s").join(", ") || "none",
  };
}

/** The scorer: probability the claim is true given the evidence, starting from a cheater-heavy prior. */
async function score(m: Moment, frames: { t: number; jpegB64: string }[]): Promise<VerificationScore> {
  const text = fill(prompts.scorer.user, promptValues(m, frames)) + '\nReply as JSON: {"probability": 0..1, "reasons": string[]}';
  const res = await withTimeout(scorerModel().generateContent([text, ...frames.map((f) => jpegPart(f.jpegB64))], { timeout: 60_000 }), 65_000);
  const j = parseJson<{ probability?: unknown; reasons?: unknown }>(res.response.text());
  const p = Number(j.probability);
  return {
    // A missing or garbled number is treated as "no evidence moved the prior": 0, so the seal fails closed.
    probability: Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0,
    reasons: (Array.isArray(j.reasons) ? j.reasons : []).map(String).slice(0, 4),
    model: cloudModel(),
    ranAt: Date.now(),
  };
}

/**
 * Judge, skeptic and scorer in parallel over the same frames. All three or nothing. v4: the judge also rules on each
 * server claim (`claims` = moments/{id}.claims.items, [] when none arrived within 30 s).
 */
export async function cloudReview(m: Moment, frames: { seq: number; t: number; jpegB64: string }[], claims: Claim[] = []) {
  const chosen = pickFrames(frames, m.summary?.heroFrameSeq ?? null);
  const [judge, skeptic, verification] = await Promise.all([opinion("judge", m, chosen, claims), opinion("skeptic", m, chosen), score(m, chosen)]);
  return { judge, skeptic, score: verification };
}

// ---------------------------------------------------------------- v3: interview, bar preview, witness

export type Route = "on_device" | "cloud";

/** One hybrid JSON call for a v3 prompt; returns which side answered so the UI can show it. */
export async function askJson<T>(name: V3Prompt, vars: Record<string, string>, images: string[] = [], ms = 30_000): Promise<{ json: Partial<T>; mode: Route; ms: number }> {
  const p = prompts[name] as { system: string; user: string };
  const t0 = performance.now();
  const text = p.system + "\n\n" + fill(p.user, vars) + "\nReply with JSON only.";
  const res = await withTimeout(promptModel(name).generateContent([text, ...images.map(jpegPart)], { timeout: ms }), ms + 2000);
  const mode: Route = res.response.inferenceSource === InferenceSource.ON_DEVICE ? "on_device" : "cloud";
  return { json: parseJson<T>(res.response.text()), mode, ms: performance.now() - t0 };
}

export interface TurnOut {
  say: string;
  done: boolean;
  draft: Record<string, unknown>;
  missing: string[];
}

/** Interviewer turn (PREFER_ON_DEVICE): next spoken question, or the confirmation when done. */
export async function interviewTurn(context: object, draft: object, transcript: string) {
  const r = await askJson<TurnOut>("interviewTurn", { context: JSON.stringify(context), draft: JSON.stringify(draft), transcript }, [], 20_000);
  return {
    say: String(r.json.say ?? "").slice(0, 160),
    done: r.json.done === true,
    draft: (r.json.draft && typeof r.json.draft === "object" ? r.json.draft : draft) as Record<string, unknown>,
    mode: r.mode,
  };
}

/** Final structuring (ONLY_IN_CLOUD). */
export async function structureIntention(context: object, transcript: string, draft: object, ms = 20_000) {
  const r = await askJson<Record<string, unknown>>(
    "structureIntention",
    { context: JSON.stringify(context), transcript, draft: JSON.stringify(draft) },
    [],
    ms,
  );
  return { fields: r.json as Record<string, unknown>, mode: r.mode };
}

/** Bar preview (PREFER_ON_DEVICE). The binding bar comes from the Cloud Function at submit. */
export async function barPreview(intention: object, context: object) {
  const r = await askJson<{ difficulty: number; rationale: string; factors: string[] }>(
    "barPreview",
    { intention: JSON.stringify(intention), context: JSON.stringify(context) },
    [],
    15_000,
  );
  const d = Number(r.json.difficulty);
  return {
    difficulty: Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : 0,
    rationale: String(r.json.rationale ?? "").slice(0, 160),
    factors: (Array.isArray(r.json.factors) ? r.json.factors : []).map(String).slice(0, 4),
    mode: r.mode,
  };
}

export interface WitnessAsk {
  ask: string;
  kind: "show" | "tell" | "do";
  why: string;
  gain: number;
}
const toAsk = (j: Partial<WitnessAsk>): WitnessAsk => ({
  ask: String(j.ask ?? "").trim().slice(0, 100),
  kind: j.kind === "tell" || j.kind === "do" ? j.kind : "show",
  why: String(j.why ?? "").slice(0, 100),
  gain: Math.max(0, Math.min(1, Number(j.gain) || 0)),
});

/** Witness draft (PREFER_ON_DEVICE). */
export async function witnessDraft(intention: string, session: string, asked: string) {
  const r = await askJson<WitnessAsk>("witnessDraft", { intention, session, asked }, [], 15_000);
  return { ...toAsk(r.json), mode: r.mode };
}

/** Witness refine (ONLY_IN_CLOUD) over the latest frames. Callers give it a 4 s budget. */
export async function witnessRefine(intention: string, session: string, asked: string, draft: WitnessAsk, frames: { t: number; jpegB64: string }[], startedAt: number) {
  const r = await askJson<WitnessAsk>(
    "witnessRefine",
    {
      intention,
      session,
      asked,
      draft: JSON.stringify(draft),
      frameOffsets: frames.map((f) => Math.round((f.t - startedAt) / 1000) + "s").join(", ") || "none",
    },
    frames.map((f) => f.jpegB64),
    4000,
  );
  return { ...toAsk(r.json), mode: r.mode };
}
