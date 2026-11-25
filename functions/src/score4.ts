// v4.5 per-claim scoring, "minimum evidence + no cheating = bar", and the v4.6 seal reason. Deterministic, pure, no
// Firebase imports. A line-by-line port of the reference implementation shared/make-test-vectors-v4.mjs (`scoreV4`);
// test/score4.test.ts replays every case of shared/test-vectors-v4.json against it.
import {
  BACKED_CONFIDENCE,
  CHEATING_CAP,
  Claim,
  ClaimKind,
  ClaimScore,
  DEFAULT_BASELINE,
  DEFAULT_MOTION_SECONDS,
  GPS_FIX_MAX_ACCURACY_M,
  MAX_CHEATING_SIGNALS,
  ModuleClaimOutcome,
  Requirement,
  VerdictForClaim,
} from "./v4";

export interface Integrity {
  chain: boolean;
  timing: boolean;
  physics: boolean;
  frames: boolean;
}

export interface ClipFact {
  sha256: string;
  durationMs: number;
  uploaded: boolean;
  hashOk: boolean | null;
}

export interface ScoreFacts {
  integrity: Integrity;
  frameCount: number;
  /** GPS fixes with accuracy ≤ 100 m. */
  gpsFixes: number;
  /** last t − first t of the non-zero motion samples, in seconds. */
  motionSeconds: number;
  clips: ClipFact[];
  witness: Array<{ wid: string; rid: string | null; answered: boolean }>;
}

export interface JudgeLike {
  verdict: string;
  confidence: number;
  reasons?: string[];
  claims?: Array<{ id: string; verdict: string; confidence: number }>;
}

export interface VideoReviewLike {
  status: string;
  claims?: VerdictForClaim[];
  cheating?: { detected: boolean; signals?: string[] };
}

/** One ladder run as the scorer sees it: the claims it backs (ids), its strength and its per-claim verdicts. */
export interface LadderInput {
  module: string;
  strength: number;
  backs: ClaimKind[];
  targetedOnly?: boolean;
  claims: Array<{ id: string; verdict: string; confidence: number }>;
}

export interface ScoreInput {
  bar: number;
  baseline: number | null;
  claims: Claim[];
  requirements: Requirement[];
  facts: ScoreFacts;
  judge: JudgeLike | null | undefined;
  skeptic: { verdict: string; confidence?: number; reasons?: string[] } | null | undefined;
  videoReview: VideoReviewLike | null | undefined;
  ladder?: LadderInput[];
}

export interface LadderStep {
  module: string;
  before: number;
  after: number;
  passed: boolean;
  claims: Array<{ id: string; passed: boolean; before: number; after: number }>;
}

export interface ChecksV4 {
  chain: boolean;
  timing: boolean;
  physics: boolean;
  frames: boolean;
  ai: boolean;
  cheating: boolean;
  bar: boolean;
}

