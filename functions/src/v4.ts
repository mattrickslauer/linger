// v4 contract types and constants (docs/ARCHITECTURE.md "v4"): claims, evidence plan, free video review,
// per-claim scores, seal v4. Types and constants ONLY: the logic lives with the functions implementation, and the
// reference math is shared/make-test-vectors-v4.mjs (vectors: shared/test-vectors-v4.json).

export const SEAL_VERSION_V4 = 4;
/** Baseline when the Moment has no client scorer result (adversarial prior). */
export const DEFAULT_BASELINE = 0.2;
/** Cheating detected → every claim p = min(p, CHEATING_CAP). */
export const CHEATING_CAP = 0.1;
/** A verdict (frames judge, video review, ladder module) counts as "backed" only at confidence ≥ this. */
export const BACKED_CONFIDENCE = 0.6;
/** A `motion` requirement without minSeconds needs this many seconds of non-zero motion. */
export const DEFAULT_MOTION_SECONDS = 10;
/** A GPS fix counts for a `gps` requirement when its accuracy is ≤ this (metres). */
export const GPS_FIX_MAX_ACCURACY_M = 100;
/** Seal without a chained clip that has not arrived after this long (from submittedAtServer). */
export const VIDEO_WAIT_MS = 24 * 60 * 60 * 1000;
/** Lease that keeps the video review to one model call at a time (server-only `videoLeases/{momentId}`). */
export const VIDEO_LEASE_MS = 300_000;
/** The video review reviews at most this many clips (the last ones in chain order). */
export const MAX_REVIEW_CLIPS = 3;
export const MAX_CLAIMS = 5;
export const MAX_REQUIREMENTS = 6;
export const MAX_CHEATING_SIGNALS = 6;

export type ClaimKind = "action" | "count" | "measure" | "place" | "time" | "object" | "outcome";
export const CLAIM_KINDS: ClaimKind[] = ["action", "count", "measure", "place", "time", "object", "outcome"];
export type Evidence = "video" | "frames" | "gps" | "motion" | "witness";
export type ClaimVerdict = "backed" | "not_backed" | "unclear";

/** `metric`, `value`, `unit` only on count/measure claims with value > 0 (stored form omits them otherwise). */
export interface Claim {
  id: string; // "c1".."c5"
  kind: ClaimKind;
  text: string; // ≤ 80
  metric?: string;
  value?: number;
  unit?: string;
}

export interface Requirement {
  id: string; // "r1".."r6"
  claimId: string;
  evidence: Evidence;
  ask: string; // ≤ 120
  minSeconds?: number; // video/motion; omitted when 0
}

export interface Plan {
  requirements: Requirement[]; // ≤ 6, ≥ 1 per claim (server-normalized)
  recordMode: "video" | "photo";
  note: string; // ≤ 160
}

/** Server-only `moments/{id}.claims` / `.plan` carry where they came from. */
export type ClaimsSource = "ai" | "client" | "default";

export interface VerdictForClaim {
  id: string;
  verdict: ClaimVerdict;
  confidence: number;
  reasons?: string[];
  measured?: { value: number; unit: string };
}

/** Server-only `moments/{id}.videoReview`. */
export interface VideoReview {
  status: "waiting" | "running" | "done" | "failed" | "expired" | "none";
  clips: Array<{ sha256: string; ext: string | null; durationMs: number; startedAt: number | null; uploaded: boolean; hashOk: boolean | null }>;
  claims: VerdictForClaim[];
  cheating: { detected: boolean; signals: string[] };
  summary: string;
  attempts: number;
  reason: string | null;
  model: string | null;
  ranAt: number | null;
  updatedAtServer?: unknown;
}

/** One entry of `verification.claims`. */
export interface ClaimScore {
  id: string;
  p: number; // final, after modules and the cheating cap
  sealP: number; // after the seal's "minimum evidence = bar" step, before modules and the cap
  met: string[]; // requirement ids
  unmet: string[];
  minimumMet: boolean; // ≥ 1 requirement and none unmet
  backedBy: string[]; // "video_review" | "frames_judge" | "gps" | "motion" | "witness" | ModuleId (passed for this claim)
}

/** Per-claim outcome a ladder module adds to its LadderResult (v4). */
export interface ModuleClaimOutcome {
  id: string;
  verdict: ClaimVerdict | "missing";
  confidence: number;
  passed: boolean; // counted: verdict == backed && confidence ≥ BACKED_CONFIDENCE
  before: number; // this claim's reported p (capped) before / after
  after: number;
  reasons: string[]; // ≤ 2
  measured?: { value: number; unit: string };
}

export interface SealChecksV4 {
  chain: boolean;
  timing: boolean;
  physics: boolean;
  frames: boolean;
  ai: boolean; // NOT (judge inconsistent with confidence ≥ 0.6)
  cheating: boolean; // true = none detected
  bar: boolean; // every claim p ≥ bar
}

export interface SealV4 {
  sealed: boolean;
  at: unknown; // serverTimestamp
  updatedAt: unknown;
  checks: SealChecksV4;
  reason: string;
  version: 4;
  ladderEligible: boolean; // chain && timing && physics && frames && cheating
  cheatingSignals: string[]; // ≤ 6, [] when none
}

export interface VerificationV4 {
  version: 4;
  baseline: number | null; // clamp01(score.probability), null if absent
  baselineUsed: number; // baseline ?? DEFAULT_BASELINE
  score: number; // min over claims of p
  bar: number;
  verified: boolean; // == seal.sealed
  cheating: { detected: boolean; signals: string[] };
  claims: ClaimScore[];
  claimsBacked: number; // claims with p ≥ bar
  modules: unknown[]; // v3 LadderResult + { claims: ModuleClaimOutcome[] }
  updatedAtServer: unknown;
}
