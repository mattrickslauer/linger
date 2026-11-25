// v4 (docs/ARCHITECTURE.md v4.1–v4.6): claims, the evidence plan, the record-screen checklist and the per-claim
// score math. Pure, no Firebase import, so it unit-tests in Node against shared/test-vectors-v4.json.
// The server is authoritative for claims, plan, "met" and the score; the client only drafts, ticks "captured" and
// previews with the same math (scoreV4 is a line-for-line port of shared/make-test-vectors-v4.mjs).

import type { Chunk } from "./types";

export type ClaimKind = "action" | "count" | "measure" | "place" | "time" | "object" | "outcome";
export const CLAIM_KINDS: ClaimKind[] = ["action", "count", "measure", "place", "time", "object", "outcome"];
export type EvidenceKind = "video" | "frames" | "gps" | "motion" | "witness";
export const EVIDENCE: EvidenceKind[] = ["video", "frames", "gps", "motion", "witness"];
export type ClaimVerdict = "backed" | "not_backed" | "unclear";

export const DEFAULT_BASELINE = 0.2;
export const CHEATING_CAP = 0.1;
export const BACKED_CONFIDENCE = 0.6;
export const DEFAULT_MOTION_SECONDS = 10;
export const GPS_FIX_MAX_ACCURACY_M = 100;
export const MAX_CLAIMS = 5;
export const MAX_REQUIREMENTS = 6;
export const MAX_SIGNALS = 6;
/** Clips at or above this size are not uploaded (storage.rules: < 200 MB); their requirements stay unmet. */
export const MAX_CLIP_BYTES = 200 * 1024 * 1024;

/** Storage path extension for a clip's MIME type (storage.rules: mp4 | mov | webm). */
export const clipExt = (mime: string): "mp4" | "mov" | "webm" => (mime.includes("mp4") ? "mp4" : mime.includes("quicktime") ? "mov" : "webm");

export interface Claim {
  id: string;
  kind: ClaimKind;
  text: string;
  metric?: string;
  value?: number;
  unit?: string;
}
export interface Requirement {
  id: string;
  claimId: string;
  evidence: EvidenceKind;
  ask: string;
  minSeconds?: number;
}
export interface Plan {
  requirements: Requirement[];
  recordMode: "video" | "photo";
  note: string;
}
export type Source = "ai" | "client" | "default";
export interface ServerClaims {
  items: Claim[];
  source: Source;
  model: string | null;
  ranAt: number;
}
export type ServerPlan = Plan & { source: Source };

export interface VerdictForClaim {
  id: string;
  verdict: ClaimVerdict;
  confidence: number;
  reasons?: string[];
  measured?: { value: number; unit: string };
}
export interface VideoReview {
  status: "waiting" | "running" | "done" | "failed" | "expired" | "none";
  clips: { sha256: string; ext: string | null; durationMs: number; startedAt: number | null; uploaded: boolean; hashOk: boolean | null }[];
  claims: VerdictForClaim[];
  cheating: { detected: boolean; signals: string[] };
  summary: string;
  attempts: number;
  reason: string | null;
  model: string | null;
  ranAt: number | null;
  updatedAtServer?: unknown;
}
export interface ClaimScore {
  id: string;
  p: number;
  sealP: number;
  met: string[];
  unmet: string[];
  minimumMet: boolean;
  backedBy: string[];
}
export interface ModuleClaimOutcome {
  id: string;
  verdict: ClaimVerdict | "missing";
  confidence: number;
  passed: boolean;
  before: number;
  after: number;
  reasons: string[];
  measured?: { value: number; unit: string };
}

// ---------------------------------------------------------------- normalize (v4.1 / v4.2, client and server alike)

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Model output → Claim[] (≤5, ids c1..cN) plus the old-id → new-id map the plan needs. */
export function normalizeClaims(raw: unknown): { claims: Claim[]; remap: Map<string, string> } {
  const claims: Claim[] = [];
  const remap = new Map<string, string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (claims.length >= MAX_CLAIMS) break;
    const o = (x ?? {}) as Record<string, unknown>;
    const kind = str(o.kind, 10) as ClaimKind;
    const text = str(o.text, 80);
    if (!CLAIM_KINDS.includes(kind) || !text) continue;
    const id = `c${claims.length + 1}`;
    const oldId = str(o.id, 10);
    if (oldId && !remap.has(oldId)) remap.set(oldId, id);
    const c: Claim = { id, kind, text };
    const value = Number(o.value);
    if ((kind === "count" || kind === "measure") && Number.isFinite(value) && value > 0) {
      c.metric = str(o.metric, 30);
      c.value = value;
      c.unit = str(o.unit, 16);
    }
    claims.push(c);
  }
  return { claims, remap };
}

