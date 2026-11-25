// v4.4 free video review: which chained clips are in Storage, the clip list the Moment records, and the
// `videoReview` model call (ONLY_IN_CLOUD, Gemini on Vertex with gs:// fileData URIs; the fake engine in emulators).
// The model only proposes per-claim verdicts and cheating signals; score4.ts decides.
import { AiEngine, Part, asNumber, asStrings, getEngine } from "./ai";
import { intentionForModel } from "./agents";
import { intentionWithoutDraft } from "./claims";
import { ChainFacts, VideoFact, clamp01, countMotionReps, gpsAt, gpsDistanceM, localTimeLabel, round2, sunElevationDeg } from "./ladder";
import { MomentDoc } from "./seal";
import { Claim, ClaimVerdict, MAX_REVIEW_CLIPS, Plan, VerdictForClaim, VideoReview } from "./v4";

export const CLIP_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
export const CLIP_EXTS = Object.keys(CLIP_TYPES);

export type ReviewClip = VideoReview["clips"][number];

export function clipPath(uid: string, momentId: string, sha256: string, ext: string): string {
  return `clips/${uid}/${momentId}/${sha256}.${ext}`;
}

/** Parses `clips/{uid}/{momentId}/{sha256}.{ext}`; null for anything else. */
export function parseClipPath(name: string | undefined | null): { uid: string; momentId: string; sha256: string; ext: string } | null {
  const m = /^clips\/([^/]+)\/([^/]+)\/([0-9a-f]{64})\.(mp4|mov|webm)$/.exec(name ?? "");
  return m ? { uid: m[1], momentId: m[2], sha256: m[3], ext: m[4] } : null;
}

/** The Moment's clip list, in chain order, from which clips were found in Storage (sha → ext). Hashes not checked yet. */
export function clipList(videos: VideoFact[], found: Map<string, string>, hashOk: Map<string, boolean> = new Map()): ReviewClip[] {
  const seen = new Set<string>();
  const out: ReviewClip[] = [];
  for (const v of videos) {
    if (seen.has(v.sha256)) continue;
    seen.add(v.sha256);
    const ext = found.get(v.sha256) ?? null;
    out.push({ sha256: v.sha256, ext, durationMs: v.durationMs ?? 0, startedAt: v.startedAt, uploaded: ext != null, hashOk: ext != null && hashOk.has(v.sha256) ? hashOk.get(v.sha256)! : null });
  }
  return out;
}

/** The clips the model watches: the last ≤ 3 uploaded clips whose hash matches, in chain order. */
export function clipsForReview(clips: ReviewClip[]): ReviewClip[] {
  return clips.filter((c) => c.uploaded && c.hashOk === true).slice(-MAX_REVIEW_CLIPS);
}

export function emptyReview(status: VideoReview["status"], reason: string | null, clips: ReviewClip[] = [], attempts = 0): Omit<VideoReview, "updatedAtServer"> {
  return { status, clips, claims: [], cheating: { detected: false, signals: [] }, summary: "", attempts, reason, model: null, ranAt: null };
}

export interface VideoAnswer {
  claims: VerdictForClaim[];
  cheating: { detected: boolean; signals: string[] };
  summary: string;
  model: string;
}

const VERDICTS: ClaimVerdict[] = ["backed", "not_backed", "unclear"];

/** Coerces per-claim verdicts to the given claim ids (unknown ids and invalid verdicts dropped, first one wins). */
export function coerceVerdicts(raw: unknown, claimIds: string[], maxReasons = 3): VerdictForClaim[] {
  const out: VerdictForClaim[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const verdict = o.verdict as ClaimVerdict;
    if (!claimIds.includes(id) || !VERDICTS.includes(verdict) || out.some((v) => v.id === id)) continue;
    const v: VerdictForClaim = { id, verdict, confidence: round2(clamp01(asNumber(o.confidence, 0))), reasons: asStrings(o.reasons, maxReasons) };
    const m = o.measured as Record<string, unknown> | undefined;
    if (m && typeof m === "object" && Number.isFinite(asNumber(m.value, NaN))) v.measured = { value: asNumber(m.value, 0), unit: String(m.unit ?? "").slice(0, 20) };
    out.push(v);
  }
  return out;
}

