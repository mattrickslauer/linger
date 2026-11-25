// Regenerates shared/test-vectors-v4.json: the v4 per-claim scoring (docs/ARCHITECTURE.md "v4.5").
// Run: node shared/make-test-vectors-v4.mjs
// This file is the REFERENCE implementation of the v4 math. Every implementation (functions/src, the clients' detail
// screens and previews) must reproduce `expect` for every case: same order of operations, IEEE doubles, no rounding
// between steps (Swift/Kotlin compare within 1e-9).
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

export const DEFAULT_BASELINE = 0.2; // no client scorer → adversarial prior
export const CHEATING_CAP = 0.1; // cheating detected → every claim p = min(p, 0.1)
export const BACKED_CONFIDENCE = 0.6; // a verdict counts as "backed" only at confidence ≥ 0.6 (== ladder passConfidence)
export const DEFAULT_MOTION_SECONDS = 10; // motion requirement without minSeconds
export const MAX_SIGNALS = 6;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const backedVerdict = (v) => !!v && v.verdict === "backed" && typeof v.confidence === "number" && v.confidence >= BACKED_CONFIDENCE;

/** Does the frames judge back this claim? Per-claim verdicts when the judge returned any, else its overall verdict. */
function framesBack(input, claimId) {
  const j = input.judge;
  if (!j || input.facts.frameCount < 1) return false;
  if (Array.isArray(j.claims) && j.claims.length > 0) return backedVerdict(j.claims.find((c) => c.id === claimId));
  return j.verdict === "consistent" && j.confidence >= BACKED_CONFIDENCE;
}

/** Does the free video review back this claim? Needs a review that ran (status done) on at least one matching clip. */
function videoBacks(input, claimId) {
  const r = input.videoReview;
  if (!r || r.status !== "done") return false;
  if (!input.facts.clips.some((c) => c.uploaded && c.hashOk === true)) return false;
  return backedVerdict((r.claims ?? []).find((c) => c.id === claimId));
}

