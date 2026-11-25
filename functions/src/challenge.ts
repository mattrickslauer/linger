// v5 crowd rebuttals (docs/ARCHITECTURE.md v5): pure rules. Request validation, anchors, who may rebut, the round
// state machine, the rate limit, model-answer coercion and the deterministic outcome (reference:
// shared/make-test-vectors-v5.mjs). No Firebase app needed, so unit tests import this directly.
import { asNumber, asStrings } from "./ai";
import { fail } from "./callable";
import type { ChainFacts } from "./ladder";
import { clamp01, round2 } from "./ladder";
import type { MomentDoc } from "./seal";

export const REBUTTAL_THRESHOLD = 3;
export const MAX_REBUTTALS_PER_DAY = 10;
export const RATE_WINDOW_MS = 24 * 3_600_000;
export const MAX_CHALLENGE_TRIES = 3;
export const CHALLENGE_LEASE_MS = 300_000;
export const HOLD_CONFIDENCE = 0.6;
export const MAX_TEXT = 240;
export const MAX_REVIEW_FRAMES = 8;

export const CATEGORIES = ["staged", "edited", "wrong_object", "wrong_count", "wrong_place", "wrong_time", "reused", "other"] as const;
export type RebuttalCategory = (typeof CATEGORIES)[number];
export type AnchorKind = "frame" | "clip" | "track" | "claim";

export interface Anchor {
  claimId: string;
  kind: AnchorKind;
  frameSeq?: number;
  clipSha?: string;
  clipMs?: number;
  trackIndex?: number;
}

export type ChallengeStatus = "open" | "reviewing" | "survived" | "overturned";
export type RoundOutcome = "survived" | "overturned" | "error" | "moot";

export interface RoundRecord {
  round: number;
  threshold: number;
  outcome: RoundOutcome;
  summary: string | null;
  at: number;
  upheld: number;
  total: number;
}

export interface ChallengeDoc {
  round: number;
  threshold: number;
  accepted: number;
  status: ChallengeStatus;
  tries: number;
  rebutters: string[];
  rounds: RoundRecord[];
}

export type RebuttalVerdict = "pending" | "upheld" | "dismissed" | "unclear" | "void";

export interface RebuttalRequest {
  momentId: string;
  anchor: Anchor;
  text: string;
  category: RebuttalCategory;
  note: string;
  draftedOnDevice: boolean;
}

export interface ClaimLite {
  id: string;
  text: string;
  kind?: string;
}

export interface ReviewAnswer {
  rebuttals: Array<{ id: string; verdict: "upheld" | "dismissed" | "unclear"; confidence: number; reason: string }>;
  claims: Array<{ id: string; verdict: "backed" | "not_backed" | "unclear"; confidence: number; reasons: string[] }>;
  cheating: { detected: boolean; signals: string[] };
  summary: string;
}

export interface Outcome {
  outcome: "overturned" | "survived";
  fallen: string[];
  holding: string[];
  reason: string | null;
}

