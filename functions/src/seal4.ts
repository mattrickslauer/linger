// Seal v4 (docs/ARCHITECTURE.md v4.3 - v4.8): readiness, the evaluation that turns chain facts + server claims/plan +
// the video review into per-claim scores, the seal/verification documents and the feed v4 fields. Pure: no Firebase.
import { ChainFacts, chainFacts } from "./ladder";
import { ChunkDoc, MomentDoc, SealResult, barValueOf, baselineOf, evaluateSeal } from "./seal";
import { ChecksV4, ScoreFacts, ScoreResult, applyLadderV4, goodGpsFixes, motionSeconds, reasonV4, recheck, scoreV4 } from "./score4";
import { Claim, ClaimScore, ClaimsSource, Plan, SEAL_VERSION_V4, VIDEO_REVIEW_STRENGTH, VIDEO_WAIT_MS, VerdictForClaim, VideoReview } from "./v4";

export type ServerClaimsDoc = { items: Claim[]; source: ClaimsSource; model: string | null; ranAt: number };
export type ServerPlanDoc = Plan & { source: ClaimsSource };

const unsealed = (m: Partial<MomentDoc>) => m.seal === null || m.seal === undefined;

/** v4.3: bar + claims + plan run while submitted and (bar == null or claims == null). */
export function needsBarAndClaims(m: Partial<MomentDoc> | undefined | null): boolean {
  return !!m && m.status === "submitted" && unsealed(m) && (m.bar == null || m.claims == null);
}

export const TERMINAL_REVIEW = ["done", "failed", "expired", "none"];

/** v4.4: the video review still has work to do (never run, waiting for a clip, or running/retrying). */
export function needsVideoReview(m: Partial<MomentDoc> | undefined | null): boolean {
  if (!m || m.status !== "submitted" || !unsealed(m) || m.claims == null || m.plan == null) return false;
  const vr = m.videoReview as Partial<VideoReview> | null | undefined;
  return !vr || !TERMINAL_REVIEW.includes(String(vr.status));
}

/** v4.4 isReadyToSeal: submitted && judge && skeptic && bar && claims && plan && videoReview terminal && !seal. */
export function isReadyToSealV4(m: Partial<MomentDoc> | undefined | null): boolean {
  if (!m || m.status !== "submitted" || !unsealed(m)) return false;
  const vr = m.videoReview as Partial<VideoReview> | null | undefined;
  return !!m.judge && !!m.skeptic && m.bar != null && m.claims != null && m.plan != null && !!vr && TERMINAL_REVIEW.includes(String(vr.status));
}

/** v4.4: has a Moment waited for its clip(s) longer than 24 h (from submittedAtServer, else endedAt)? */
export function videoWaitExpired(submittedAtMs: number | null, now: number): boolean {
  return typeof submittedAtMs === "number" && Number.isFinite(submittedAtMs) && now - submittedAtMs >= VIDEO_WAIT_MS;
}

/** Scoring facts from the chain, the integrity checks and the video review's clip list. */
export function scoreFacts(facts: ChainFacts, r: Pick<SealResult, "checks" | "summary">, vr: Partial<VideoReview> | null | undefined): ScoreFacts {
  return {
    integrity: { chain: r.checks.chain, timing: r.checks.timing, physics: r.checks.physics, frames: r.checks.frames },
    frameCount: r.summary.frameCount,
    gpsFixes: goodGpsFixes(facts.gps as never),
    motionSeconds: motionSeconds(facts.motion as never),
    clips: (vr?.clips ?? []).map((c) => ({ sha256: c.sha256, durationMs: Number(c.durationMs) || 0, uploaded: !!c.uploaded, hashOk: c.hashOk ?? null })),
    witness: facts.witness.map((w) => ({ wid: w.wid, rid: w.rid, answered: !!w.answer })),
  };
}

export interface SealV4Evaluation {
  base: SealResult;
  facts: ChainFacts;
  score: ScoreResult;
  claims: Claim[];
  plan: Plan;
  bar: number;
  baseline: number | null;
  reason: string;
  integrityReason: string | null;
}

