// Pure, deterministic seal logic for Verified. No Firebase imports here: it is unit tested
// against shared/test-vectors.json and used by the Cloud Function in index.ts.
// Contract: docs/ARCHITECTURE.md ("Deterministic seal").
import { createHash } from "node:crypto";

export const SEAL_VERSION = 2;
export const MIN_DURATION_MS = 20_000;
export const MAX_GPS_SPEED_MPS = 70;
export const AI_MIN_CONFIDENCE = 0.6;
/** Scorer: P(claim true | evidence) under a cheater-heavy prior (0.2, shared/prompts.json). Must reach this. */
export const SCORE_MIN_PROBABILITY = 0.5;
export const MAX_TRACK_POINTS = 200;

export type Verdict = "consistent" | "inconsistent" | "uncertain";
export interface AiOpinion {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  model?: string;
  ranAt?: number;
}

/** The scorer's output: probability the claim is true given the evidence, assuming most submissions cheat. */
export interface VerificationScore {
  probability: number;
  reasons: string[];
  model?: string;
  ranAt?: number;
}

export interface Frame {
  jpegB64: string;
  w: number;
  h: number;
  t: number;
}

export interface ChunkDoc {
  seq: number;
  t0: number;
  t1: number;
  prevHash: string;
  payload: string;
  hash: string;
  frame?: Frame | null;
}

export interface MomentDoc {
  ownerUid: string;
  status: string;
  startedAt: number;
  endedAt: number | null;
  chunkCount: number;
  headHash: string | null;
  summary?: Partial<Summary> | null;
  judge?: AiOpinion | null;
  skeptic?: AiOpinion | null;
  /** Optional so Moments from app builds without the scorer still seal on judge + skeptic. */
  score?: VerificationScore | null;
  seal?: unknown;
  [k: string]: unknown;
}

export type GpsSample = [number, number, number, number, number | null, number | null];
export type MotionSample = [number, number, number, number, number, number, number];

export interface Payload {
  gps: GpsSample[];
  motion: MotionSample[];
  events: Array<{ t: number; type: string; [k: string]: unknown }>;
  frameSha: string | null;
  check: { ok: boolean; reason: string; mode: string; label: string } | null;
}

export interface Summary {
  durationMs: number;
  distanceM: number;
  frameCount: number;
  gpsCount: number;
  motionCount: number;
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
  heroFrameSeq: number | null;
}

export interface Checks {
  chain: boolean;
  timing: boolean;
  physics: boolean;
  frames: boolean;
  ai: boolean;
}

export interface SealResult {
  sealed: boolean;
  checks: Checks;
  reason: string;
  /** Human readable reason for every failed check (empty when sealed). */
  failures: string[];
  /** Server-recomputed summary (feed uses this, not the client's). */
  summary: Summary;
  track: Array<[number, number]>;
  heroFrameSeq: number | null;
}

// ───────────────────────────────── hashing

export function sha256hex(s: string): string {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

export function chunkHash(c: Pick<ChunkDoc, "seq" | "t0" | "t1" | "prevHash" | "payload">): string {
  return sha256hex(`${c.seq}|${c.t0}|${c.t1}|${c.prevHash}|${sha256hex(c.payload)}`);
}

export function genesis(momentId: string): string {
  return "GENESIS:" + momentId;
}

export function chunkId(seq: number): string {
  return String(seq).padStart(6, "0");
}

// ───────────────────────────────── geo

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Evenly downsample to at most `max` points, always keeping first and last. */
export function downsample<T>(pts: T[], max = MAX_TRACK_POINTS): T[] {
  if (pts.length <= max) return pts.slice();
  const out: T[] = [];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

// ───────────────────────────────── parsing

export function parsePayload(s: string): Payload | null {
  try {
    const p = JSON.parse(s);
    if (!p || typeof p !== "object") return null;
    return {
      gps: Array.isArray(p.gps) ? p.gps : [],
      motion: Array.isArray(p.motion) ? p.motion : [],
      events: Array.isArray(p.events) ? p.events : [],
      frameSha: typeof p.frameSha === "string" ? p.frameSha : null,
      check: p.check && typeof p.check === "object" ? p.check : null,
    };
  } catch {
    return null;
  }
}

// ───────────────────────────────── individual checks

export function checkChain(momentId: string, m: Pick<MomentDoc, "chunkCount" | "headHash">, chunks: ChunkDoc[]): string[] {
  const f: string[] = [];
  if (!Number.isInteger(m.chunkCount) || m.chunkCount < 1) f.push("chunkCount missing");
  if (chunks.length !== m.chunkCount) f.push(`expected ${m.chunkCount} chunks, found ${chunks.length}`);
  let prev = genesis(momentId);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.seq !== i) {
      f.push(`chunk ${i} has seq ${c.seq} (gap or reorder)`);
      break;
    }
    if (c.prevHash !== prev) {
      f.push(`chunk ${i} prevHash does not link`);
      break;
    }
    if (typeof c.payload !== "string" || chunkHash(c) !== c.hash) {
      f.push(`chunk ${i} hash mismatch`);
      break;
    }
    prev = c.hash;
  }
  if (f.length === 0 && m.headHash !== prev) f.push("headHash does not match last chunk");
  return f;
}

