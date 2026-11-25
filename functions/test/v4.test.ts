// v4 functions logic (docs/ARCHITECTURE.md v4): claims + plan normalization and the barAndClaims agent, per-claim
// scoring against shared/test-vectors-v4.json, the cheating cap, seal v4 waiting for the clip (and the 24 h
// fallback), the free video review with the fake engine, and ladder modules applied per claim.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiCall, AiEngine, fakeEngine } from "../src/ai";
import { computeBarAndClaims, runModule } from "../src/agents";
import { unmetNeedV4 } from "../src/callable";
import { fakeClaimsAndPlan, fallbackClaims, normalizeClaims, normalizePlan } from "../src/claims";
import { chainFacts } from "../src/ladder";
import { ChunkDoc, MomentDoc, chunkHash, genesis, sha256hex } from "../src/seal";
import { evaluateSealV4, feedV4Fields, isReadyToSealV4, needsBarAndClaims, needsVideoReview, videoWaitExpired } from "../src/seal4";
import { applyLadderV4, claimsBackedByModule, moduleOutcomes, scoreV4 } from "../src/score4";
import { getModule } from "../src/shared";
import { Claim, VIDEO_WAIT_MS } from "../src/v4";
import { MAX_CLIP_BYTES, MAX_REVIEW_ATTEMPTS, clipList, clipsForReview, coerceVerdicts, nextReviewStep, parseClipPath, runVideoReview, tooLargeToUpload } from "../src/video";

const v4 = JSON.parse(readFileSync(new URL("../../shared/test-vectors-v4.json", import.meta.url), "utf8"));

function engine(answer: unknown, spy?: (c: AiCall) => void): AiEngine {
  return {
    name: "test",
    async generateJson(call) {
      spy?.(call);
      if (answer instanceof Error) throw answer;
      return { data: answer as Record<string, unknown>, model: "test-model" };
    },
  };
}

// ───────────────────────────────── per-claim scoring (v4.5)

describe("score4.scoreV4 reproduces every shared/test-vectors-v4.json case", () => {
  for (const c of v4.scoring) {
    it(c.name, () => {
      const got = scoreV4(c.input);
      expect(got.claims).toEqual(c.expect.claims);
      expect(got.ladder).toEqual(c.expect.ladder);
      expect(got.checks).toEqual(c.expect.checks);
      expect(got.cheating).toEqual(c.expect.cheating);
      expect(got.score).toBe(c.expect.score);
      expect(got.baselineUsed).toBe(c.expect.baselineUsed);
      expect(got.sealed).toBe(c.expect.sealed);
      expect(got.verified).toBe(c.expect.verified);
      expect(got.ladderEligible).toBe(c.expect.ladderEligible);
      expect(got.claimsBacked).toBe(c.expect.claimsBacked);
    });
  }
  const byName = (s: string) => v4.scoring.find((c: { name: string }) => c.name.startsWith(s));
  it("cheating caps every claim at 0.1 even when the baseline is above the bar", () => {
    const r = scoreV4(byName("video review detects cheating").input);
    expect(r.claims.every((c) => c.p <= 0.1)).toBe(true);
    expect(r.checks.cheating).toBe(false);
    expect(r.sealed).toBe(false);
    expect(r.cheating.signals).toEqual(["video: loop: the same 3 s repeat 12 times"]);
  });
  it("the cap is reported only: modules still work on the uncapped p", () => {
    const base = [{ id: "c1", met: [], unmet: [], minimumMet: false, backedBy: [], sealP: 0.5 }];
    const r = applyLadderV4(base, true, [{ module: "full_video", strength: 0.45, backedIds: ["c1"], claims: [{ id: "c1", verdict: "backed", confidence: 0.9 }] }]);
    expect(r.claims[0].p).toBe(0.1);
    expect(r.ladder[0].claims[0]).toEqual({ id: "c1", passed: true, before: 0.1, after: 0.1 });
  });
});

// ───────────────────────────────── claims + plan (v4.1-v4.3)

