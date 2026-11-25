// v5 server agents (ONLY_IN_CLOUD): the rebuttal screen (cheap gate in submitRebuttal) and the challenge review
// (one re-verification per round). They only propose; challenge.ts decides. Fake answers (emulator / tests):
//   screen  refuses text shorter than 12 chars or containing "#screen-refuse"
//   review  upholds rebuttals whose text contains "#rebut-hold" (0.85) and marks their claim not_backed (0.85);
//           everything else dismissed / backed. "#ai-fail" anywhere makes the engine throw (ai.ts).
import { AiEngine, Part, getEngine } from "./ai";
import { intentionForModel } from "./agents";
import { intentionWithoutDraft } from "./claims";
import { Anchor, ClaimLite, RebuttalCategory, ReviewAnswer, coerceReview, coerceScreen, framesForReview } from "./challenge";
import type { ChainFacts } from "./ladder";
import type { MomentDoc } from "./seal";
import { CLIP_TYPES, ReviewClip, sensorFacts } from "./video";

export function anchorText(a: Anchor, facts: Pick<ChainFacts, "frames" | "startT">): string {
  const s = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  switch (a.kind) {
    case "claim":
      return "the claim as a whole";
    case "frame": {
      const f = facts.frames.find((x) => x.seq === a.frameSeq);
      return f && facts.startT != null ? `proof frame seq ${a.frameSeq} at ${s(f.t - facts.startT)}` : `proof frame seq ${a.frameSeq}`;
    }
    case "clip":
      return `video clip ${String(a.clipSha).slice(0, 8)} at ${s(a.clipMs ?? 0)}`;
    case "track":
      return `map point ${a.trackIndex} of the GPS track`;
  }
}

export interface ScreenCall {
  claim: ClaimLite;
  anchor: string;
  text: string;
  category: RebuttalCategory;
}

export async function runScreen(call: ScreenCall, engine: AiEngine = getEngine()) {
  const { data, model } = await engine.generateJson({
    prompt: "rebuttalScreen",
    vars: { claim: JSON.stringify(call.claim), anchor: call.anchor, category: call.category, text: call.text },
    fake: () => {
      const refuse = call.text.trim().length < 12 || call.text.includes("#screen-refuse");
      return { accepted: !refuse, reason: refuse ? "Emulator: says nothing checkable" : "Emulator: specific and checkable", category: call.category };
    },
  });
  return { ...coerceScreen(data, call.category), model };
}

export interface ReviewRebuttal {
  id: string;
  claimId: string;
  anchor: Anchor;
  category: string;
  text: string;
}

export interface ChallengeReviewCall {
  moment: MomentDoc;
  facts: ChainFacts;
  claims: Array<ClaimLite & { p?: number | null }>;
  rebuttals: ReviewRebuttal[];
  /** Matching uploaded clips, chain order, with gs:// URIs. */
  clips: Array<ReviewClip & { gsUri: string }>;
}

export function fakeReview(call: Pick<ChallengeReviewCall, "rebuttals" | "claims">): Record<string, unknown> {
  const hold = call.rebuttals.filter((r) => r.text.includes("#rebut-hold"));
  const fallen = new Set(hold.map((r) => r.claimId));
  return {
    rebuttals: call.rebuttals.map((r) =>
      r.text.includes("#rebut-hold")
        ? { id: r.id, verdict: "upheld", confidence: 0.85, reason: "Emulator: the evidence agrees with this rebuttal" }
        : { id: r.id, verdict: "dismissed", confidence: 0.8, reason: "Emulator: the evidence does not show this" },
    ),
    claims: call.claims.map((c) => (fallen.has(c.id) ? { id: c.id, verdict: "not_backed", confidence: 0.85, reasons: ["Emulator: rebutted"] } : { id: c.id, verdict: "backed", confidence: 0.8, reasons: ["Emulator: holds up"] })),
    cheating: { detected: false, signals: [] },
    summary: hold.length ? "Emulator: the crowd found a real problem." : "Emulator: the Moment holds up under the challenge.",
  };
}

export async function runChallengeReview(call: ChallengeReviewCall, engine: AiEngine = getEngine()): Promise<ReviewAnswer & { model: string }> {
  const m = call.moment;
  const startT = call.facts.startT ?? 0;
  const anchored = call.rebuttals.filter((r) => r.anchor.kind === "frame").map((r) => r.anchor.frameSeq as number);
  const frames = framesForReview(call.facts.frames, anchored);
  const media: Part[] = [
    ...frames.map((f) => ({ inlineData: { mimeType: "image/jpeg", data: f.jpegB64 } })),
    ...call.clips.map((c) => ({ fileData: { fileUri: c.gsUri, mimeType: CLIP_TYPES[c.ext ?? "mp4"] ?? "video/mp4" } })),
  ];
  const { data, model } = await engine.generateJson({
    prompt: "challengeReview",
    vars: {
      intention: JSON.stringify(intentionWithoutDraft(intentionForModel(m.intention))),
      claims: JSON.stringify(call.claims),
      summary: JSON.stringify(m.summary ?? {}),
      sensors: JSON.stringify(sensorFacts(call.facts)),
      earlier: JSON.stringify({
        judge: m.judge?.reasons ?? [],
        skeptic: m.skeptic?.reasons ?? [],
        videoReview: (m.videoReview as { summary?: string } | undefined)?.summary ?? null,
      }),
      rebuttals: JSON.stringify(call.rebuttals.map((r) => ({ id: r.id, claimId: r.claimId, pointsAt: anchorText(r.anchor, call.facts), category: r.category, text: r.text }))),
      frames: JSON.stringify(frames.map((f) => ({ seq: f.seq, atS: Math.round((f.t - startT) / 1000) }))),
      clips: JSON.stringify(call.clips.map((c) => ({ sha256: c.sha256, atS: c.startedAt != null ? Math.round((c.startedAt - startT) / 1000) : null, durationS: Math.round(c.durationMs / 100) / 10 }))),
    },
    media,
    fake: () => fakeReview(call),
  });
  return { ...coerceReview(data, call.rebuttals.map((r) => r.id), call.claims.map((c) => c.id)), model };
}