export function checkTiming(m: Pick<MomentDoc, "startedAt" | "endedAt">, chunks: ChunkDoc[], payloads: Payload[]): string[] {
  const f: string[] = [];
  if (chunks.length === 0) return ["no chunks"];
  let lastT1 = -Infinity;
  let lastSample = -Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!(Number.isFinite(c.t0) && Number.isFinite(c.t1)) || c.t1 < c.t0) {
      f.push(`chunk ${i} has t1 before t0`);
      break;
    }
    if (c.t0 < lastT1) {
      f.push(`chunk ${i} overlaps the previous chunk`);
      break;
    }
    lastT1 = c.t1;
    // Samples inside the whole moment must never go back in time (per stream).
    const p = payloads[i];
    const ts = [...p.gps.map((g) => g[0]), ...p.events.map((e) => e.t)];
    for (const t of ts) if (!Number.isFinite(t)) f.push(`chunk ${i} has a non-numeric time`);
    const gpsT = p.gps.map((g) => g[0]);
    for (const t of gpsT) {
      if (t < lastSample) {
        f.push(`GPS time goes backwards in chunk ${i}`);
        break;
      }
      lastSample = t;
    }
  }
  // Motion monotonic, checked separately (independent stream).
  let lastMotion = -Infinity;
  outer: for (let i = 0; i < payloads.length; i++) {
    for (const s of payloads[i].motion) {
      if (s[0] < lastMotion) {
        f.push(`motion time goes backwards in chunk ${i}`);
        break outer;
      }
      lastMotion = s[0];
    }
  }
  const first = chunks[0].t0;
  const last = chunks[chunks.length - 1].t1;
  const duration = last - first;
  if (duration < MIN_DURATION_MS) f.push(`too short (${Math.round(duration / 1000)}s < ${MIN_DURATION_MS / 1000}s)`);
  if (m.endedAt == null || m.endedAt < last) f.push("endedAt is before the last chunk");
  if (typeof m.startedAt !== "number" || m.startedAt > first) f.push("startedAt is after the first chunk");
  return f;
}

export function checkPhysics(payloads: Payload[]): string[] {
  const f: string[] = [];
  const gps = payloads.flatMap((p) => p.gps);
  for (let i = 1; i < gps.length; i++) {
    const a = gps[i - 1];
    const b = gps[i];
    const d = haversineM(a[1], a[2], b[1], b[2]);
    const slack = (a[3] ?? 0) + (b[3] ?? 0); // within combined accuracy: not a jump
    if (d <= slack) continue;
    const dt = (b[0] - a[0]) / 1000;
    const speed = dt > 0 ? d / dt : Infinity;
    if (speed > MAX_GPS_SPEED_MPS) {
      f.push(`GPS jump of ${Math.round(d)} m at ${dt > 0 ? Math.round(speed) + " m/s" : "the same instant"}`);
      break;
    }
  }
  const motion = payloads.flatMap((p) => p.motion);
  if (motion.length > 0 && !motion.some((s) => s.slice(1).some((v) => typeof v === "number" && v !== 0))) {
    f.push("motion sensors report all zeros");
  }
  return f;
}

export function checkFrames(chunks: ChunkDoc[], payloads: Payload[]): string[] {
  const f: string[] = [];
  let n = 0;
  for (let i = 0; i < chunks.length; i++) {
    const sha = payloads[i].frameSha;
    const frame = chunks[i].frame ?? null;
    if (sha == null && frame == null) continue;
    if (sha == null || frame == null || typeof frame.jpegB64 !== "string") {
      f.push(`chunk ${i} frame and frameSha disagree`);
      continue;
    }
    if (sha256hex(frame.jpegB64) !== sha) {
      f.push(`chunk ${i} frame does not match its hash`);
      continue;
    }
    n++;
  }
  if (n === 0 && f.length === 0) f.push("no proof frames");
  return f;
}

