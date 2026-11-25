// The four AI Logic calls, with routing recorded so the UI can say which model ran.

import { InferenceSource, type InlineDataPart } from "firebase/ai";
import { cloudModel, judgeModel, liveCheckModel, prompts, scorerModel, skepticModel } from "./firebase";
import { fmtDistance, fmtDuration } from "./geo";
import { fill, parseJson, pickFrames } from "./ai-util";
import type { AiOpinion, CheckMode, LiveCheck, Moment, Summary, Verdict, VerificationScore } from "./types";


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

async function opinion(which: "judge" | "skeptic", m: Moment, frames: { t: number; jpegB64: string }[]): Promise<AiOpinion> {
  const model = which === "judge" ? judgeModel() : skepticModel();
  const p = prompts[which];
  const text =
    fill(p.user, promptValues(m, frames)) + '\nReply as JSON: {"verdict": "consistent"|"inconsistent"|"uncertain", "confidence": 0..1, "reasons": string[]}';
  const res = await withTimeout(model.generateContent([text, ...frames.map((f) => jpegPart(f.jpegB64))], { timeout: 60_000 }), 65_000);
  const j = parseJson<AiOpinion>(res.response.text());
  const verdict: Verdict = j.verdict === "consistent" || j.verdict === "inconsistent" ? j.verdict : "uncertain";
  return {
    verdict,
    confidence: Math.max(0, Math.min(1, Number(j.confidence ?? 0))),
    reasons: (Array.isArray(j.reasons) ? j.reasons : []).map(String).slice(0, 4),
    model: cloudModel(),
    ranAt: Date.now(),
  };
}

function promptValues(m: Moment, frames: { t: number }[]) {
  return {
    intention: m.intention.text,
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

/** Judge, skeptic and scorer in parallel over the same frames. All three or nothing. */
export async function cloudReview(m: Moment, frames: { seq: number; t: number; jpegB64: string }[]) {
  const chosen = pickFrames(frames, m.summary?.heroFrameSeq ?? null);
  const [judge, skeptic, verification] = await Promise.all([opinion("judge", m, chosen), opinion("skeptic", m, chosen), score(m, chosen)]);
  return { judge, skeptic, score: verification };
}
