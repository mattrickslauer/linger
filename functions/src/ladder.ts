// Pure v3 logic for the AI-set bar, the verification ladder and the facts the server reads from the chain.
// No Firebase imports: unit tested in test/ladder.test.ts against shared/test-vectors-v3.json.
// Contract: docs/ARCHITECTURE.md v3.3 (bar), v3.4 (witness events), v3.5 (seal v3), v3.6 (ladder + credits).
import { ChunkDoc, DEFAULT_BAR, haversineM, parsePayload, Payload, sealedReason } from "./seal";
import type { ModuleDef, ModuleId, Need } from "./shared";

// ───────────────────────────────── numbers

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
export const round2 = (x: number): number => Math.round(x * 100) / 100;

/** v3.3: bar = round2(0.5 + 0.45 * clamp01(difficulty)). */
export function barFromDifficulty(difficulty: number): number {
  return round2(DEFAULT_BAR + 0.45 * clamp01(Number(difficulty)));
}

/** v3.6: pass p' = p + s(1 - p), fail p' = p(1 - s). No rounding. */
export function applyStep(p: number, strength: number, passed: boolean): number {
  return passed ? p + strength * (1 - p) : p * (1 - strength);
}

/** v3.6: the model's verdict counts as a pass only when passed && confidence >= passConfidence. */
export function countsAsPass(passed: unknown, confidence: unknown, passConfidence: number): boolean {
  return passed === true && Number(confidence) >= passConfidence;
}

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
  measured?: Measured[];
  model: string;
  ranAt: number;
}

export interface Measured {
  metric: string;
  value: number;
  unit: string;
}

/** Recompute the final score from the baseline and every result, in run order. */
export function scoreFromResults(baseline: number, results: Array<Pick<LadderResult, "strength" | "passed">>): number {
  return results.reduce((p, r) => applyStep(p, r.strength, r.passed), baseline);
}

export interface SealV3 {
  sealed: boolean;
  checks: { chain: boolean; timing: boolean; physics: boolean; frames: boolean; ai: boolean; bar: boolean };
  reason: string;
  version: number;
  ladderEligible: boolean;
  [k: string]: unknown;
}

/**
 * v3.5: after a ladder run only `checks.bar`, `sealed` and `reason` change. Integrity checks are never re-run.
 * Returns the new seal fields and the status that follows from them.
 */
export function resealAfterLadder(
  seal: SealV3,
  score: number,
  barValue: number,
): { checks: SealV3["checks"]; sealed: boolean; reason: string; status: "sealed" | "rejected" } {
  const checks = { ...seal.checks, bar: score >= barValue };
  const sealed = Object.values(checks).every(Boolean);
  let reason: string;
  if (sealed) reason = sealedReason(score, barValue);
  else if (!checks.bar && seal.checks.chain && seal.checks.timing && seal.checks.physics && seal.checks.frames && seal.checks.ai) {
    reason = `Bar: verification score ${score.toFixed(2)} is below the bar ${barValue.toFixed(2)} after the verification ladder`;
  } else reason = seal.reason;
  return { checks, sealed, reason, status: sealed ? "sealed" : "rejected" };
}

// ───────────────────────────────── chain facts (what the server reads from the hashed payloads)

export interface FrameFact {
  seq: number;
  t: number;
  sha: string;
  wid: string | null;
  jpegB64: string;
}

export interface WitnessRequest {
  wid: string;
  t: number;
  ask: string;
  kind: string;
  by: string;
  /** v4: the plan requirement this request serves (optional trailing key of the witness event). */
  rid: string | null;
  answer: { t: number; via: string; text?: string; frameSeq?: number } | null;
  skip: { t: number; reason?: string } | null;
}

export interface VideoFact {
  t: number;
  sha256: string;
  bytes: number | null;
  durationMs: number | null;
  startedAt: number | null;
  name: string | null;
}