export function checkAi(
  judge: AiOpinion | null | undefined,
  skeptic: AiOpinion | null | undefined,
  score?: VerificationScore | null,
): string[] {
  const f: string[] = [];
  if (!judge) f.push("judge missing");
  else if (judge.verdict !== "consistent" || !(judge.confidence >= AI_MIN_CONFIDENCE)) {
    f.push(`judge: ${judge.verdict} (${Math.round((judge.confidence ?? 0) * 100)}%)` + (judge.reasons?.[0] ? ` - ${judge.reasons[0]}` : ""));
  }
  if (!skeptic) f.push("skeptic missing");
  else if (skeptic.verdict === "inconsistent") {
    f.push("skeptic found a fake signal" + (skeptic.reasons?.[0] ? `: ${skeptic.reasons[0]}` : ""));
  }
  if (score != null) {
    const p = Number(score.probability);
    if (!(Number.isFinite(p) && p >= SCORE_MIN_PROBABILITY)) {
      f.push(
        `verification score ${Number.isFinite(p) ? Math.round(p * 100) + "%" : "invalid"} below ${SCORE_MIN_PROBABILITY * 100}%` +
          (score.reasons?.[0] ? ` - ${score.reasons[0]}` : ""),
      );
    }
  }
  return f;
}

// ───────────────────────────────── summary

export function computeSummary(m: Pick<MomentDoc, "summary">, chunks: ChunkDoc[], payloads: Payload[]): Summary {
  const gps = payloads.flatMap((p) => p.gps);
  let distanceM = 0;
  for (let i = 1; i < gps.length; i++) distanceM += haversineM(gps[i - 1][1], gps[i - 1][2], gps[i][1], gps[i][2]);
  const frameSeqs = chunks.filter((c, i) => c.frame && payloads[i].frameSha).map((c) => c.seq);
  const clientHero = m.summary?.heroFrameSeq;
  const heroFrameSeq =
    typeof clientHero === "number" && frameSeqs.includes(clientHero)
      ? clientHero
      : frameSeqs.length
        ? frameSeqs[Math.floor((frameSeqs.length - 1) / 2)]
        : null;
  return {
    durationMs: chunks.length ? chunks[chunks.length - 1].t1 - chunks[0].t0 : 0,
    distanceM: Math.round(distanceM * 10) / 10,
    frameCount: frameSeqs.length,
    gpsCount: gps.length,
    motionCount: payloads.reduce((n, p) => n + p.motion.length, 0),
    start: gps.length ? { lat: gps[0][1], lng: gps[0][2] } : null,
    end: gps.length ? { lat: gps[gps.length - 1][1], lng: gps[gps.length - 1][2] } : null,
    heroFrameSeq,
  };
}

// ───────────────────────────────── the seal

/**
 * Deterministically evaluates a submitted Moment. `chunks` may be in any order; they are sorted by seq.
 * Never throws on bad data: malformed input simply fails the relevant check.
 */
export function evaluateSeal(momentId: string, m: MomentDoc, rawChunks: ChunkDoc[]): SealResult {
  const chunks = rawChunks.slice().sort((a, b) => a.seq - b.seq);
  const parsed = chunks.map((c) => parsePayload(c.payload));
  const payloads = parsed.map((p) => p ?? { gps: [], motion: [], events: [], frameSha: null, check: null });

  const chainF = checkChain(momentId, m, chunks);
  if (parsed.some((p) => p === null)) chainF.push("a chunk payload is not valid JSON");
  const timingF = checkTiming(m, chunks, payloads);
  const physicsF = checkPhysics(payloads);
  const framesF = checkFrames(chunks, payloads);
  const aiF = checkAi(m.judge, m.skeptic, m.score);

  const checks: Checks = {
    chain: chainF.length === 0,
    timing: timingF.length === 0,
    physics: physicsF.length === 0,
    frames: framesF.length === 0,
    ai: aiF.length === 0,
  };
  const failures = [
    ...chainF.map((s) => "Chain: " + s),
    ...timingF.map((s) => "Timing: " + s),
    ...physicsF.map((s) => "Physics: " + s),
    ...framesF.map((s) => "Frames: " + s),
    ...aiF.map((s) => "AI: " + s),
  ];
  const sealed = failures.length === 0;
  const summary = computeSummary(m, chunks, payloads);
  const track = downsample(
    payloads.flatMap((p) => p.gps).map((g) => [g[1], g[2]] as [number, number]),
    MAX_TRACK_POINTS,
  );
  return {
    sealed,
    checks,
    failures,
    reason: sealed ? "All checks passed: chain intact, timing and physics plausible, frames match, judge and skeptic agree." : failures[0],
    summary,
    track,
    heroFrameSeq: summary.heroFrameSeq,
  };
}

/** Should the function try to seal this moment now? */
export function isReadyToSeal(m: Partial<MomentDoc> | undefined | null): boolean {
  return !!m && m.status === "submitted" && !!m.judge && !!m.skeptic && (m.seal === null || m.seal === undefined);
}