/** Round n needs 3·2^(n−1) accepted rebuttals (3, 6, 12, …). */
export const thresholdFor = (round: number): number => REBUTTAL_THRESHOLD * 2 ** (Math.max(1, Math.floor(round)) - 1);

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export function validateRebuttalRequest(data: unknown): RebuttalRequest {
  const d = (data ?? {}) as Record<string, unknown>;
  const bad = (why: string) => fail("invalid-argument", "bad_request", why);
  if (typeof d.momentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(d.momentId)) throw bad("momentId is required.");
  const text = typeof d.text === "string" ? d.text.trim() : "";
  if (!text) throw bad("The rebuttal is empty.");
  if (text.length > MAX_TEXT) throw bad(`Keep it under ${MAX_TEXT} characters.`);
  const category = (CATEGORIES as readonly string[]).includes(String(d.category)) ? (d.category as RebuttalCategory) : null;
  if (!category) throw bad("Unknown category.");
  const a = (d.anchor ?? {}) as Record<string, unknown>;
  if (typeof a.claimId !== "string" || !/^c[1-9]$/.test(a.claimId)) throw bad("anchor.claimId is required.");
  const kind = a.kind as AnchorKind;
  const anchor: Anchor = { claimId: a.claimId, kind };
  switch (kind) {
    case "claim":
      break;
    case "frame":
      if (!isInt(a.frameSeq)) throw bad("anchor.frameSeq is required.");
      anchor.frameSeq = a.frameSeq;
      break;
    case "clip":
      if (typeof a.clipSha !== "string" || !/^[0-9a-f]{64}$/.test(a.clipSha) || !isInt(a.clipMs)) throw bad("anchor.clipSha and clipMs are required.");
      anchor.clipSha = a.clipSha;
      anchor.clipMs = a.clipMs;
      break;
    case "track":
      if (!isInt(a.trackIndex)) throw bad("anchor.trackIndex is required.");
      anchor.trackIndex = a.trackIndex;
      break;
    default:
      throw bad("Unknown anchor kind.");
  }
  const note = typeof d.note === "string" ? d.note.trim().slice(0, 500) : "";
  return { momentId: d.momentId, anchor, text, category, note, draftedOnDevice: d.draftedOnDevice === true };
}

/** The claims a Moment can be rebutted on: server claims (v4), else the intention text as `c1` (v3). */
export function claimsOf(m: MomentDoc): ClaimLite[] {
  const items = ((m.claims as { items?: unknown } | undefined)?.items ?? []) as ClaimLite[];
  if (Array.isArray(items) && items.length > 0) return items.map((c) => ({ id: c.id, text: c.text, kind: c.kind }));
  const text = String((m.intention as { text?: unknown } | undefined)?.text ?? "the intention");
  return [{ id: "c1", text, kind: "outcome" }];
}

/** Null when the anchor points at something this Moment has; else a short reason (→ `bad_anchor`). */
export function anchorProblem(
  anchor: Anchor,
  claimIds: string[],
  facts: Pick<ChainFacts, "frames">,
  clips: Array<{ sha256: string; durationMs: number; uploaded: boolean }>,
  trackLen: number,
): string | null {
  if (!claimIds.includes(anchor.claimId)) return "no such claim";
  switch (anchor.kind) {
    case "claim":
      return null;
    case "frame":
      return facts.frames.some((f) => f.seq === anchor.frameSeq) ? null : "no such frame";
    case "clip": {
      const c = clips.find((x) => x.sha256 === anchor.clipSha && x.uploaded);
      if (!c) return "no such clip";
      return (anchor.clipMs ?? -1) >= 0 && (anchor.clipMs ?? 0) <= c.durationMs ? null : "time is outside the clip";
    }
    case "track":
      return (anchor.trackIndex ?? -1) < trackLen ? null : "no such map point";
  }
}

export function challengeOf(m: MomentDoc): ChallengeDoc | null {
  const c = m.challenge as ChallengeDoc | undefined | null;
  return c && typeof c === "object" ? c : null;
}

export const isRevoked = (m: MomentDoc): boolean => !!(m.seal as { revoked?: unknown } | null | undefined)?.revoked;

/** Who may rebut this Moment now: null, or `not_challengeable` / `own_moment` / `already_rebutted`. */
export function challengeableWhy(m: MomentDoc | undefined, uid: string): string | null {
  if (!m) return "not_challengeable";
  const seal = m.seal as { sealed?: boolean } | null | undefined;
  if (m.status !== "sealed" || !seal || seal.sealed !== true || isRevoked(m)) return "not_challengeable";
  const c = challengeOf(m);
  if (c && (c.status === "reviewing" || c.status === "overturned")) return "not_challengeable";
  if (m.ownerUid === uid) return "own_moment";
  if (c?.rebutters?.includes(uid)) return "already_rebutted";
  return null;
}

/** Rolling 24 h rate limit: the kept timestamps, and whether one more call is allowed. */
export function rateCheck(times: unknown, now: number): { ok: boolean; kept: number[] } {
  const kept = (Array.isArray(times) ? times : []).filter((t): t is number => typeof t === "number" && now - t < RATE_WINDOW_MS);
  return { ok: kept.length < MAX_REBUTTALS_PER_DAY, kept };
}

