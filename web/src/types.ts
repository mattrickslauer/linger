// Mirrors docs/ARCHITECTURE.md ("Data model"). Keep in sync with the contract, not the other way round.

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
}

export interface Seal {
  sealed: boolean;
  at: unknown;
  checks: SealChecks;
  reason: string;
  version: 1 | 2;
}

export interface Moment {
  id: string;
  ownerUid: string;
  owner: { name: string; photoURL: string | null };
  intention: { text: string; category: Category };
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
  /** client-only: Firestore metadata.hasPendingWrites */
  pending?: boolean;
}

export type GpsRow = [number, number, number, number, number | null, number | null];
export type MotionRow = [number, number, number, number, number, number, number];
export interface AppEvent {
  t: number;
  type: "start" | "frame" | "check" | "retake" | "pause" | "resume" | "stop";
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

export interface FeedEntry {
  momentId: string;
  owner: { name: string; photoURL: string | null };
  intention: { text: string; category: Category };
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
  sealedAtServer: number | null; // millis (converted from Timestamp on read)
}