export interface ScoreResult {
  baselineUsed: number;
  cheating: { detected: boolean; signals: string[] };
  claims: ClaimScore[];
  ladder: LadderStep[];
  score: number;
  checks: ChecksV4;
  sealed: boolean;
  verified: boolean;
  ladderEligible: boolean;
  claimsBacked: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const backedVerdict = (v: { verdict?: string; confidence?: unknown } | null | undefined): boolean =>
  !!v && v.verdict === "backed" && typeof v.confidence === "number" && v.confidence >= BACKED_CONFIDENCE;

export function framesBack(input: Pick<ScoreInput, "judge" | "facts">, claimId: string): boolean {
  const j = input.judge;
  if (!j || input.facts.frameCount < 1) return false;
  if (Array.isArray(j.claims) && j.claims.length > 0) return backedVerdict(j.claims.find((c) => c.id === claimId));
  return j.verdict === "consistent" && j.confidence >= BACKED_CONFIDENCE;
}

export function videoBacks(input: Pick<ScoreInput, "videoReview" | "facts">, claimId: string): boolean {
  const r = input.videoReview;
  if (!r || r.status !== "done") return false;
  if (!input.facts.clips.some((c) => c.uploaded && c.hashOk === true)) return false;
  return backedVerdict((r.claims ?? []).find((c) => c.id === claimId));
}

export function requirementMet(input: ScoreInput, req: Requirement): boolean {
  const f = input.facts;
  switch (req.evidence) {
    case "video": {
      const min = (req.minSeconds ?? 0) * 1000;
      const long = f.clips.some((c) => c.uploaded && c.hashOk === true && c.durationMs > 0 && c.durationMs >= min);
      return long && videoBacks(input, req.claimId);
    }
    case "frames":
      return framesBack(input, req.claimId);
    case "gps":
      return f.gpsFixes >= 1;
    case "motion":
      return f.motionSeconds >= (req.minSeconds || DEFAULT_MOTION_SECONDS);
    case "witness":
      return f.witness.some((w) => w.answered && (w.rid === req.id || w.rid == null));
    default:
      return false;
  }
}

export function cheatingOf(input: ScoreInput): { detected: boolean; signals: string[] } {
  const signals: string[] = [];
  const i = input.facts.integrity;
  if (!i.chain) signals.push("chain: hashes do not link");
  if (!i.timing) signals.push("timing: clock does not add up");
  if (!i.physics) signals.push("physics: impossible movement");
  if (input.skeptic?.verdict === "inconsistent") signals.push("skeptic: " + (input.skeptic.reasons?.[0] ?? "fake signal"));
  if (input.facts.clips.some((c) => c.uploaded && c.hashOk === false)) signals.push("video: clip does not match the chain");
  const rc = input.videoReview?.status === "done" ? input.videoReview.cheating : null;
  if (rc?.detected) {
    if (rc.signals?.length) for (const s of rc.signals) signals.push("video: " + s);
    else signals.push("video: cheating detected");
  }
  return { detected: signals.length > 0, signals: signals.slice(0, MAX_CHEATING_SIGNALS) };
}

/** Claims a ladder module moves: kind in backs; targetedOnly (witness_review) only claims an answered request targeted. */
export function claimsBackedByModule(
  claims: Claim[],
  requirements: Requirement[],
  witness: ScoreFacts["witness"],
  mod: { backs: ClaimKind[]; targetedOnly?: boolean },
): string[] {
  let ids = claims.filter((c) => mod.backs.includes(c.kind)).map((c) => c.id);
  if (mod.targetedOnly) {
    const answered = witness.filter((w) => w.answered);
    if (!answered.some((w) => w.rid == null)) {
      const targeted = new Set(requirements.filter((r) => answered.some((w) => w.rid === r.id)).map((r) => r.claimId));
      ids = ids.filter((id) => targeted.has(id));
    }
  }
  return ids;
}

/** Claim state after the seal's step 3, before the ladder: what verification.claims keeps as `sealP`. */
export interface SealClaim {
  id: string;
  met: string[];
  unmet: string[];
  minimumMet: boolean;
  backedBy: string[];
  sealP: number;
}

/**
 * v4.5 step 4-5: ladder modules in run order on the uncapped p (from sealP), only for the claims each backs
 * (`backedIds`; a missing verdict is a fail), then the cheating cap on the reported values.
 */
export function applyLadderV4(
  base: SealClaim[],
  cheatingDetected: boolean,
  modules: Array<{ module: string; strength: number; backedIds: string[]; claims: Array<{ id: string; verdict: string; confidence: number }> }>,
): { claims: ClaimScore[]; ladder: LadderStep[]; score: number } {
  const claims = base.map((c) => ({ ...c, met: [...c.met], unmet: [...c.unmet], backedBy: [...c.backedBy], p: c.sealP }));
  const capped = (p: number) => (cheatingDetected ? Math.min(p, CHEATING_CAP) : p);
  const scoreOf = () => Math.min(...claims.map((c) => capped(c.p)));
  const ladder: LadderStep[] = [];
  for (const mod of modules) {
    const before = scoreOf();
    const moved: LadderStep["claims"] = [];
    for (const c of claims) {
      if (!mod.backedIds.includes(c.id)) continue;
      const v = mod.claims.find((x) => x.id === c.id);
      const pass = backedVerdict(v);
      const b = capped(c.p);
      c.p = pass ? c.p + mod.strength * (1 - c.p) : c.p * (1 - mod.strength);
      if (pass) c.backedBy.push(mod.module);
      moved.push({ id: c.id, passed: pass, before: b, after: capped(c.p) });
    }
    ladder.push({ module: mod.module, before, after: scoreOf(), passed: moved.length > 0 && moved.every((m) => m.passed), claims: moved });
  }
  for (const c of claims) c.p = capped(c.p);
  const out: ClaimScore[] = claims.map(({ id, p, sealP, met, unmet, minimumMet, backedBy }) => ({ id, p, sealP, met, unmet, minimumMet, backedBy }));
  return { claims: out, ladder, score: scoreOf() };
}

export function scoreV4(input: ScoreInput): ScoreResult {
  const bar = input.bar;
  const baseline = input.baseline == null ? DEFAULT_BASELINE : clamp01(input.baseline);
  const cheating = cheatingOf(input);

  const base: SealClaim[] = input.claims.map((c) => {
    const reqs = input.requirements.filter((r) => r.claimId === c.id);
    const met = reqs.filter((r) => requirementMet(input, r)).map((r) => r.id);
    const unmet = reqs.filter((r) => !met.includes(r.id)).map((r) => r.id);
    const backedBy: string[] = [];
    if (videoBacks(input, c.id)) backedBy.push("video_review");
    if (framesBack(input, c.id)) backedBy.push("frames_judge");
    for (const ev of ["gps", "motion", "witness"]) if (reqs.some((r) => r.evidence === ev && met.includes(r.id))) backedBy.push(ev);
    let p = baseline;
    const minimumMet = reqs.length > 0 && unmet.length === 0;
    if (minimumMet && !cheating.detected) p = Math.max(p, bar);
    return { id: c.id, met, unmet, minimumMet, backedBy, sealP: p };
  });
  const modules = (input.ladder ?? []).map((m) => ({
    module: m.module,
    strength: m.strength,
    backedIds: claimsBackedByModule(input.claims, input.requirements, input.facts.witness, m),
    claims: m.claims ?? [],
  }));
  const { claims, ladder, score } = applyLadderV4(base, cheating.detected, modules);

  const integ = input.facts.integrity;
  const checks: ChecksV4 = {
    chain: integ.chain,
    timing: integ.timing,
    physics: integ.physics,
    frames: integ.frames,
    ai: !(input.judge?.verdict === "inconsistent" && input.judge.confidence >= BACKED_CONFIDENCE),
    cheating: !cheating.detected,
    bar: claims.every((c) => c.p >= bar),
  };
  const sealed = Object.values(checks).every(Boolean);
  return {
    baselineUsed: baseline,
    cheating,
    claims,
    ladder,
    score,
    checks,
    sealed,
    verified: sealed,
    ladderEligible: integ.chain && integ.timing && integ.physics && integ.frames && !cheating.detected,
    claimsBacked: claims.filter((c) => c.p >= bar).length,
  };
}

/** Re-evaluates checks.bar / sealed after a ladder run (integrity, ai and cheating never change). */
export function recheck(checks: ChecksV4, claims: ClaimScore[], bar: number): { checks: ChecksV4; sealed: boolean; claimsBacked: number } {
  const next = { ...checks, bar: claims.every((c) => c.p >= bar) };
  return { checks: next, sealed: Object.values(next).every(Boolean), claimsBacked: claims.filter((c) => c.p >= bar).length };
}

/**
 * v4.6 seal reason (UI words, first that applies): cheating → "Cheating detected: …"; an integrity check → the v3
 * reason; !ai → "The proof frames contradict the intention"; !bar → "<k> of <n> claims backed · <lowest> <p> < bar
 * <bar>"; sealed → "All <n> claims backed · score <s> ≥ bar <bar>".
 */
export function reasonV4(
  checks: ChecksV4,
  signals: string[],
  integrityReason: string | null,
  claims: ClaimScore[],
  claimTexts: Map<string, string>,
  bar: number,
  score: number,
): string {
  if (!checks.cheating) return "Cheating detected: " + signals.join("; ");
  if (!(checks.chain && checks.timing && checks.physics && checks.frames)) return integrityReason ?? "Integrity check failed";
  if (!checks.ai) return "The proof frames contradict the intention";
  const n = claims.length;
  if (!checks.bar) {
    const k = claims.filter((c) => c.p >= bar).length;
    let low = claims[0];
    for (const c of claims) if (c.p < low.p) low = c;
    return `${k} of ${n} claims backed · ${claimTexts.get(low.id) ?? low.id} ${low.p.toFixed(2)} < bar ${bar.toFixed(2)}`;
  }
  return `All ${n} claims backed · score ${score.toFixed(2)} ≥ bar ${bar.toFixed(2)}`;
}

/** Builds the per-claim outcomes of one module run for its LadderResult (v4.6). */
export function moduleOutcomes(
  step: LadderStep,
  verdicts: VerdictForClaim[],
): ModuleClaimOutcome[] {
  return step.claims.map((m) => {
    const v = verdicts.find((x) => x.id === m.id);
    const out: ModuleClaimOutcome = {
      id: m.id,
      verdict: v ? v.verdict : "missing",
      confidence: v ? v.confidence : 0,
      passed: m.passed,
      before: m.before,
      after: m.after,
      reasons: (v?.reasons ?? []).slice(0, 2),
    };
    if (v?.measured) out.measured = v.measured;
    return out;
  });
}

/** GPS fixes with accuracy ≤ 100 m, as the `gps` requirement counts them. */
export function goodGpsFixes(gps: Array<[number, number, number, number | null, ...unknown[]]>): number {
  return gps.filter((g) => typeof g[3] === "number" && g[3] <= GPS_FIX_MAX_ACCURACY_M).length;
}

/** Seconds spanned by the motion samples that are not all zero (last t − first t). */
export function motionSeconds(motion: Array<number[]>): number {
  const nz = motion.filter((s) => s.slice(1).some((v) => typeof v === "number" && v !== 0));
  if (nz.length < 2) return 0;
  return (nz[nz.length - 1][0] - nz[0][0]) / 1000;
}