/**
 * The challenge after one more accepted rebuttal from `uid`. Starts round 1, or opens the next round (threshold
 * doubled) after a Survived round. `reviewing` = this rebuttal reached the threshold.
 */
export function acceptRebuttal(c: ChallengeDoc | null, uid: string): { next: ChallengeDoc; reviewing: boolean } {
  let base: ChallengeDoc;
  if (!c) base = { round: 1, threshold: thresholdFor(1), accepted: 0, status: "open", tries: 0, rebutters: [], rounds: [] };
  else if (c.status === "survived") base = { ...c, round: c.round + 1, threshold: thresholdFor(c.round + 1), accepted: 0, status: "open", tries: 0 };
  else base = { ...c };
  const accepted = base.accepted + 1;
  const reviewing = accepted >= base.threshold;
  return { next: { ...base, accepted, status: reviewing ? "reviewing" : "open", tries: 0, rebutters: [...(base.rebutters ?? []), uid] }, reviewing };
}

/** Ends the current round without a verdict (`error` after 3 failed reviews, `moot` when the seal dropped): its
 * rebutters are freed and the same round reopens empty. */
export function voidRound(c: ChallengeDoc, outcome: "error" | "moot", roundUids: string[], now: number, summary: string | null = null): ChallengeDoc {
  const drop = new Set(roundUids);
  return {
    ...c,
    accepted: 0,
    status: "open",
    tries: 0,
    rebutters: (c.rebutters ?? []).filter((u) => !drop.has(u)),
    rounds: [...(c.rounds ?? []), { round: c.round, threshold: c.threshold, outcome, summary, at: now, upheld: 0, total: roundUids.length }],
  };
}

export function resolveRound(c: ChallengeDoc, o: Outcome, summary: string, total: number, now: number): ChallengeDoc {
  return {
    ...c,
    status: o.outcome,
    tries: 0,
    rounds: [...(c.rounds ?? []), { round: c.round, threshold: c.threshold, outcome: o.outcome, summary: summary || null, at: now, upheld: o.holding.length, total }],
  };
}

/** The public feed's view of the challenge. */
export function feedChallenge(c: ChallengeDoc | null) {
  if (!c) return null;
  const last = c.rounds?.length ? c.rounds[c.rounds.length - 1] : null;
  const resolved = last && last.round === c.round && (c.status === "survived" || c.status === "overturned");
  return {
    status: c.status,
    round: c.round,
    accepted: c.accepted,
    threshold: c.threshold,
    upheld: resolved ? last.upheld : null,
    summary: resolved ? last.summary : null,
    survived: (c.rounds ?? []).filter((r) => r.outcome === "survived").length,
  };
}

/** The deterministic outcome (reference: shared/make-test-vectors-v5.mjs). */
export function challengeOutcome(input: { rebuttals: Array<{ id: string; claimId: string }>; claims: ClaimLite[]; review: Pick<ReviewAnswer, "rebuttals" | "claims" | "cheating"> }): Outcome {
  const holding: Array<{ id: string; claimId: string }> = [];
  for (const r of input.rebuttals) {
    const v = (input.review.rebuttals ?? []).find((x) => x.id === r.id);
    if (v && v.verdict === "upheld" && typeof v.confidence === "number" && v.confidence >= HOLD_CONFIDENCE) holding.push(r);
  }
  const fallen: string[] = [];
  for (const c of input.claims) {
    if (!holding.some((r) => r.claimId === c.id)) continue;
    const v = (input.review.claims ?? []).find((x) => x.id === c.id);
    if (v && v.verdict === "not_backed" && typeof v.confidence === "number" && v.confidence >= HOLD_CONFIDENCE) fallen.push(c.id);
  }
  const cheating = input.review.cheating?.detected === true;
  if (!(fallen.length > 0 || (cheating && holding.length > 0))) return { outcome: "survived", fallen: [], holding: holding.map((r) => r.id), reason: null };
  const holdReason = (input.review.rebuttals.find((x) => x.id === holding[0].id)?.reason ?? "").trim();
  const signal = ((input.review.cheating?.signals ?? [])[0] ?? "").trim();
  const x = fallen.length > 0 ? input.claims.find((c) => c.id === fallen[0])!.text : signal ? "cheating — " + signal : "cheating detected";
  return { outcome: "overturned", fallen, holding: holding.map((r) => r.id), reason: "Overturned by challenge: " + x + " · " + holdReason };
}

