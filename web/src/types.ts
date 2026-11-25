// Mirrors docs/ARCHITECTURE.md ("Data model"). Keep in sync with the contract, not the other way round.

import type { Claim, ClaimScore, ModuleClaimOutcome, Plan, ServerClaims, ServerPlan, VideoReview } from "./v4";

export type Category = "fishing" | "fitness" | "outdoors" | "making" | "other";
export type Platform = "ios" | "android" | "web";
export type CheckMode = "on_device" | "cloud" | "none";
export type Verdict = "consistent" | "inconsistent" | "uncertain";

export const CATEGORIES: Category[] = ["fishing", "fitness", "outdoors", "making", "other"];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Summary {
  durationMs: number;
  distanceM: number;
  frameCount: number;
  gpsCount: number;
  motionCount: number;
  start: LatLng | null;
  end: LatLng | null;
  heroFrameSeq: number | null;
}

export interface AiOpinion {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  model: string;
  ranAt: number;
  /** v4 judge: per-claim verdicts on the server claims ([] when none arrived in time). */
  claims?: { id: string; verdict: "backed" | "not_backed" | "unclear"; confidence: number }[];
}

/** The scorer: probability the claim is true given the evidence, assuming most submissions cheat. */
export interface VerificationScore {
  probability: number;
  reasons: string[];
  model: string;
  ranAt: number;
}

export interface SealChecks {
  chain: boolean;
  timing: boolean;
  physics: boolean;
  frames: boolean;
  ai: boolean;
  /** v3: final verification score >= the Moment's bar. */
  bar?: boolean;
  /** v4: true = no cheating detected. */
  cheating?: boolean;
}

export interface Seal {
  sealed: boolean;
  at: unknown;
  updatedAt?: unknown;
  checks: SealChecks;
  reason: string;
  version: 1 | 2 | 3 | 4;
  /** v3: integrity + AI checks passed and a score exists, so the owner may run ladder modules. */
  ladderEligible?: boolean;
  /** v4: why cheating was detected ([] when none). */
  cheatingSignals?: string[];
}

// ---------------------------------------------------------------- v3 (docs/ARCHITECTURE.md v3.2 - v3.8)

export type MeasuredBy = "scale" | "ruler" | "photo" | "count" | "gps" | "motion" | "claim";
export interface Quantity {
  metric: string;
  value: number;
  unit: string;
  measuredBy: MeasuredBy;
}
export interface Place {
  name: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
  country: string | null;
}
export type InterviewMode = "on_device" | "cloud" | "mixed" | "typed";

/** v1 `{text, category}` stays valid; `v: 3` marks a structured intention. */
export interface Intention {
  text: string;
  category: Category;
  v?: 3 | 4;
  activity?: string;
  goal?: string;
  quantities?: Quantity[];
  place?: Place | null;
  window?: { start: number; expectedMinutes: number | null };
  conditions?: string[];
  assumptions?: string[];
  interview?: { turns: number; mode: InterviewMode };
  preview?: { bar: number; difficulty: number; mode: "on_device" | "cloud" } | null;
  /** v4 client drafts (`v: 4`); the server's `moments/{id}.claims` / `.plan` are authoritative. */
  claims?: Claim[];
  plan?: Plan | null;
}

/** Written only by the Cloud Function at submit. */
export interface Bar {
  value: number;
  difficulty: number;
  rationale: string;
  factors: string[];
  source: "ai" | "default";
  model: string | null;
  ranAt: number;
}

export type ModuleId = "second_look" | "place_time" | "witness_review" | "count_measure" | "full_video" | "human_review";

export interface LadderResult {
  runId: string;
  module: ModuleId;
  title: string;
  cost: number;
  strength: number;
  passed: boolean;
  confidence: number;
  before: number;
  after: number;
  reasons: string[];
  measured?: { metric: string; value: number; unit: string }[];
  model: string;
  ranAt: number;
  /** v4: per-claim outcomes for the claims this module backs. */
  claims?: ModuleClaimOutcome[];
}

/** Server-only: baseline score, the score after every ladder result, and whether it clears the bar. */
export interface Verification {
  version: 3 | 4;
  baseline: number | null;
  score: number | null;
  bar: number;
  verified: boolean;
  modules: LadderResult[];
  updatedAtServer?: unknown;
  // v4 (docs/ARCHITECTURE.md v4.6)
  baselineUsed?: number;
  cheating?: { detected: boolean; signals: string[] };
  claimsBacked?: number;
  claims?: ClaimScore[];
}