function requirementMet(input, req) {
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

export function cheatingOf(input) {
  const signals = [];
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

/** Claims a ladder module moves: kind in backs; witness_review (targetedOnly) only claims an answered request targeted. */
export function claimsBackedByModule(input, mod) {
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

export function scoreV4(input) {
  const bar = input.bar;
  const baseline = input.baseline == null ? DEFAULT_BASELINE : clamp01(input.baseline);
  const cheating = cheatingOf(input);

  // 1-4: baseline, met/unmet, minimum evidence + no cheating = bar
  const claims = input.claims.map((c) => {
    const reqs = input.requirements.filter((r) => r.claimId === c.id);
    const met = reqs.filter((r) => requirementMet(input, r)).map((r) => r.id);
    const unmet = reqs.filter((r) => !met.includes(r.id)).map((r) => r.id);
    const backedBy = [];
    if (videoBacks(input, c.id)) backedBy.push("video_review");
    if (framesBack(input, c.id)) backedBy.push("frames_judge");
    for (const ev of ["gps", "motion", "witness"]) if (reqs.some((r) => r.evidence === ev && met.includes(r.id))) backedBy.push(ev);
    let p = baseline;
    const minimumMet = reqs.length > 0 && unmet.length === 0;
    if (minimumMet && !cheating.detected) p = Math.max(p, bar);
    return { id: c.id, met, unmet, minimumMet, backedBy, sealP: p, p };
  });
  // The cheating cap is applied to the reported values only; modules always work on the uncapped p.
  const capped = (p) => (cheating.detected ? Math.min(p, CHEATING_CAP) : p);
  const scoreOf = () => Math.min(...claims.map((c) => capped(c.p)));

  // 5: ladder modules, in run order, only for the claims they back (math from v3: pass p+s(1-p), fail p(1-s)).
  const ladder = [];
  for (const mod of input.ladder ?? []) {
    const before = scoreOf();
    const backed = claimsBackedByModule(input, mod);
    const moved = [];
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
  // 6: cheating cap
  for (const c of claims) c.p = capped(c.p);

  const integ = input.facts.integrity;
  const checks = {
    chain: integ.chain, timing: integ.timing, physics: integ.physics, frames: integ.frames,
    ai: !(input.judge?.verdict === "inconsistent" && input.judge.confidence >= BACKED_CONFIDENCE),
    cheating: !cheating.detected,
    bar: claims.every((c) => c.p >= bar),
  };
  const sealed = Object.values(checks).every(Boolean);
  const score = scoreOf();
  return {
    baselineUsed: baseline,
    cheating,
    claims: claims.map(({ id, met, unmet, minimumMet, backedBy, sealP, p }) => ({ id, met, unmet, minimumMet, backedBy, sealP, p })),
    ladder,
    score,
    checks,
    sealed,
    verified: sealed,
    ladderEligible: integ.chain && integ.timing && integ.physics && integ.frames && !cheating.detected,
    claimsBacked: claims.filter((c) => c.p >= bar).length,
  };
}

// ───────────────────────────────────────────────── cases
const OK = { chain: true, timing: true, physics: true, frames: true };
const CLIP = { sha256: "a".repeat(64), durationMs: 35000, uploaded: true, hashOk: true };
const clap = {
  bar: 0.52,
  baseline: 0.4,
  claims: [
    { id: "c1", kind: "action", text: "clapping" },
    { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
  ],
  requirements: [
    { id: "r1", claimId: "c1", evidence: "video", ask: "Clap on camera, both hands in frame" },
    { id: "r2", claimId: "c2", evidence: "video", ask: "One continuous video of all 50 claps", minSeconds: 20 },
  ],
  facts: { integrity: OK, frameCount: 1, gpsFixes: 0, motionSeconds: 0, clips: [CLIP], witness: [] },
  judge: { verdict: "uncertain", confidence: 0.5, claims: [{ id: "c1", verdict: "backed", confidence: 0.8 }, { id: "c2", verdict: "unclear", confidence: 0.3 }] },
  skeptic: { verdict: "consistent", confidence: 0.7, reasons: [] },
  videoReview: {
    status: "done",
    claims: [
      { id: "c1", verdict: "backed", confidence: 0.9, reasons: ["both hands clapping throughout"] },
      { id: "c2", verdict: "backed", confidence: 0.8, reasons: ["counted 50 claps"], measured: { value: 50, unit: "claps" } },
    ],
    cheating: { detected: false, signals: [] },
  },
  ladder: [],
};
const fish = {
  bar: 0.73,
  baseline: 0.3,
  claims: [
    { id: "c1", kind: "object", text: "largemouth bass" },
    { id: "c2", kind: "measure", text: "at least 6 lb", metric: "weight", value: 6, unit: "lb" },
    { id: "c3", kind: "place", text: "Lake Mission Viejo" },
  ],
  requirements: [
    { id: "r1", claimId: "c1", evidence: "frames", ask: "A clear shot of the bass held up" },
    { id: "r2", claimId: "c2", evidence: "frames", ask: "The scale reading with the fish on it" },
    { id: "r3", claimId: "c3", evidence: "gps", ask: "Keep location on at the lake" },
  ],
  facts: { integrity: OK, frameCount: 3, gpsFixes: 40, motionSeconds: 300, clips: [], witness: [] },
  judge: { verdict: "consistent", confidence: 0.8, claims: [{ id: "c1", verdict: "backed", confidence: 0.85 }, { id: "c2", verdict: "unclear", confidence: 0.5 }, { id: "c3", verdict: "unclear", confidence: 0.4 }] },
  skeptic: { verdict: "consistent", confidence: 0.7, reasons: [] },
  videoReview: null,
  ladder: [],
};
const mod = (module, strength, backs, claims, targetedOnly) => ({ module, strength, backs, claims, ...(targetedOnly ? { targetedOnly } : {}) });
const ALL = ["action", "count", "measure", "place", "time", "object", "outcome"];
const v = (id, verdict, confidence) => ({ id, verdict, confidence });

const cases = [
  ["clap 50 with the full clip: minimum evidence + no cheating = bar", clap],
  ["clap 50 photo only (the production failure): video requirements unmet, stays at baseline",
    { ...clap, facts: { ...clap.facts, clips: [] }, videoReview: { status: "none", claims: [], cheating: { detected: false, signals: [] } } }],
  ["clip shorter than minSeconds: only the count stays unmet",
    { ...clap, facts: { ...clap.facts, clips: [{ ...CLIP, durationMs: 12000 }] } }],
  ["video review unsure of the count (confidence 0.5): count unmet",
    { ...clap, videoReview: { ...clap.videoReview, claims: [clap.videoReview.claims[0], { ...clap.videoReview.claims[1], confidence: 0.5 }] } }],
  ["baseline above the bar is kept, not lowered", { ...clap, baseline: 0.7 }],
  ["video review detects cheating: every claim capped at 0.1, rejected",
    { ...clap, baseline: 0.6, videoReview: { ...clap.videoReview, cheating: { detected: true, signals: ["loop: the same 3 s repeat 12 times"] } } }],
  ["clip hash mismatch is cheating", { ...clap, facts: { ...clap.facts, clips: [{ ...CLIP, hashOk: false }] } }],
  ["skeptic inconsistent is cheating", { ...clap, skeptic: { verdict: "inconsistent", confidence: 0.7, reasons: ["photo of a screen"] } }],
  ["broken chain is cheating", { ...clap, facts: { ...clap.facts, integrity: { ...OK, chain: false } } }],
  ["clip never arrived (expired after 24 h): video unmet, no cheating",
    { ...clap, facts: { ...clap.facts, clips: [{ ...CLIP, uploaded: false, hashOk: null }] }, videoReview: { status: "expired", claims: [], cheating: { detected: false, signals: [] } } }],
  ["judge says the frames contradict the claim: ai check fails even with video", { ...clap, judge: { ...clap.judge, verdict: "inconsistent", confidence: 0.8 } }],
  ["no client scorer: baseline 0.2, still reaches the bar with the minimum evidence", { ...clap, baseline: null }],
  ["fish: per-claim frames judge; the scale reading is unclear so the weight stays at baseline", fish],
  ["fish: judge without per-claim verdicts falls back to its overall verdict", { ...fish, judge: { verdict: "consistent", confidence: 0.7, claims: [] } }],
  ["fish + count_measure pass on the weight, second_look fail on the bass (modules move only claims they back)",
    { ...fish, ladder: [
      mod("count_measure", 0.3, ["count", "measure"], [v("c2", "backed", 0.8)]),
      mod("second_look", 0.2, ["action", "object", "outcome"], [v("c1", "not_backed", 0.7)]),
    ] }],
  ["count_measure backs the count the video could not: lifts it past the bar",
    { ...clap, videoReview: { ...clap.videoReview, claims: [clap.videoReview.claims[0], v("c2", "unclear", 0.4)] },
      ladder: [mod("count_measure", 0.3, ["count", "measure"], [v("c2", "backed", 0.9)])] }],
  ["full_video backs every kind; a missing verdict for a backed claim counts as a fail",
    { ...clap, ladder: [mod("full_video", 0.45, ALL, [v("c1", "backed", 0.95)])] }],
  ["module pass at confidence 0.59 is a fail", { ...clap, ladder: [mod("full_video", 0.45, ALL, [v("c1", "backed", 0.59), v("c2", "backed", 0.59)])] }],
  ["witness requirement met by an answered request tagged with its rid; witness_review moves only targeted claims",
    { bar: 0.6, baseline: 0.35,
      claims: [{ id: "c1", kind: "outcome", text: "summit reached" }, { id: "c2", kind: "place", text: "Mount Baldy" }],
      requirements: [
        { id: "r1", claimId: "c1", evidence: "witness", ask: "Show the summit sign" },
        { id: "r2", claimId: "c2", evidence: "gps", ask: "Keep location on to the top" },
        { id: "r3", claimId: "c2", evidence: "motion", ask: "Carry the phone the whole climb", minSeconds: 600 },
      ],
      facts: { integrity: OK, frameCount: 4, gpsFixes: 900, motionSeconds: 3600, clips: [],
        witness: [{ wid: "w1", rid: "r1", answered: true }, { wid: "w2", rid: "r2", answered: false }] },
      judge: { verdict: "consistent", confidence: 0.75, claims: [v("c1", "backed", 0.7), v("c2", "unclear", 0.5)] },
      skeptic: { verdict: "uncertain", confidence: 0.4, reasons: [] },
      videoReview: null,
      ladder: [mod("witness_review", 0.3, ALL, [v("c1", "backed", 0.8), v("c2", "backed", 0.8)], true)] }],
  ["motion requirement shorter than minSeconds is unmet",
    { bar: 0.55, baseline: 0.3,
      claims: [{ id: "c1", kind: "count", text: "100 push-ups", metric: "push-ups", value: 100, unit: "reps" }],
      requirements: [{ id: "r1", claimId: "c1", evidence: "motion", ask: "Phone on your back for all reps", minSeconds: 120 }],
      facts: { integrity: OK, frameCount: 1, gpsFixes: 0, motionSeconds: 90, clips: [], witness: [] },
      judge: { verdict: "uncertain", confidence: 0.5, claims: [v("c1", "unclear", 0.3)] },
      skeptic: { verdict: "consistent", confidence: 0.6, reasons: [] }, videoReview: null, ladder: [] }],
  ["a claim with no requirement never earns the bar for free",
    { ...clap, requirements: [clap.requirements[0]] }],
];

// A v4 chain: plan-tagged witness request (rid) and a chained video clip. Hashing is unchanged from v1.
const h = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
function chunk(seq, t0, t1, prevHash, payload) {
  const payloadSha = h(payload);
  return { seq, t0, t1, prevHash, payload, payloadSha, hash: h(`${seq}|${t0}|${t1}|${prevHash}|${payloadSha}`) };
}
const vid = "4c7d2a91-0b3e-4f5a-8d6c-1e2f3a4b5c6d";
const clipSha = h("fake clip bytes");
const k0 = chunk(0, 1764200000000, 1764200005000, "GENESIS:" + vid, JSON.stringify({
  gps: [], motion: [[1764200000100, 0.3, 9.7, 0.1, 0.2, 0.1, 0]],
  events: [
    { t: 1764200000000, type: "start" },
    { t: 1764200001000, type: "video_start" },
    { t: 1764200004000, type: "witness", wid: "w1", ask: "Keep both hands in frame", kind: "do", by: "on_device", rid: "r1" },
  ],
  frameSha: null, check: null,
}));
const k1 = chunk(1, 1764200005000, 1764200036000, k0.hash, JSON.stringify({
  gps: [], motion: [],
  events: [
    { t: 1764200036000, type: "video", sha256: clipSha, bytes: 15, durationMs: 35000, startedAt: 1764200001000, name: "verified-clap.webm" },
    { t: 1764200036000, type: "frame" },
    { t: 1764200036000, type: "witness_answer", wid: "w1", via: "done" },
    { t: 1764200036000, type: "stop" },
  ],
  frameSha: h("aGVsbG8="),
  check: { ok: true, reason: "keep going", mode: "on_device", label: "hands clapping" },
}));

writeFileSync(new URL("./test-vectors-v4.json", import.meta.url), JSON.stringify({
  note: "v4 vectors (docs/ARCHITECTURE.md v4.5). scoring: reference implementation in shared/make-test-vectors-v4.mjs; per claim p = baseline (0.2 if absent) → max(p, bar) when every requirement of the claim is met and no cheating → ladder modules in run order for the claims they back (pass p+s(1-p) when verdict backed && confidence >= 0.6, else fail p(1-s)) → cheating cap min(p, 0.1). score = min over claims; verified = sealed = every check. videoChain: same hashing as v1; witness events carry rid, the clip is a `video` event.",
  constants: { DEFAULT_BASELINE, CHEATING_CAP, BACKED_CONFIDENCE, DEFAULT_MOTION_SECONDS, MAX_SIGNALS },
  scoring: cases.map(([name, input]) => ({ name, input, expect: scoreV4(input) })),
  videoChain: { momentId: vid, headHash: k1.hash, clipSha, chunks: [k0, k1] },
}, null, 2) + "\n");
console.log("v4 cases", cases.length, "video head", k1.hash);