/** Code-computed sensor facts for `{{sensors}}` (the same facts place_time / count_measure use). */
export function sensorFacts(facts: ChainFacts) {
  const reps = countMotionReps(facts.motion);
  const start = facts.startT != null ? gpsAt(facts.gps, facts.startT) : null;
  return {
    gpsDistanceM: Math.round(gpsDistanceM(facts.gps)),
    gpsFixes: facts.gps.length,
    motionReps: reps.reps,
    motionSeconds: reps.seconds,
    cadencePerMin: reps.cadencePerMin,
    localTime: facts.startT != null ? localTimeLabel(facts.startT, start?.lng ?? null) : null,
    sunElevationDeg: start && facts.startT != null ? Math.round(sunElevationDeg(start.lat, start.lng, facts.startT) * 10) / 10 : null,
  };
}

/** Deterministic answer for the fake engine: backs every claim, unless the intention carries an e2e marker. */
export function fakeVideoAnswer(intentionText: string, claims: Claim[]): Record<string, unknown> {
  const cheat = intentionText.includes("#video-cheat");
  const unclear = intentionText.includes("#video-unclear");
  return {
    claims: claims.map((c) => ({
      id: c.id,
      verdict: unclear ? "unclear" : "backed",
      confidence: unclear ? 0.4 : 0.85,
      reasons: [unclear ? "Emulator: the clip cannot tell" : `Emulator: the clip shows ${c.text}`],
      ...(c.kind === "count" || c.kind === "measure" ? { measured: { value: c.value ?? 0, unit: c.unit ?? "" } } : {}),
    })),
    cheating: cheat ? { detected: true, signals: ["loop: the same 3 s repeat"] } : { detected: false, signals: [] },
    summary: unclear ? "Emulator: a dark, shaky clip." : "Emulator: one continuous clip of the activity.",
  };
}

export interface VideoReviewCall {
  moment: MomentDoc;
  facts: ChainFacts;
  claims: Claim[];
  plan: Plan;
  /** Clips to watch, chain order, with their gs:// URIs. */
  clips: Array<ReviewClip & { gsUri: string }>;
}

/** Runs the `videoReview` model call. Throws on model failure (the caller counts the attempt). */
export async function runVideoReview(call: VideoReviewCall, engine: AiEngine = getEngine()): Promise<VideoAnswer> {
  const intention = intentionWithoutDraft(intentionForModel(call.moment.intention));
  const startT = call.facts.startT ?? 0;
  const media: Part[] = call.clips.map((c) => ({ fileData: { fileUri: c.gsUri, mimeType: CLIP_TYPES[c.ext ?? "mp4"] ?? "video/mp4" } }));
  const { requirements, recordMode, note } = call.plan;
  const { data, model } = await engine.generateJson({
    prompt: "videoReview",
    vars: {
      intention: JSON.stringify(intention),
      claims: JSON.stringify(call.claims),
      plan: JSON.stringify({ requirements, recordMode, note }),
      summary: JSON.stringify(call.moment.summary ?? {}),
      sensors: JSON.stringify(sensorFacts(call.facts)),
      clips: JSON.stringify(
        call.clips.map((c) => ({ sha256: c.sha256, atS: c.startedAt != null ? Math.round((c.startedAt - startT) / 1000) : null, durationS: Math.round(c.durationMs / 100) / 10 })),
      ),
    },
    media,
    fake: () => fakeVideoAnswer(String(intention.text ?? ""), call.claims),
  });
  if (!Array.isArray(data.claims)) throw new Error("model answer has no claims list");
  const ch = (data.cheating ?? {}) as Record<string, unknown>;
  const signals = asStrings(ch.signals, 4, 120);
  return {
    claims: coerceVerdicts(data.claims, call.claims.map((c) => c.id)),
    cheating: { detected: ch.detected === true, signals: ch.detected === true ? signals : [] },
    summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 160) : "",
    model,
  };
}