export interface WitnessSummary {
  asked: number;
  answered: number;
  skipped: number;
  mode?: "on_device" | "cloud" | "mixed" | "none";
}

export interface Moment {
  id: string;
  /** null only in the local journal, for a Moment recorded as a guest and not yet claimed. */
  ownerUid: string | null;
  owner: { name: string; photoURL: string | null } | null;
  intention: Intention;
  platform: Platform;
  device: { model: string; os: string; appVersion: string };
  status: "recording" | "submitted" | "sealed" | "rejected";
  startedAt: number;
  endedAt: number | null;
  chunkCount: number;
  headHash: string | null;
  summary: Summary | null;
  onDevice: { mode: CheckMode; checks: number; retakes: number };
  judge: AiOpinion | null;
  skeptic: AiOpinion | null;
  /** Absent on Moments recorded before the scorer existed. */
  score?: VerificationScore | null;
  seal: Seal | null;
  bar?: Bar | null;
  verification?: Verification | null;
  witness?: WitnessSummary | null;
  // v4, server-only
  claims?: ServerClaims | null;
  plan?: ServerPlan | null;
  videoReview?: VideoReview | null;
  recordedAsGuest?: boolean;
  claimedAt?: number | null;
  /** journal-only: recorded as a guest, not yet claimed by an account. Never written to Firestore. */
  guest?: boolean;
  /** client-only: Firestore metadata.hasPendingWrites */
  pending?: boolean;
}

export type GpsRow = [number, number, number, number, number | null, number | null];
export type MotionRow = [number, number, number, number, number, number, number];
export interface AppEvent {
  t: number;
  type:
    | "start"
    | "frame"
    | "check"
    | "retake"
    | "pause"
    | "resume"
    | "stop"
    | "video_start"
    | "video"
    | "hr"
    | "witness"
    | "witness_answer"
    | "witness_skip";
  [k: string]: unknown;
}
export interface LiveCheck {
  ok: boolean;
  reason: string;
  mode: CheckMode;
  label: string;
}

export interface Payload {
  gps: GpsRow[];
  motion: MotionRow[];
  events: AppEvent[];
  frameSha: string | null;
  check: LiveCheck | null;
}

export interface Frame {
  jpegB64: string;
  w: number;
  h: number;
  t: number;
}

export interface Chunk {
  seq: number;
  t0: number;
  t1: number;
  prevHash: string;
  payload: string;
  hash: string;
  frame: Frame | null;
}

export interface FeedLadderStep {
  module: ModuleId;
  title: string;
  passed: boolean;
  before: number;
  after: number;
  reasons: string[];
}

export interface FeedEntry {
  momentId: string;
  owner: { name: string; photoURL: string | null };
  intention: Intention;
  platform: Platform;
  summary: Summary;
  onDeviceMode: CheckMode;
  status: "sealed" | "rejected";
  sealReason: string;
  checks: SealChecks;
  judgeReasons: string[];
  /** Scorer's P(claim true | evidence); null/absent for Moments without a score. */
  verificationScore?: number | null;
  scoreReasons?: string[];
  heroJpegB64: string | null;
  track: [number, number][];
  // v3 (absent on older entries)
  bar?: number | null;
  barRationale?: string | null;
  difficulty?: number | null;
  baselineScore?: number | null;
  ladder?: FeedLadderStep[];
  witness?: WitnessSummary | null;
  recordedAsGuest?: boolean;
  sealVersion?: number;
  // v4 (docs/ARCHITECTURE.md v4.8)
  claims?: FeedClaim[];
  claimsBacked?: number;
  claimsTotal?: number;
  cheating?: boolean;
  cheatingSignals?: string[];
  video?: { reviewed: boolean; summary: string | null; status: VideoReview["status"] } | null;
  plan?: { recordMode: "video" | "photo"; requirements: FeedRequirement[] } | null;
  sealedAtServer: number | null; // millis (converted from Timestamp on read)
}

export interface FeedClaim {
  id: string;
  kind: Claim["kind"];
  text: string;
  p: number;
  backed: boolean;
  backedBy: string[];
  met: number;
  total: number;
}
export interface FeedRequirement {
  id: string;
  claimId: string;
  evidence: Plan["requirements"][number]["evidence"];
  ask: string;
  met: boolean;
}