/** The first integrity failure in the v3 words ("Chain: …", "Timing: …", "Physics: …", "Frames: …"). */
function integrityReasonOf(r: SealResult): string | null {
  return r.failures.find((f) => /^(Chain|Timing|Physics|Frames): /.test(f)) ?? null;
}

export function evaluateSealV4(momentId: string, m: MomentDoc, chunks: ChunkDoc[]): SealV4Evaluation {
  const base = evaluateSeal(momentId, m, chunks);
  const facts = chainFacts(chunks);
  const claims = ((m.claims as ServerClaimsDoc | undefined)?.items ?? []) as Claim[];
  const plan = (m.plan as ServerPlanDoc | undefined) ?? { requirements: [], recordMode: "photo", note: "" };
  const vr = m.videoReview as Partial<VideoReview> | null | undefined;
  const bar = barValueOf(m.bar);
  const baseline = baselineOf(m.score);
  const score = scoreV4({
    bar,
    baseline,
    claims,
    requirements: plan.requirements ?? [],
    facts: scoreFacts(facts, base, vr),
    judge: m.judge as never,
    skeptic: m.skeptic,
    videoReview: vr ? { status: String(vr.status), claims: vr.claims ?? [], cheating: vr.cheating } : null,
    ladder: [],
  });
  const lifted = liftVideoBacked(score, bar);
  const integrityReason = integrityReasonOf(base);
  const texts = new Map(claims.map((c) => [c.id, c.text]));
  const reason = videoAwareReason(
    reasonV4(lifted.checks, lifted.cheating.signals, integrityReason, lifted.claims, texts, bar, lifted.score),
    lifted.checks,
    lifted.claims,
    texts,
    vr,
  );
  return { base, facts, score: lifted, claims, plan, bar, baseline, reason, integrityReason };
}

/**
 * v4.13: a video intention is decided by the clip, not the still frames. The frames scorer's baseline cannot hear or
 * count, so a claim the free video review backs is lifted past the bar by the full_video strength (the same step as
 * the paid module: p + s·(1 − p)) instead of sitting exactly on it. Baked into sealP so later ladder runs start from
 * it. Never under cheating (the cap would discard it anyway).
 */
export function liftVideoBacked(score: ScoreResult, bar: number): ScoreResult {
  if (score.cheating.detected || !score.claims.some((c) => c.backedBy.includes("video_review"))) return score;
  const base = score.claims.map((c) => ({
    ...c,
    sealP: c.backedBy.includes("video_review") ? c.sealP + VIDEO_REVIEW_STRENGTH * (1 - c.sealP) : c.sealP,
  }));
  const { claims, score: s } = applyLadderV4(base, false, []);
  const re = recheck(score.checks, claims, bar);
  return { ...score, claims, score: s, checks: re.checks, sealed: re.sealed, verified: re.sealed, claimsBacked: re.claimsBacked };
}

/** The video reviewer's verdict on one claim, when the review is done and gave a reason. */
function videoVerdict(vr: Partial<VideoReview> | null | undefined, id: string): VerdictForClaim | null {
  if (!vr || vr.status !== "done") return null;
  return (vr.claims ?? []).find((c) => c.id === id && (c.reasons?.length ?? 0) > 0) ?? null;
}

/**
 * v4.13: when the bar is the only failing check and the video reviewer turned the lowest claim down, say why in the
 * reviewer's words ("0 of 1 claims backed · singing the ABC's: mixed up the letters after S") instead of quoting the
 * still-frame baseline ("0.38 < bar 0.52"), which reads as if the frames decided it.
 */
export function videoAwareReason(
  reason: string,
  checks: ChecksV4,
  claims: ClaimScore[],
  claimTexts: Map<string, string>,
  vr: Partial<VideoReview> | null | undefined,
): string {
  const othersPass = checks.chain && checks.timing && checks.physics && checks.frames && checks.ai && checks.cheating;
  if (!othersPass || checks.bar || claims.length === 0) return reason;
  let low = claims[0];
  for (const c of claims) if (c.p < low.p) low = c;
  const v = videoVerdict(vr, low.id);
  if (!v || v.verdict === "backed") return reason;
  return `${reason.split(" · ")[0]} · ${claimTexts.get(low.id) ?? low.id}: ${v.reasons![0]}`;
}