/** Model output → Plan (≤6 requirements, ids r1..rN, claimIds remapped). null when nothing usable is left. */
export function normalizePlan(raw: unknown, claims: Claim[], remap: Map<string, string> = new Map()): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ids = new Set(claims.map((c) => c.id));
  const requirements: Requirement[] = [];
  for (const x of Array.isArray(o.requirements) ? o.requirements : []) {
    if (requirements.length >= MAX_REQUIREMENTS) break;
    const r = (x ?? {}) as Record<string, unknown>;
    const given = str(r.claimId, 10);
    // With model ids, an id that was dropped must not fall through to a renumbered claim.
    const claimId = remap.size ? (remap.get(given) ?? "") : given;
    const evidence = str(r.evidence, 10) as EvidenceKind;
    if (!ids.has(claimId) || !EVIDENCE.includes(evidence)) continue;
    const req: Requirement = { id: `r${requirements.length + 1}`, claimId, evidence, ask: str(r.ask, 120) };
    const min = Number(r.minSeconds);
    if ((evidence === "video" || evidence === "motion") && Number.isFinite(min) && min > 0) req.minSeconds = Math.round(min);
    requirements.push(req);
  }
  if (!requirements.length) return null;
  return { requirements, recordMode: requirements.some((r) => r.evidence === "video") ? "video" : "photo", note: str(o.note, 160) };
}

export function normalizeClaimsAndPlan(rawClaims: unknown, rawPlan: unknown): { claims: Claim[]; plan: Plan | null } {
  const { claims, remap } = normalizeClaims(rawClaims);
  return { claims, plan: claims.length ? normalizePlan(rawPlan, claims, remap) : null };
}

/** v4.10 judge output: per-claim verdicts only for the server claims sent, one per id, confidence clamped. */
export function judgeClaims(raw: unknown, claims: Pick<Claim, "id">[]): { id: string; verdict: ClaimVerdict; confidence: number }[] {
  const ids = new Set(claims.map((c) => c.id));
  const seen = new Set<string>();
  const out: { id: string; verdict: ClaimVerdict; confidence: number }[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    const verdict: ClaimVerdict = o.verdict === "backed" || o.verdict === "not_backed" ? o.verdict : "unclear";
    out.push({ id, verdict, confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)) });
  }
  return out;
}

/** The person removed a claim on the end card: drop it and its requirements, renumber both. */
export function withoutClaim(claims: Claim[], plan: Plan | null | undefined, id: string) {
  const keep = claims.filter((c) => c.id !== id);
  return normalizeClaimsAndPlan(keep, plan ? { ...plan, requirements: plan.requirements.filter((r) => r.claimId !== id) } : null);
}

// ---------------------------------------------------------------- facts from a chain (client side)

export interface ClipFact {
  sha256: string;
  durationMs: number;
  startedAt: number | null;
  bytes: number;
  name: string | null;
}
export interface WitnessFact {
  wid: string;
  rid: string | null;
  answered: boolean;
}
export interface ChainFacts {
  frameCount: number;
  gpsFixes: number; // accuracy ≤ 100 m
  motionSeconds: number; // span of non-zero motion samples
  clips: ClipFact[];
  witness: WitnessFact[];
}

type Ev = { t?: number; type?: string; [k: string]: unknown };

/** Accumulates the same facts while recording (Session) and from stored chunks (detail). */
export class FactsBuilder {
  frameCount = 0;
  gpsFixes = 0;
  private motionFirst: number | null = null;
  private motionLast: number | null = null;
  clips: ClipFact[] = [];
  private w = new Map<string, WitnessFact>();

  gps(rows: unknown[]) {
    for (const g of rows) if (Array.isArray(g) && typeof g[3] === "number" && g[3] <= GPS_FIX_MAX_ACCURACY_M) this.gpsFixes++;
  }
  motion(rows: unknown[]) {
    for (const m of rows) {
      if (!Array.isArray(m) || typeof m[0] !== "number") continue;
      if (!m.slice(1).some((v) => typeof v === "number" && v !== 0)) continue;
      if (this.motionFirst == null) this.motionFirst = m[0];
      this.motionLast = m[0];
    }
  }
  frame() {
    this.frameCount++;
  }
  event(e: Ev) {
    if (e.type === "video" && typeof e.sha256 === "string")
      this.clips.push({
        sha256: e.sha256,
        durationMs: Number(e.durationMs) || 0,
        startedAt: typeof e.startedAt === "number" ? e.startedAt : null,
        bytes: Number(e.bytes) || 0,
        name: typeof e.name === "string" ? e.name : null,
      });
    else if (e.type === "witness" && typeof e.wid === "string") this.w.set(e.wid, { wid: e.wid, rid: typeof e.rid === "string" && e.rid ? e.rid : null, answered: false });
    else if (e.type === "witness_answer" && typeof e.wid === "string") {
      const w = this.w.get(e.wid);
      if (w) w.answered = true;
    }
  }
  get facts(): ChainFacts {
    return {
      frameCount: this.frameCount,
      gpsFixes: this.gpsFixes,
      motionSeconds: this.motionFirst == null || this.motionLast == null ? 0 : (this.motionLast - this.motionFirst) / 1000,
      clips: [...this.clips],
      witness: [...this.w.values()],
    };
  }
}