describe("claims and plan normalization (v4.1, v4.2)", () => {
  it("drops bad claims, keeps 5, renumbers and remaps the plan", () => {
    const n = normalizeClaims([
      { id: "x", kind: "bogus", text: "nope" },
      { id: "c9", kind: "action", text: "  clapping  ", metric: "", value: 0, unit: "" },
      { id: "c3", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
      { id: "c4", kind: "measure", text: "zero", metric: "kg", value: 0, unit: "kg" },
      { id: "c5", kind: "object", text: "" },
      { id: "c6", kind: "place", text: "a".repeat(100) },
      { id: "c7", kind: "time", text: "dawn" },
      { id: "c8", kind: "outcome", text: "done" },
      { id: "c10", kind: "outcome", text: "sixth" },
    ]);
    expect(n.claims.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(n.claims[0]).toEqual({ id: "c1", kind: "action", text: "clapping" });
    expect(n.claims[1]).toEqual({ id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" });
    expect(n.claims[2]).toEqual({ id: "c3", kind: "measure", text: "zero" });
    expect(n.claims[3].text).toHaveLength(80);
    const plan = normalizePlan(
      {
        requirements: [
          { id: "r7", claimId: "c3", evidence: "video", ask: "All 50 claps", minSeconds: 20 },
          { id: "r8", claimId: "zzz", evidence: "video", ask: "unknown claim" },
          { id: "r9", claimId: "c9", evidence: "frames", ask: "Hands", minSeconds: 30 },
          { id: "r10", claimId: "c9", evidence: "telepathy", ask: "bad" },
        ],
        recordMode: "photo",
        note: "n",
      },
      n.claims,
      n.idMap,
      false,
    );
    expect(plan.requirements).toEqual([
      { id: "r1", claimId: "c2", evidence: "video", ask: "All 50 claps", minSeconds: 20 },
      { id: "r2", claimId: "c1", evidence: "frames", ask: "Hands" },
    ]);
    expect(plan.recordMode).toBe("video");
  });
  it("the server appends a default requirement for every uncovered claim, up to 6", () => {
    const claims: Claim[] = [
      { id: "c1", kind: "action", text: "clapping" },
      { id: "c2", kind: "place", text: "the park" },
      { id: "c3", kind: "object", text: "a red ball" },
    ];
    const plan = normalizePlan({ requirements: [] }, claims, null, true);
    expect(plan.requirements).toEqual([
      { id: "r1", claimId: "c1", evidence: "video", ask: "A continuous video showing clapping" },
      { id: "r2", claimId: "c2", evidence: "gps", ask: "Keep location on during the session" },
      { id: "r3", claimId: "c3", evidence: "frames", ask: "A clear proof shot of a red ball" },
    ]);
    expect(plan.recordMode).toBe("video");
  });
  it("fallback: client claims (source client) or one outcome claim (source default)", () => {
    const typed = fallbackClaims({ text: "Clap 50 times", category: "other" }, 7);
    expect(typed.claims).toEqual({ items: [{ id: "c1", kind: "outcome", text: "Clap 50 times" }], source: "default", model: null, ranAt: 7 });
    expect(typed.plan.requirements).toEqual([{ id: "r1", claimId: "c1", evidence: "frames", ask: "A clear proof shot of Clap 50 times" }]);
    const drafted = fallbackClaims({ text: "x", goal: "g", claims: [{ id: "c1", kind: "count", text: "50 claps", value: 50, metric: "claps", unit: "claps" }], plan: null }, 7);
    expect(drafted.claims.source).toBe("client");
    expect(drafted.plan.source).toBe("default");
    expect(drafted.plan.requirements[0]).toMatchObject({ claimId: "c1", evidence: "video" });
  });
  it("fake engine: a typed 'Clap 50 times' becomes action + count, both on video", () => {
    const f = fakeClaimsAndPlan({ text: "Clap 50 times", category: "other" });
    const n = normalizeClaims(f.claims);
    expect(n.claims).toEqual([
      { id: "c1", kind: "action", text: "clapping" },
      { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
    ]);
    const plan = normalizePlan(f.plan, n.claims, n.idMap, true);
    expect(plan.recordMode).toBe("video");
    expect(plan.requirements.map((r) => [r.claimId, r.evidence, r.minSeconds])).toEqual([
      ["c1", "video", undefined],
      ["c2", "video", 20],
    ]);
  });
});

describe("barAndClaims agent (v4.3)", () => {
  const moment = (intention: unknown): MomentDoc =>
    ({ ownerUid: "u", status: "submitted", startedAt: Date.UTC(2026, 10, 25, 15), endedAt: null, chunkCount: 1, headHash: null, intention, summary: null }) as MomentDoc;
  it("typed intention gets server claims, a plan and the bar in one call (fake engine)", async () => {
    const r = await computeBarAndClaims(moment({ text: "Clap 50 times", category: "other" }), fakeEngine, 5);
    expect(r.fromModel).toBe(true);
    expect(r.bar).toMatchObject({ source: "ai", difficulty: 0.2, value: 0.59, model: "fake-emulator" });
    expect(r.claims.source).toBe("ai");
    expect(r.claims.items.map((c) => `${c.id} ${c.kind} ${c.text}`)).toEqual(["c1 action clapping", "c2 count 50 claps"]);
    expect(r.plan.source).toBe("ai");
    expect(r.plan.requirements.every((q) => q.evidence === "video")).toBe(true);
  });
  it("sends the intention without claims/plan/preview and the draft separately", async () => {
    let seen: AiCall | undefined;
    const intention = { text: "t", category: "other", v: 4, preview: { bar: 0.9 }, claims: [{ id: "c1", kind: "action", text: "x" }], plan: { requirements: [], recordMode: "photo", note: "" } };
    await computeBarAndClaims(moment(intention), engine({ difficulty: 0.4, rationale: "r", factors: [], claims: [{ id: "c1", kind: "action", text: "x", metric: "", value: 0, unit: "" }], plan: { requirements: [], recordMode: "photo", note: "" } }, (c) => (seen = c)));
    expect(seen!.prompt).toBe("barAndClaims");
    expect(JSON.parse(seen!.vars.intention)).toEqual({ text: "t", category: "other", v: 4 });
    expect(JSON.parse(seen!.vars.draft)).toEqual({ claims: intention.claims, plan: intention.plan });
  });
  it("model with no usable claims keeps its bar and falls back to the client's claims", async () => {
    const r = await computeBarAndClaims(
      moment({ text: "t", category: "other", claims: [{ id: "c1", kind: "object", text: "bass" }] }),
      engine({ difficulty: 0.5, rationale: "r", factors: [], claims: [{ kind: "nope", text: "" }], plan: {} }),
    );
    expect(r.bar.value).toBe(0.73);
    expect(r.claims.source).toBe("client");
    expect(r.plan.requirements).toEqual([{ id: "r1", claimId: "c1", evidence: "frames", ask: "A clear proof shot of bass" }]);
  });
  it("model failure: default bar, default claim", async () => {
    const r = await computeBarAndClaims(moment({ text: "Clap 50 times #ai-fail", category: "other" }), fakeEngine);
    expect(r.fromModel).toBe(false);
    expect(r.bar.source).toBe("default");
    expect(r.claims.source).toBe("default");
    expect(r.claims.items).toHaveLength(1);
  });
});

// ───────────────────────────────── seal v4 waits for the clip (v4.4) + evaluation

const ID = "4c7d2a91-0b3e-4f5a-8d6c-1e2f3a4b5c6d";
const JPEG = "/9j/clapframe";
const T0 = Date.UTC(2026, 10, 25, 18, 0);
const CLIP_SHA = sha256hex("clip bytes");

function clapChunks(): ChunkDoc[] {
  const chunks: ChunkDoc[] = [];
  let prev = genesis(ID);
  for (let seq = 0; seq < 8; seq++) {
    const t0 = T0 + seq * 5000;
    const t1 = t0 + 5000;
    const last = seq === 7;
    const events: Array<Record<string, unknown>> = [];
    if (seq === 0) events.push({ t: t0, type: "start" }, { t: t0 + 500, type: "video_start" });
    if (last) events.push({ t: t1, type: "video", sha256: CLIP_SHA, bytes: 10, durationMs: 35000, startedAt: T0 + 500, name: "clap.webm" }, { t: t1, type: "frame" }, { t: t1, type: "stop" });
    const payload = JSON.stringify({
      gps: [],
      motion: [0, 1, 2].map((k) => [t0 + k * 100, 0.3, 9.7, 0.1, 0.2, 0.1, 0]),
      events,
      frameSha: last ? sha256hex(JPEG) : null,
      check: last ? { ok: true, reason: "keep going", mode: "on_device", label: "hands" } : null,
    });
    const c: ChunkDoc = { seq, t0, t1, prevHash: prev, payload, hash: "", frame: last ? { jpegB64: JPEG, w: 640, h: 480, t: t1 } : null };
    c.hash = chunkHash(c);
    prev = c.hash;
    chunks.push(c);
  }
  return chunks;
}

const CLAIMS: Claim[] = [
  { id: "c1", kind: "action", text: "clapping" },
  { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
];
const PLAN = {
  requirements: [
    { id: "r1", claimId: "c1", evidence: "video" as const, ask: "Clap on camera" },
    { id: "r2", claimId: "c2", evidence: "video" as const, ask: "All 50 claps in one clip", minSeconds: 20 },
  ],
  recordMode: "video" as const,
  note: "",
  source: "ai" as const,
};
const clip = (o: Record<string, unknown> = {}) => ({ sha256: CLIP_SHA, ext: "webm", durationMs: 35000, startedAt: T0 + 500, uploaded: true, hashOk: true, ...o });
const DONE = {
  status: "done",
  clips: [clip()],
  claims: [
    { id: "c1", verdict: "backed", confidence: 0.9, reasons: ["hands"] },
    { id: "c2", verdict: "backed", confidence: 0.8, reasons: ["counted 50"], measured: { value: 50, unit: "claps" } },
  ],
  cheating: { detected: false, signals: [] },
  summary: "One clip of 50 claps",
  attempts: 1,
  reason: null,
  model: "m",
  ranAt: 1,
};

function clapMoment(o: Record<string, unknown> = {}): MomentDoc {
  const chunks = clapChunks();
  return {
    ownerUid: "alice",
    intention: { text: "Clap 50 times", category: "other" },
    status: "submitted",
    startedAt: T0,
    endedAt: chunks[chunks.length - 1].t1,
    chunkCount: chunks.length,
    headHash: chunks[chunks.length - 1].hash,
    // The production failure: the frames judge only saw one still frame.
    judge: { verdict: "uncertain", confidence: 0.5, reasons: ["Single frame cannot verify the count"], claims: [] },
    skeptic: { verdict: "consistent", confidence: 0.7, reasons: [] },
    score: { probability: 0.4, reasons: [] },
    bar: { value: 0.55, difficulty: 0.1, rationale: "r", factors: [], source: "ai", model: "m", ranAt: 0 },
    claims: { items: CLAIMS, source: "ai", model: "m", ranAt: 0 },
    plan: PLAN,
    videoReview: DONE,
    seal: null,
    ...o,
  } as MomentDoc;
}

describe("seal v4 readiness: waits for bar + claims, then the clip (v4.3, v4.4)", () => {
  it("barAndClaims runs while bar or claims is missing; a v3 bar is kept by the agent", () => {
    expect(needsBarAndClaims(clapMoment({ bar: null, claims: null }))).toBe(true);
    expect(needsBarAndClaims(clapMoment({ claims: null }))).toBe(true);
    expect(needsBarAndClaims(clapMoment())).toBe(false);
    expect(needsBarAndClaims(clapMoment({ claims: null, seal: { version: 3 } }))).toBe(false);
  });
  it("the seal waits while the video review is missing, waiting or running", () => {
    for (const vr of [null, { status: "waiting" }, { status: "running" }]) {
      const m = clapMoment({ videoReview: vr });
      expect(needsVideoReview(m)).toBe(true);
      expect(isReadyToSealV4(m)).toBe(false);
    }
    for (const status of ["done", "failed", "expired", "none"]) {
      const m = clapMoment({ videoReview: { ...DONE, status } });
      expect(needsVideoReview(m)).toBe(false);
      expect(isReadyToSealV4(m)).toBe(true);
    }
    expect(needsVideoReview(clapMoment({ videoReview: null, claims: null }))).toBe(false);
    expect(isReadyToSealV4(clapMoment({ judge: null }))).toBe(false);
  });
  it("24 h fallback: a clip that never arrives expires after VIDEO_WAIT_MS", () => {
    expect(videoWaitExpired(1_000, 1_000 + VIDEO_WAIT_MS - 1)).toBe(false);
    expect(videoWaitExpired(1_000, 1_000 + VIDEO_WAIT_MS)).toBe(true);
    expect(videoWaitExpired(null, Date.now())).toBe(false);
  });
  it("review steps: none, waiting, 24 h expiry, oversize clips never block, attempts are bounded", () => {
    const vid = (n: string, bytes: number | null = 1000) => ({ t: 0, sha256: n.repeat(64), bytes, durationMs: 30_000, startedAt: 0, name: null });
    const small = vid("a");
    const huge = vid("b", MAX_CLIP_BYTES);
    expect(nextReviewStep([], [], 0, false)).toEqual({ kind: "none" });
    // the clip has not arrived: wait; after 24 h seal without it
    expect(nextReviewStep([small], clipList([small], new Map()), 0, false)).toEqual({ kind: "waiting" });
    expect(nextReviewStep([small], clipList([small], new Map()), 0, true)).toEqual({ kind: "expired", reason: "video never arrived" });
    // over the Storage limit: the client never uploads it, so no 24 h wait
    expect(nextReviewStep([huge], clipList([huge], new Map()), 0, false)).toEqual({ kind: "expired", reason: "video too large to upload" });
    expect(tooLargeToUpload({ bytes: MAX_CLIP_BYTES - 1 })).toBe(false);
    // an oversize clip next to an uploaded one: review the uploaded one now
    expect(nextReviewStep([huge, small], clipList([huge, small], new Map([[small.sha256, "webm"]])), 0, false)).toEqual({ kind: "run", attempt: 1 });
    // a missing small clip still waits even when another clip is there
    expect(nextReviewStep([small, huge], clipList([small, huge], new Map([[huge.sha256, "mp4"]])), 0, false)).toEqual({ kind: "waiting" });
    // attempts are counted before the work: a run that keeps dying stops after MAX_REVIEW_ATTEMPTS
    const up = clipList([small], new Map([[small.sha256, "mp4"]]));
    expect(nextReviewStep([small], up, 1, false)).toEqual({ kind: "run", attempt: 2 });
    expect(nextReviewStep([small], up, MAX_REVIEW_ATTEMPTS, false)).toEqual({ kind: "failed" });
  });
});

describe("seal v4 evaluation (v4.5, v4.6)", () => {
  const chunks = clapChunks();
  it("clap 50 times: the video review backs both claims → minimum evidence earns the bar, no paid module", () => {
    const e = evaluateSealV4(ID, clapMoment(), chunks);
    expect(e.base.checks).toMatchObject({ chain: true, timing: true, physics: true, frames: true });
    expect(e.score.claims.map((c) => [c.id, c.p, c.met, c.backedBy])).toEqual([
      ["c1", 0.55, ["r1"], ["video_review"]],
      ["c2", 0.55, ["r2"], ["video_review"]],
    ]);
    expect(e.score.sealed).toBe(true);
    expect(e.score.score).toBe(0.55);
    expect(e.reason).toBe("All 2 claims backed · score 0.55 ≥ bar 0.55");
    const f = feedV4Fields(e.claims, e.score.claims, e.plan, e.bar, e.score.checks, e.score.cheating.signals, DONE as never);
    expect(f).toMatchObject({ sealVersion: 4, claimsBacked: 2, claimsTotal: 2, cheating: false, video: { reviewed: true, summary: "One clip of 50 claps", status: "done" } });
    expect(f.plan.requirements.map((r) => r.met)).toEqual([true, true]);
  });
  it("the clip expired after 24 h: video requirements unmet, no cheating, stays at the baseline", () => {
    const e = evaluateSealV4(ID, clapMoment({ videoReview: { ...DONE, status: "expired", claims: [], clips: [clip({ uploaded: false, ext: null, hashOk: null })] } }), chunks);
    expect(e.score.checks.cheating).toBe(true);
    expect(e.score.sealed).toBe(false);
    expect(e.reason).toBe("0 of 2 claims backed · clapping 0.40 < bar 0.55");
  });
  it("clip hash mismatch is cheating: capped at 0.1, rejected with the signal", () => {
    const e = evaluateSealV4(ID, clapMoment({ videoReview: { ...DONE, clips: [clip({ hashOk: false })], claims: [] } }), chunks);
    expect(e.score.cheating).toEqual({ detected: true, signals: ["video: clip does not match the chain"] });
    expect(e.score.claims.every((c) => c.p === 0.1)).toBe(true);
    expect(e.score.ladderEligible).toBe(false);
    expect(e.reason).toBe("Cheating detected: video: clip does not match the chain");
  });
  it("no client scorer: baseline 0.2, still Verified with the minimum evidence", () => {
    const e = evaluateSealV4(ID, clapMoment({ score: null }), chunks);
    expect(e.score.baselineUsed).toBe(0.2);
    expect(e.score.sealed).toBe(true);
  });
  it("a broken chain is cheating and the reason says so first", () => {
    const bad = clapChunks();
    bad[3] = { ...bad[3], payload: bad[3].payload.replace("0.3", "0.4") };
    const e = evaluateSealV4(ID, clapMoment(), bad);
    expect(e.score.checks.chain).toBe(false);
    expect(e.reason.startsWith("Cheating detected: chain: hashes do not link")).toBe(true);
  });
});

// ───────────────────────────────── free video review with the fake engine (v4.4)

describe("video review (v4.4)", () => {
  const facts = chainFacts(clapChunks());
  const call = (o: Record<string, unknown> = {}) => ({
    moment: clapMoment(o),
    facts,
    claims: CLAIMS,
    plan: PLAN,
    clips: [{ ...clip(), gsUri: `gs://b/clips/alice/${ID}/${CLIP_SHA}.webm` }],
  });
  it("fake engine backs each claim and reports the count it 'measured'", async () => {
    const a = await runVideoReview(call() as never, fakeEngine);
    expect(a.model).toBe("fake-emulator");
    expect(a.claims.map((c) => [c.id, c.verdict, c.confidence])).toEqual([
      ["c1", "backed", 0.85],
      ["c2", "backed", 0.85],
    ]);
    expect(a.claims[1].measured).toEqual({ value: 50, unit: "claps" });
    expect(a.cheating).toEqual({ detected: false, signals: [] });
  });
  it("sends the clips as gs:// fileData and the server claims, plan, sensors", async () => {
    let seen: AiCall | undefined;
    await runVideoReview(call() as never, engine({ claims: [], cheating: { detected: false, signals: [] }, summary: "" }, (c) => (seen = c)));
    expect(seen!.prompt).toBe("videoReview");
    expect(seen!.media).toEqual([{ fileData: { fileUri: `gs://b/clips/alice/${ID}/${CLIP_SHA}.webm`, mimeType: "video/webm" } }]);
    expect(JSON.parse(seen!.vars.claims)).toEqual(CLAIMS);
    expect(JSON.parse(seen!.vars.plan).requirements).toHaveLength(2);
    expect(JSON.parse(seen!.vars.clips)).toEqual([{ sha256: CLIP_SHA, atS: 1, durationS: 35 }]);
    expect(JSON.parse(seen!.vars.sensors)).toHaveProperty("motionReps");
  });
  it("cheating signals and failures from the fake engine", async () => {
    const cheat = await runVideoReview(call({ intention: { text: "Clap 50 times #video-cheat", category: "other" } }) as never, fakeEngine);
    expect(cheat.cheating).toEqual({ detected: true, signals: ["loop: the same 3 s repeat"] });
    await expect(runVideoReview(call({ intention: { text: "Clap #ai-fail", category: "other" } }) as never, fakeEngine)).rejects.toThrow();
    await expect(runVideoReview(call() as never, engine({ summary: "no claims" }))).rejects.toThrow();
  });
  it("coerces verdicts to the server claim ids", () => {
    expect(
      coerceVerdicts(
        [
          { id: "c1", verdict: "backed", confidence: 1.7, reasons: ["a", "b", "c", "d"] },
          { id: "c1", verdict: "not_backed", confidence: 1 },
          { id: "c9", verdict: "backed", confidence: 1 },
          { id: "c2", verdict: "maybe", confidence: 1 },
        ],
        ["c1", "c2"],
      ),
    ).toEqual([{ id: "c1", verdict: "backed", confidence: 1, reasons: ["a", "b", "c"] }]);
  });
  it("clip list: chain order, uploaded flags, ≤ 3 last matching clips are watched", () => {
    const vids = ["1", "2", "3", "4", "5"].map((n, i) => ({ t: i, sha256: n.repeat(64), bytes: 1, durationMs: 1000, startedAt: i, name: null }));
    const found = new Map(vids.slice(0, 4).map((v) => [v.sha256, "mp4"]));
    const list = clipList(vids, found);
    expect(list.map((c) => c.uploaded)).toEqual([true, true, true, true, false]);
    expect(list.every((c) => c.hashOk === null)).toBe(true);
    const checked = clipList(vids, found, new Map(vids.map((v, i) => [v.sha256, i !== 2])));
    expect(clipsForReview(checked).map((c) => c.sha256[0])).toEqual(["1", "2", "4"]);
    expect(parseClipPath(`clips/u1/${ID}/${CLIP_SHA}.webm`)).toEqual({ uid: "u1", momentId: ID, sha256: CLIP_SHA, ext: "webm" });
    expect(parseClipPath(`clips/u1/${ID}/${CLIP_SHA}.exe`)).toBeNull();
  });
});

// ───────────────────────────────── modules per claim (v4.6)

describe("ladder modules back claim kinds (v4.6)", () => {
  const facts = chainFacts(clapChunks());
  it("count_measure needs a count/measure claim (typed intentions included)", () => {
    const cm = getModule("count_measure")!;
    expect(unmetNeedV4(cm, facts, CLAIMS)).toBeNull();
    expect(unmetNeedV4(cm, facts, [CLAIMS[0]])).toBe("needs_quantities");
    expect(unmetNeedV4(getModule("full_video")!, facts, CLAIMS)).toBeNull();
  });
  it("modules move only the claims of the kinds they back; witness_review only targeted ones", () => {
    const reqs = PLAN.requirements;
    const ids = (m: string, w = [] as Array<{ wid: string; rid: string | null; answered: boolean }>) => {
      const d = getModule(m)!;
      return claimsBackedByModule(CLAIMS, reqs, w, { backs: d.backs, targetedOnly: d.backsTargetedOnly });
    };
    expect(ids("second_look")).toEqual(["c1"]);
    expect(ids("count_measure")).toEqual(["c2"]);
    expect(ids("place_time")).toEqual([]);
    expect(ids("full_video")).toEqual(["c1", "c2"]);
    expect(ids("witness_review", [{ wid: "w1", rid: "r2", answered: true }])).toEqual(["c2"]);
    expect(ids("witness_review", [{ wid: "w1", rid: null, answered: true }])).toEqual(["c1", "c2"]);
  });
  it("module prompt gets only its claims and returns per-claim verdicts (fake engine)", async () => {
    let seen: AiCall | undefined;
    const spy: AiEngine = { name: "spy", generateJson: (c) => ((seen = c), fakeEngine.generateJson(c)) };
    const a = await runModule("count_measure", { momentId: ID, moment: clapMoment(), facts, claims: [CLAIMS[1]] }, spy);
    expect(JSON.parse(seen!.vars.claims)).toEqual([CLAIMS[1]]);
    expect(JSON.parse(seen!.vars.quantities)).toEqual([{ metric: "claps", value: 50, unit: "claps" }]);
    expect(a.claims).toEqual([{ id: "c2", verdict: "backed", confidence: 0.8, reasons: [expect.any(String)] }]);
  });
  it("applies a module per claim from sealP and records per-claim outcomes", () => {
    // The count stayed unmet (video unsure), count_measure backs it: lifts it past the bar; the action is untouched.
    const base = [
      { id: "c1", met: ["r1"], unmet: [], minimumMet: true, backedBy: ["video_review"], sealP: 0.55 },
      { id: "c2", met: [], unmet: ["r2"], minimumMet: false, backedBy: [], sealP: 0.4 },
    ];
    const verdicts = [{ id: "c2", verdict: "backed" as const, confidence: 0.9, reasons: ["50 peaks", "x", "y"], measured: { value: 50, unit: "claps" } }];
    const r = applyLadderV4(base, false, [{ module: "count_measure", strength: 0.3, backedIds: ["c2"], claims: verdicts }]);
    expect(r.claims[0].p).toBe(0.55);
    expect(r.claims[1].p).toBeCloseTo(0.4 + 0.3 * 0.6, 12);
    expect(r.claims[1].backedBy).toEqual(["count_measure"]);
    expect(r.score).toBe(0.55);
    const out = moduleOutcomes(r.ladder[0], verdicts);
    expect(out).toEqual([{ id: "c2", verdict: "backed", confidence: 0.9, passed: true, before: 0.4, after: r.claims[1].p, reasons: ["50 peaks", "x"], measured: { value: 50, unit: "claps" } }]);
    // A backed claim with no verdict from the model counts as a fail ("missing").
    const miss = applyLadderV4(base, false, [{ module: "full_video", strength: 0.45, backedIds: ["c1", "c2"], claims: [{ id: "c1", verdict: "backed", confidence: 0.95 }] }]);
    expect(moduleOutcomes(miss.ladder[0], [{ id: "c1", verdict: "backed", confidence: 0.95 }]).map((o) => [o.id, o.verdict, o.passed])).toEqual([
      ["c1", "backed", true],
      ["c2", "missing", false],
    ]);
    expect(miss.ladder[0].passed).toBe(false);
  });
});