/** v4.13 feed reasons: for a reviewed video the reviewer's per-claim reasons (then its summary) lead, not the frames'. */
export function feedScoreReasons(frameReasons: string[] | undefined, vr: Partial<VideoReview> | null | undefined): string[] {
  if (!vr || vr.status !== "done") return frameReasons ?? [];
  const out = (vr.claims ?? []).map((c) => c.reasons?.[0]).filter((r): r is string => !!r);
  if (vr.summary) out.push(vr.summary);
  return out.length ? out : frameReasons ?? [];
}

export function sealDocV4(e: Pick<SealV4Evaluation, "score" | "reason">, now: unknown) {
  return {
    sealed: e.score.sealed,
    at: now,
    updatedAt: now,
    checks: e.score.checks,
    reason: e.reason,
    version: SEAL_VERSION_V4,
    ladderEligible: e.score.ladderEligible,
    cheatingSignals: e.score.cheating.signals,
  };
}

export function verificationDocV4(e: Pick<SealV4Evaluation, "score" | "bar" | "baseline">, now: unknown) {
  return {
    version: SEAL_VERSION_V4,
    baseline: e.baseline,
    baselineUsed: e.score.baselineUsed,
    score: e.score.score,
    bar: e.bar,
    verified: e.score.verified,
    cheating: e.score.cheating,
    claimsBacked: e.score.claimsBacked,
    claims: e.score.claims,
    modules: [] as unknown[],
    updatedAtServer: now,
  };
}

/** v4.8 feed fields derived from the claims, the per-claim scores, the plan and the video review. */
const CLIP_CONTENT_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

export interface FeedClip {
  path: string;
  sha256: string;
  ext: string;
  contentType: string;
  durationMs: number;
  hashOk: boolean | null;
}

/** v4.12: the uploaded clips of the video review (ext != null), chain order, as playable Storage paths. */
export function feedVideoClips(ownerUid: string | null | undefined, momentId: string, vr: Partial<VideoReview> | null | undefined): FeedClip[] {
  if (!ownerUid) return [];
  return (vr?.clips ?? [])
    .filter((c) => c.ext != null && CLIP_CONTENT_TYPES[c.ext] != null)
    .map((c) => ({
      path: `clips/${ownerUid}/${momentId}/${c.sha256}.${c.ext}`,
      sha256: c.sha256,
      ext: c.ext as string,
      contentType: CLIP_CONTENT_TYPES[c.ext as string],
      durationMs: typeof c.durationMs === "number" ? c.durationMs : 0,
      hashOk: c.hashOk ?? null,
    }));
}

export function feedV4Fields(
  claims: Claim[],
  claimScores: ClaimScore[],
  plan: Plan,
  bar: number,
  checks: ChecksV4,
  signals: string[],
  vr: Partial<VideoReview> | null | undefined,
  owner?: { uid: string | null | undefined; momentId: string },
) {
  const met = new Set(claimScores.flatMap((c) => c.met));
  return {
    sealVersion: SEAL_VERSION_V4,
    claims: claims.map((c) => {
      const s = claimScores.find((x) => x.id === c.id);
      const p = s?.p ?? 0;
      return {
        id: c.id,
        kind: c.kind,
        text: c.text,
        p,
        backed: p >= bar,
        backedBy: s?.backedBy ?? [],
        met: s?.met.length ?? 0,
        total: (s?.met.length ?? 0) + (s?.unmet.length ?? 0),
      };
    }),
    claimsBacked: claimScores.filter((c) => c.p >= bar).length,
    claimsTotal: claims.length,
    cheating: !checks.cheating,
    cheatingSignals: signals,
    video: {
      reviewed: vr?.status === "done",
      summary: vr?.status === "done" ? (vr.summary ?? null) || null : null,
      status: vr?.status ?? "none",
      clips: owner ? feedVideoClips(owner.uid, owner.momentId, vr) : [],
    },
    plan: {
      recordMode: plan.recordMode,
      requirements: (plan.requirements ?? []).map((r) => ({ id: r.id, claimId: r.claimId, evidence: r.evidence, ask: r.ask, met: met.has(r.id) })),
    },
  };
}