/** Per-rebuttal verdict as stored: low-confidence "upheld" counts as unclear (it did not hold). */
export function storedVerdict(v: ReviewAnswer["rebuttals"][number] | undefined): Exclude<RebuttalVerdict, "pending" | "void"> {
  if (!v) return "unclear";
  if (v.verdict === "upheld") return v.confidence >= HOLD_CONFIDENCE ? "upheld" : "unclear";
  return v.verdict;
}

// ───────────────────────────────── model answer coercion (the model proposes; code validates)

export function coerceScreen(data: Record<string, unknown>, given: RebuttalCategory): { accepted: boolean; reason: string; category: RebuttalCategory } {
  const category = (CATEGORIES as readonly string[]).includes(String(data.category)) ? (data.category as RebuttalCategory) : given;
  const reason = typeof data.reason === "string" ? data.reason.trim().slice(0, 120) : "";
  return { accepted: data.accepted === true, reason: reason || (data.accepted === true ? "Specific and checkable." : "Not specific enough to check."), category };
}

export function coerceReview(data: Record<string, unknown>, rebuttalIds: string[], claimIds: string[]): ReviewAnswer {
  if (!Array.isArray(data.rebuttals)) throw new Error("model answer has no rebuttals list");
  const rebuttals: ReviewAnswer["rebuttals"] = [];
  for (const x of data.rebuttals as unknown[]) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!rebuttalIds.includes(id) || rebuttals.some((r) => r.id === id)) continue;
    if (!["upheld", "dismissed", "unclear"].includes(String(o.verdict))) continue;
    rebuttals.push({ id, verdict: o.verdict as "upheld", confidence: round2(clamp01(asNumber(o.confidence, 0))), reason: typeof o.reason === "string" ? o.reason.trim().slice(0, 160) : "" });
  }
  const claims: ReviewAnswer["claims"] = [];
  for (const x of Array.isArray(data.claims) ? (data.claims as unknown[]) : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!claimIds.includes(id) || claims.some((c) => c.id === id)) continue;
    if (!["backed", "not_backed", "unclear"].includes(String(o.verdict))) continue;
    claims.push({ id, verdict: o.verdict as "backed", confidence: round2(clamp01(asNumber(o.confidence, 0))), reasons: asStrings(o.reasons, 2) });
  }
  const ch = (data.cheating ?? {}) as Record<string, unknown>;
  const detected = ch.detected === true;
  return {
    rebuttals,
    claims,
    cheating: { detected, signals: detected ? asStrings(ch.signals, 4, 120) : [] },
    summary: typeof data.summary === "string" ? data.summary.trim().slice(0, 160) : "",
  };
}

/** Frames for the review: every anchored frame first (chain order), then evenly picked others, ≤ 8 in all. */
export function framesForReview<T extends { seq: number }>(frames: T[], anchoredSeqs: number[], max = MAX_REVIEW_FRAMES): T[] {
  const want = new Set(anchoredSeqs);
  const anchored = frames.filter((f) => want.has(f.seq)).slice(0, max);
  const rest = frames.filter((f) => !want.has(f.seq));
  const room = max - anchored.length;
  const picked: T[] = [];
  if (room > 0 && rest.length > 0) {
    if (rest.length <= room) picked.push(...rest);
    else if (room === 1) picked.push(rest[0]);
    else for (let i = 0; i < room; i++) picked.push(rest[Math.round((i * (rest.length - 1)) / (room - 1))]);
  }
  return [...anchored, ...picked].sort((a, b) => a.seq - b.seq);
}