export function factsOf(chunks: Pick<Chunk, "payload">[]): ChainFacts {
  const b = new FactsBuilder();
  for (const c of chunks) {
    let p: { gps?: unknown[]; motion?: unknown[]; events?: Ev[]; frameSha?: unknown };
    try {
      p = JSON.parse(c.payload);
    } catch {
      continue;
    }
    b.gps(p.gps ?? []);
    b.motion(p.motion ?? []);
    if (p.frameSha) b.frame();
    for (const e of p.events ?? []) b.event(e);
  }
  return b.facts;
}

// ---------------------------------------------------------------- record-screen checklist ("captured", never "met")

/** v4.2 client checklist: the local evidence for this requirement exists. The server decides "met". */
export function captured(r: Requirement, f: ChainFacts): boolean {
  switch (r.evidence) {
    case "video":
      return f.clips.some((c) => c.durationMs > 0 && c.durationMs >= (r.minSeconds ?? 0) * 1000);
    case "frames":
      return f.frameCount >= 1;
    case "gps":
      return f.gpsFixes >= 1;
    case "motion":
      return f.motionSeconds >= (r.minSeconds || DEFAULT_MOTION_SECONDS);
    case "witness":
      return f.witness.some((w) => w.answered && w.rid === r.id);
  }
}

/** `{{unmet}}` for the witness prompts: requirements whose evidence isn't captured yet, plan order. */
export const unmetRequirements = (plan: Plan | null | undefined, f: ChainFacts) =>
  (plan?.requirements ?? []).filter((r) => !captured(r, f)).map(({ id, claimId, evidence, ask }) => ({ id, claimId, evidence, ask }));

// ---------------------------------------------------------------- v4.5 scoring (port of the reference implementation)