export interface ChainFacts {
  startT: number | null;
  endT: number | null;
  frames: FrameFact[];
  gps: Payload["gps"];
  motion: Payload["motion"];
  witness: WitnessRequest[];
  videos: VideoFact[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Reads frames, GPS, motion, witness requests/answers and video events from the chunks (sorted by seq). */
export function chainFacts(rawChunks: ChunkDoc[]): ChainFacts {
  const chunks = rawChunks.slice().sort((a, b) => a.seq - b.seq);
  const out: ChainFacts = { startT: null, endT: null, frames: [], gps: [], motion: [], witness: [], videos: [] };
  if (chunks.length) {
    out.startT = chunks[0].t0;
    out.endT = chunks[chunks.length - 1].t1;
  }
  const byWid = new Map<string, WitnessRequest>();
  for (const c of chunks) {
    const p = parsePayload(c.payload);
    if (!p) continue;
    out.gps.push(...p.gps);
    out.motion.push(...p.motion);
    const frameEvent = p.events.find((e) => e.type === "frame");
    if (p.frameSha && c.frame && typeof c.frame.jpegB64 === "string") {
      out.frames.push({ seq: c.seq, t: num(c.frame.t) ?? c.t1, sha: p.frameSha, wid: str(frameEvent?.wid) || null, jpegB64: c.frame.jpegB64 });
    }
    for (const e of p.events) {
      const wid = str(e.wid);
      if (e.type === "witness" && wid && !byWid.has(wid)) {
        const w: WitnessRequest = { wid, t: e.t, ask: str(e.ask).slice(0, 200), kind: str(e.kind), by: str(e.by), rid: str(e.rid) || null, answer: null, skip: null };
        byWid.set(wid, w);
        out.witness.push(w);
      } else if (e.type === "witness_answer" && byWid.has(wid)) {
        const w = byWid.get(wid)!;
        if (!w.answer && !w.skip) {
          const via = str(e.via);
          w.answer = { t: e.t, via, ...(typeof e.text === "string" ? { text: e.text.slice(0, 200) } : {}) };
          if (via === "frame" && p.frameSha && c.frame) w.answer.frameSeq = c.seq;
        }
      } else if (e.type === "witness_skip" && byWid.has(wid)) {
        const w = byWid.get(wid)!;
        if (!w.answer && !w.skip) w.skip = { t: e.t, ...(typeof e.reason === "string" ? { reason: e.reason } : {}) };
      } else if (e.type === "video" && /^[0-9a-f]{64}$/.test(str(e.sha256))) {
        out.videos.push({ t: e.t, sha256: str(e.sha256), bytes: num(e.bytes), durationMs: num(e.durationMs), startedAt: num(e.startedAt), name: str(e.name) || null });
      }
    }
  }
  return out;
}

/** v3.8 feed: witness counts, recounted from the chain (the client's `witness` field is informational). */
export function witnessCounts(f: ChainFacts): { asked: number; answered: number; skipped: number } {
  return {
    asked: f.witness.length,
    answered: f.witness.filter((w) => w.answer).length,
    skipped: f.witness.filter((w) => w.skip).length,
  };
}

// ───────────────────────────────── module eligibility

export interface IntentionLike {
  text?: string;
  category?: string;
  quantities?: Array<{ metric?: string; value?: number; unit?: string; measuredBy?: string }>;
  [k: string]: unknown;
}

/** Returns the `details.reason` for the first unmet need (`needs_<need>`), or null when every need is met. */
export function unmetNeed(mod: Pick<ModuleDef, "needs">, facts: ChainFacts, intention: IntentionLike | null | undefined): string | null {
  for (const n of mod.needs as Need[]) {
    const ok =
      n === "frames" ? facts.frames.length > 0
      : n === "gps" ? facts.gps.length > 0
      : n === "witness_answered" ? facts.witness.some((w) => w.answer)
      : n === "quantities" ? Array.isArray(intention?.quantities) && intention!.quantities!.length > 0
      : n === "video" ? facts.videos.length > 0
      : false;
    if (!ok) return `needs_${n}`;
  }
  return null;
}

// ───────────────────────────────── code-computed evidence for modules

/** Solar elevation in degrees (NOAA approximation, accurate to well under a degree). */
export function sunElevationDeg(lat: number, lng: number, epochMs: number): number {
  const rad = Math.PI / 180;
  const jd = epochMs / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lng) * rad;
  const ha = lst - ra;
  const el = Math.asin(Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha));
  return el / rad;
}

/** Nearest GPS fix (by time) to t, or null. */
export function gpsAt(gps: Payload["gps"], t: number): { lat: number; lng: number } | null {
  let best: Payload["gps"][number] | null = null;
  for (const g of gps) if (!best || Math.abs(g[0] - t) < Math.abs(best[0] - t)) best = g;
  return best ? { lat: best[1], lng: best[2] } : null;
}

export function gpsDistanceM(gps: Payload["gps"]): number {
  let d = 0;
  for (let i = 1; i < gps.length; i++) d += haversineM(gps[i - 1][1], gps[i - 1][2], gps[i][1], gps[i][2]);
  return d;
}

/**
 * Counts repetitions (steps, strokes, reps) in the motion stream: peaks of the acceleration magnitude above
 * mean + 1 std, at least 0.3 s apart. Rough on purpose: it is evidence for the model, not a verdict.
 */
export function countMotionReps(motion: Payload["motion"]): { reps: number; seconds: number; cadencePerMin: number } {
  if (motion.length < 3) return { reps: 0, seconds: 0, cadencePerMin: 0 };
  const mag = motion.map((s) => Math.hypot(s[1], s[2], s[3]));
  const mean = mag.reduce((a, b) => a + b, 0) / mag.length;
  const sd = Math.sqrt(mag.reduce((a, b) => a + (b - mean) ** 2, 0) / mag.length);
  const thr = mean + sd;
  let reps = 0;
  let lastPeak = -Infinity;
  for (let i = 1; i < mag.length - 1; i++) {
    if (mag[i] > thr && mag[i] >= mag[i - 1] && mag[i] > mag[i + 1] && motion[i][0] - lastPeak >= 300) {
      reps++;
      lastPeak = motion[i][0];
    }
  }
  const seconds = (motion[motion.length - 1][0] - motion[0][0]) / 1000;
  return { reps, seconds: Math.round(seconds), cadencePerMin: seconds > 0 ? Math.round((reps / seconds) * 60) : 0 };
}

/** Pick at most `max` frames evenly, always keeping the first and last. */
export function pickFrames<T>(frames: T[], max: number): T[] {
  if (frames.length <= max) return frames.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(frames[Math.round((i * (frames.length - 1)) / (max - 1))]);
  return out;
}

/** Approximate local solar time label from longitude (no timezone database needed). */
export function localTimeLabel(epochMs: number, lng: number | null): string {
  const offsetH = lng == null ? 0 : Math.round(lng / 15);
  const d = new Date(epochMs + offsetH * 3_600_000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const iso = d.toISOString().slice(0, 16);
  return `${iso} ${days[d.getUTCDay()]} (UTC${offsetH >= 0 ? "+" : ""}${offsetH}, approx. from longitude)`;
}
