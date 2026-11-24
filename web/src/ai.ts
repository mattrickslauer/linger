// The three AI Logic calls, with routing recorded so the UI can say which model ran.

import { InferenceSource, type InlineDataPart } from "firebase/ai";
import { cloudModel, judgeModel, liveCheckModel, prompts, skepticModel } from "./firebase";
import { fmtDistance, fmtDuration } from "./geo";
import { fill, parseJson, pickFrames } from "./ai-util";
import type { AiOpinion, CheckMode, LiveCheck, Moment, Summary, Verdict } from "./types";


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
  const offsets = frames.map((f) => Math.round((f.t - m.startedAt) / 1000) + "s").join(", ") || "none";
  const text =
    fill(p.user, {
      intention: m.intention.text,
      category: m.intention.category,
      summary: m.summary ? summaryText(m.summary) : "unavailable",
      frameOffsets: offsets,
    }) + '\nReply as JSON: {"verdict": "consistent"|"inconsistent"|"uncertain", "confidence": 0..1, "reasons": string[]}';
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

export async function judgeAndSkeptic(m: Moment, frames: { seq: number; t: number; jpegB64: string }[]) {
  const chosen = pickFrames(frames, m.summary?.heroFrameSeq ?? null);
  const [judge, skeptic] = await Promise.all([opinion("judge", m, chosen), opinion("skeptic", m, chosen)]);
  return { judge, skeptic };
}