export interface JudgeIn {
  verdict: string;
  confidence: number;
  claims?: { id: string; verdict: string; confidence: number }[];
}
export interface ModuleIn {
  module: string;
  strength: number;
  backs: string[];
  claims?: { id: string; verdict: string; confidence: number }[];
  targetedOnly?: boolean;
}
export interface ScoreInput {
  bar: number;
  baseline: number | null;
  claims: Pick<Claim, "id" | "kind">[];
  requirements: Requirement[];
  facts: {
    integrity: { chain: boolean; timing: boolean; physics: boolean; frames: boolean };
    frameCount: number;
    gpsFixes: number;
    motionSeconds: number;
    clips: { sha256?: string; durationMs: number; uploaded: boolean; hashOk: boolean | null }[];
    witness: { wid?: string; rid?: string | null; answered: boolean }[];
  };
  judge: JudgeIn | null;
  skeptic: { verdict: string; confidence?: number; reasons?: string[] } | null;
  videoReview: { status: string; claims?: { id: string; verdict: string; confidence: number }[]; cheating?: { detected: boolean; signals?: string[] } } | null;
  ladder?: ModuleIn[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const backedVerdict = (v: { verdict: string; confidence: number } | undefined | null) =>
  !!v && v.verdict === "backed" && typeof v.confidence === "number" && v.confidence >= BACKED_CONFIDENCE;

function framesBack(input: ScoreInput, claimId: string) {
  const j = input.judge;
  if (!j || input.facts.frameCount < 1) return false;
  if (Array.isArray(j.claims) && j.claims.length > 0) return backedVerdict(j.claims.find((c) => c.id === claimId));
  return j.verdict === "consistent" && j.confidence >= BACKED_CONFIDENCE;
}
function videoBacks(input: ScoreInput, claimId: string) {
  const r = input.videoReview;
  if (!r || r.status !== "done") return false;
  if (!input.facts.clips.some((c) => c.uploaded && c.hashOk === true)) return false;
  return backedVerdict((r.claims ?? []).find((c) => c.id === claimId));
}
function requirementMet(input: ScoreInput, req: Requirement) {
  const f = input.facts;
  switch (req.evidence) {
    case "video": {
      const min = (req.minSeconds ?? 0) * 1000;
      return f.clips.some((c) => c.uploaded && c.hashOk === true && c.durationMs > 0 && c.durationMs >= min) && videoBacks(input, req.claimId);
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

export function cheatingOf(input: ScoreInput) {
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
  return { detected: signals.length > 0, signals: signals.slice(0, MAX_SIGNALS) };
}

/** Claims a module moves: kind in backs; targetedOnly (witness_review) only the claims an answered request targeted. */
export function claimsBackedByModule(
  input: Pick<ScoreInput, "claims" | "requirements"> & { facts: Pick<ScoreInput["facts"], "witness"> },
  mod: Pick<ModuleIn, "backs" | "targetedOnly">,
): string[] {
  let ids = input.claims.filter((c) => mod.backs.includes(c.kind)).map((c) => c.id);
  if (mod.targetedOnly) {
    const answered = input.facts.witness.filter((w) => w.answered);
    if (!answered.some((w) => w.rid == null)) {
      const targeted = new Set(input.requirements.filter((r) => answered.some((w) => w.rid === r.id)).map((r) => r.claimId));
      ids = ids.filter((id) => targeted.has(id));
    }
  }
  return ids;
}

export function scoreV4(input: ScoreInput) {
  const bar = input.bar;
  const baseline = input.baseline == null ? DEFAULT_BASELINE : clamp01(input.baseline);
  const cheating = cheatingOf(input);

  const claims = input.claims.map((c) => {
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
    return { id: c.id, met, unmet, minimumMet, backedBy, sealP: p, p };
  });
  const capped = (p: number) => (cheating.detected ? Math.min(p, CHEATING_CAP) : p);
  const scoreOf = () => Math.min(...claims.map((c) => capped(c.p)));

  const ladder: { module: string; before: number; after: number; passed: boolean; claims: { id: string; passed: boolean; before: number; after: number }[] }[] = [];
  for (const mod of input.ladder ?? []) {
    const before = scoreOf();
    const backed = claimsBackedByModule(input, mod);
    const moved: { id: string; passed: boolean; before: number; after: number }[] = [];
    for (const c of claims) {
      if (!backed.includes(c.id)) continue;
      const v = (mod.claims ?? []).find((x) => x.id === c.id);
      const pass = backedVerdict(v);
      const b = capped(c.p);
      c.p = pass ? c.p + mod.strength * (1 - c.p) : c.p * (1 - mod.strength);
      if (pass) c.backedBy.push(mod.module);
      moved.push({ id: c.id, passed: pass, before: b, after: capped(c.p) });
    }
    ladder.push({ module: mod.module, before, after: scoreOf(), passed: moved.length > 0 && moved.every((m) => m.passed), claims: moved });
  }
  for (const c of claims) c.p = capped(c.p);

  const integ = input.facts.integrity;
  const checks = {
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
    claims: claims.map(({ id, met, unmet, minimumMet, backedBy, sealP, p }) => ({ id, met, unmet, minimumMet, backedBy, sealP, p })),
    ladder,
    score: scoreOf(),
    checks,
    sealed,
    verified: sealed,
    ladderEligible: integ.chain && integ.timing && integ.physics && integ.frames && !cheating.detected,
    claimsBacked: claims.filter((c) => c.p >= bar).length,
  };
}

// ---------------------------------------------------------------- UI words (v4.11)

export const SOURCE_LABEL: Record<string, string> = {
  video_review: "video review",
  frames_judge: "proof shots",
  gps: "GPS",
  motion: "motion",
  witness: "witness",
};
export const EVIDENCE_LABEL: Record<EvidenceKind, string> = { video: "Video", frames: "Photo", gps: "GPS", motion: "Motion", witness: "Witness" };

/** "≥ 20 s" for requirements with a minimum length. */
export const minText = (r: Pick<Requirement, "minSeconds">) => (r.minSeconds ? `≥ ${r.minSeconds} s` : "");

/** Video status words on the finish screen and the detail (v4.11). */
export function videoStatusText(v: Pick<VideoReview, "status"> | null | undefined): string | null {
  switch (v?.status) {
    case "waiting":
      return "Waiting for video upload";
    case "running":
      return "Reviewing video";
    case "expired":
      return "Video never arrived · sealed without it";
    case "failed":
      return "The video review couldn't run · sealed without it";
    case "done":
      return "Video reviewed";
    default:
      return null;
  }
}
