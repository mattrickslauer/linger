// v3 server logic: bar agent, ladder math, module runner coercion, credits debit, eligibility.
// Contract: docs/ARCHITECTURE.md v3.3 - v3.7; vectors: shared/test-vectors-v3.json.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiCall, AiEngine, fakeEngine } from "../src/ai";
import { barContext, computeBar, defaultBar, fakeDifficulty, intentionForModel, runModule } from "../src/agents";
import { STALE_RUN_MS, eligibility, isStaleRun, validateRunRequest } from "../src/callable";
import { debit, withGrant } from "../src/credits";
import {
  applyStep,
  barFromDifficulty,
  chainFacts,
  countMotionReps,
  countsAsPass,
  resealAfterLadder,
  scoreFromResults,
  sunElevationDeg,
  unmetNeed,
  witnessCounts,
} from "../src/ladder";
import { ChunkDoc, MomentDoc } from "../src/seal";
import { getLadder, getModule } from "../src/shared";

const v3 = JSON.parse(readFileSync(new URL("../../shared/test-vectors-v3.json", import.meta.url), "utf8"));

const engine = (answer: unknown, onCall?: (c: AiCall) => void): AiEngine => ({
  name: "test",
  async generateJson(c) {
    onCall?.(c);
    if (answer instanceof Error) throw answer;
    return { data: answer as Record<string, unknown>, model: "test-model" };
  },
});

function moment(over: Partial<MomentDoc> = {}): MomentDoc {
  return {
    ownerUid: "alice",
    status: "submitted",
    startedAt: Date.UTC(2026, 10, 25, 14, 0),
    endedAt: null,
    chunkCount: 0,
    headHash: null,
    intention: { text: "Catch a largemouth bass at Lake Mission Viejo", category: "fishing" },
    summary: { start: { lat: 33.6, lng: -117.66 } } as MomentDoc["summary"],
    judge: { verdict: "consistent", confidence: 0.9, reasons: ["bass visible"] },
    skeptic: { verdict: "consistent", confidence: 0.8, reasons: [] },
    score: { probability: 0.62, reasons: [] },
    seal: null,
    ...over,
  };
}

describe("bar (v3.3)", () => {
  it("maps difficulty with round2(0.5 + 0.45 * clamp01(d)) for every vector", () => {
    for (const b of v3.bars) expect(barFromDifficulty(b.difficulty)).toBe(b.bar);
  });

  it("computeBar uses the model's difficulty; code sets the value", async () => {
    let seen: AiCall | null = null;
    const bar = await computeBar(moment(), engine({ difficulty: 0.67, rationale: "Trophy bass in late autumn", factors: ["species", "season", "x", "y", "z"] }, (c) => (seen = c)), 123);
    expect(bar).toEqual({ value: 0.8, difficulty: 0.67, rationale: "Trophy bass in late autumn", factors: ["species", "season", "x", "y"], source: "ai", model: "test-model", ranAt: 123 });
    expect(seen!.prompt).toBe("bar");
    expect(JSON.parse(seen!.vars.context)).toMatchObject({ lat: 33.6, lng: -117.66, hemisphere: "N", month: 11 });
  });

  it("clamps out-of-range difficulty and never trusts a model-sent value", async () => {
    const bar = await computeBar(moment(), engine({ difficulty: 7, value: 0.1, rationale: "", factors: [] }));
    expect(bar.value).toBe(0.95);
    expect(bar.difficulty).toBe(1);
    expect(bar.rationale).toBe("Set from the claim");
  });

  it("falls back to the default bar (seal v2 behaviour) on any model failure", async () => {
    for (const bad of [new Error("down"), { rationale: "no difficulty" }, { difficulty: "lots" }]) {
      const bar = await computeBar(moment(), engine(bad), 5);
      expect(bar).toEqual(defaultBar(5));
      expect(bar.value).toBe(0.5);
      expect(bar.source).toBe("default");
    }
  });

  it("the client's bar preview never reaches the bar agent", async () => {
    let seen: AiCall | null = null;
    const intention = { text: "x", category: "fishing", v: 3, preview: { bar: 0.95, difficulty: 1, mode: "on_device" } };
    await computeBar(moment({ intention }), engine({ difficulty: 0.2, rationale: "r", factors: [] }, (c) => (seen = c)));
    expect(seen!.vars.intention).not.toMatch(/preview/);
    expect(intentionForModel(intention)).toEqual({ text: "x", category: "fishing", v: 3 });
  });

  it("v1 intentions and missing GPS still get a context", () => {
    const c = barContext({ startedAt: 0, summary: null, intention: { text: "t", category: "other" } });
    expect(c).toMatchObject({ lat: null, lng: null, hemisphere: null, place: null });
  });

  it("the emulator's fake engine is deterministic and seals the demo seeds", async () => {
    expect(fakeDifficulty({ text: "Hike up for sunrise", category: "outdoors" })).toBe(0.1);
    expect(fakeDifficulty({ text: "A trophy bass", category: "fishing", quantities: [{ metric: "weight" }] })).toBe(0.6);
    const bar = await computeBar(moment(), fakeEngine);
    expect(bar).toMatchObject({ value: 0.59, source: "ai", model: "fake-emulator" });
    expect((await computeBar(moment({ intention: { text: "#ai-fail", category: "other" } }), fakeEngine)).source).toBe("default");
  });
});

describe("ladder math (v3.6)", () => {
  it("reproduces every ladder vector in run order", () => {
    for (const l of v3.ladders) {
      let p = l.baseline;
      for (const s of l.steps) {
        expect(getModule(s.module)?.strength).toBe(s.strength);
        expect(s.before).toBe(p);
        p = applyStep(p, s.strength, s.passed);
        expect(p).toBe(s.after);
      }
      expect(scoreFromResults(l.baseline, l.steps)).toBe(l.score);
      expect(l.score >= l.bar).toBe(l.verified);
    }
  });
  it("a pass needs passed && confidence >= 0.6", () => {
    const c = getLadder().passConfidence;
    expect(c).toBe(0.6);
    expect(countsAsPass(true, 0.6, c)).toBe(true);
    expect(countsAsPass(true, 0.59, c)).toBe(false);
    expect(countsAsPass(false, 0.99, c)).toBe(false);
    expect(countsAsPass("true", 0.9, c)).toBe(false);
  });
  it("score math: pass p+s(1-p), fail p(1-s), order of results matters only through the path", () => {
    expect(applyStep(0.62, 0.2, true)).toBeCloseTo(0.696, 12);
    expect(applyStep(0.62, 0.2, false)).toBeCloseTo(0.496, 12);
    const runs = [
      { strength: 0.2, passed: true },
      { strength: 0.45, passed: false },
      { strength: 0.3, passed: true },
    ];
    const manual = applyStep(applyStep(applyStep(0.5, 0.2, true), 0.45, false), 0.3, true);
    expect(scoreFromResults(0.5, runs)).toBe(manual);
    expect(scoreFromResults(0.5, [])).toBe(0.5);
    // A pass with low confidence counts as a fail (the model proposes, code decides).
    expect(countsAsPass(true, 0.59, getLadder().passConfidence)).toBe(false);
    expect(countsAsPass("true", 0.99, getLadder().passConfidence)).toBe(false);
  });
  it("passes and fails stay inside 0..1", () => {
    expect(applyStep(1, 0.45, false)).toBeCloseTo(0.55);
    expect(applyStep(0, 0.45, true)).toBeCloseTo(0.45);
    expect(applyStep(1, 0.45, true)).toBe(1);
  });
});

describe("re-seal after a ladder run (v3.5)", () => {
  const seal = {
    sealed: false,
    checks: { chain: true, timing: true, physics: true, frames: true, ai: true, bar: false },
    reason: "Bar: verification score 0.62 is below the bar 0.80",
    version: 3,
    ladderEligible: true,
  };
  it("a pass can lift a below-bar Moment to sealed", () => {
    const r = resealAfterLadder(seal, 0.8328, 0.8);
    expect(r).toMatchObject({ sealed: true, status: "sealed", checks: { ...seal.checks, bar: true } });
    expect(r.reason).toMatch(/score 0\.83 reaches the bar 0\.80/);
  });
  it("a fail can drop a sealed Moment to rejected", () => {
    const r = resealAfterLadder({ ...seal, sealed: true, checks: { ...seal.checks, bar: true } }, 0.448, 0.55);
    expect(r).toMatchObject({ sealed: false, status: "rejected" });
    expect(r.reason).toMatch(/0\.45 is below the bar 0\.55 after the verification ladder/);
  });
  it("never re-runs or repairs the integrity checks", () => {
    const broken = { ...seal, checks: { ...seal.checks, chain: false }, reason: "Chain: chunk 2 hash mismatch" };
    const r = resealAfterLadder(broken, 0.99, 0.5);
    expect(r.sealed).toBe(false);
    expect(r.checks.chain).toBe(false);
    expect(r.reason).toBe("Chain: chunk 2 hash mismatch");
  });
});

describe("chain facts: witness, frames, video (v3.4)", () => {
  const chunks: ChunkDoc[] = v3.guestChain.chunks.map((c: ChunkDoc) => ({
    ...c,
    frame: JSON.parse(c.payload).frameSha ? { jpegB64: "aGVsbG8=", w: 1, h: 1, t: c.t1 } : null,
  }));
  const facts = chainFacts(chunks);
  it("pairs witness requests with their answers and skips by wid", () => {
    expect(facts.witness.map((w) => w.wid)).toEqual(["w1", "w2", "w3"]);
    expect(facts.witness[0].answer).toMatchObject({ via: "frame", frameSeq: 1 });
    expect(facts.witness[1].answer).toMatchObject({ via: "voice", text: "it's six forty two" });
    expect(witnessCounts(facts)).toEqual({ asked: 3, answered: 2, skipped: 1 });
    expect(facts.frames).toHaveLength(1);
    expect(facts.frames[0].wid).toBe("w1");
  });
  it("needs: witness_answered, frames, gps, quantities, video", () => {
    const L = (id: string) => getModule(id)!;
    expect(unmetNeed(L("witness_review"), facts, null)).toBeNull();
    expect(unmetNeed(L("place_time"), facts, null)).toBeNull();
    expect(unmetNeed(L("count_measure"), facts, { text: "", quantities: [] })).toBe("needs_quantities");
    expect(unmetNeed(L("count_measure"), facts, { text: "", quantities: [{ metric: "count", value: 1, unit: "fish" }] })).toBeNull();
    expect(unmetNeed(L("full_video"), facts, null)).toBe("needs_video");
    expect(unmetNeed(L("second_look"), { ...facts, frames: [] }, null)).toBe("needs_frames");
  });
  it("reads chained video events; ignores malformed hashes", () => {
    const sha = "a".repeat(64);
    const payload = JSON.stringify({ gps: [], motion: [], events: [{ t: 5, type: "video", sha256: sha, bytes: 10, durationMs: 3000, startedAt: 1, name: "v.mp4" }, { t: 6, type: "video", sha256: "nope" }], frameSha: null, check: null });
    const f = chainFacts([{ seq: 0, t0: 0, t1: 10, prevHash: "", payload, hash: "" }]);
    expect(f.videos).toEqual([{ t: 5, sha256: sha, bytes: 10, durationMs: 3000, name: "v.mp4" }]);
  });
});

describe("code-computed evidence", () => {
  it("sun elevation: high at local noon, below the horizon at local midnight", () => {
    // Lake Mission Viejo, 25 Nov 2026: solar noon ~19:45 UTC
    expect(sunElevationDeg(33.62, -117.66, Date.UTC(2026, 10, 25, 19, 45))).toBeGreaterThan(30);
    expect(sunElevationDeg(33.62, -117.66, Date.UTC(2026, 10, 25, 19, 45))).toBeLessThan(40);
    expect(sunElevationDeg(33.62, -117.66, Date.UTC(2026, 10, 26, 7, 45))).toBeLessThan(-40);
    // equator, March equinox, noon UTC at lng 0: sun nearly overhead
    expect(sunElevationDeg(0, 0, Date.UTC(2026, 2, 20, 12, 7))).toBeGreaterThan(85);
  });
  it("counts motion reps from the acceleration magnitude", () => {
    const motion = Array.from({ length: 600 }, (_, k) => {
      const t = k * 100;
      return [t, 0, 9.81 + 4 * Math.sin((2 * Math.PI * t) / 1000), 0, 0, 0, 0] as [number, number, number, number, number, number, number];
    });
    const r = countMotionReps(motion);
    expect(r.reps).toBeGreaterThanOrEqual(55);
    expect(r.reps).toBeLessThanOrEqual(61);
    expect(r.cadencePerMin).toBeGreaterThan(50);
    expect(countMotionReps([])).toEqual({ reps: 0, seconds: 0, cadencePerMin: 0 });
  });
});

describe("module runner (server Gemini, coerced)", () => {
  const sealed = moment({ status: "sealed" });
  const facts = chainFacts(
    v3.guestChain.chunks.map((c: ChunkDoc) => ({ ...c, frame: JSON.parse(c.payload).frameSha ? { jpegB64: "aGVsbG8=", w: 1, h: 1, t: c.t1 } : null })),
  );
  it("sends frames as inline JPEG and coerces the answer", async () => {
    let seen: AiCall | null = null;
    const a = await runModule(
      "count_measure",
      { momentId: "m", moment: { ...sealed, intention: { text: "t", category: "fishing", quantities: [{ metric: "count", value: 1, unit: "fish" }] } }, facts },
      engine({ passed: true, confidence: 1.4, reasons: ["ok", 3, "", "b"], measured: [{ metric: "length", value: "41", unit: "cm" }, { metric: "x", value: "n/a", unit: "" }] }, (c) => (seen = c)),
    );
    expect(seen!.prompt).toBe("moduleCountMeasure");
    expect(seen!.media).toEqual([{ inlineData: { mimeType: "image/jpeg", data: "aGVsbG8=" } }]);
    expect(JSON.parse(seen!.vars.sensors)).toMatchObject({ frameCount: 1, gpsFixes: facts.gps.length });
    expect(a).toEqual({ passed: true, confidence: 1, reasons: ["ok", "b"], measured: [{ metric: "length", value: 41, unit: "cm" }], model: "test-model" });
  });
  it("witness review sees each request and its answer", async () => {
    let seen: AiCall | null = null;
    await runModule("witness_review", { momentId: "m", moment: sealed, facts }, engine({ passed: false, confidence: 0.9, reasons: [] }, (c) => (seen = c)));
    const w = JSON.parse(seen!.vars.witness);
    expect(w.map((x: { wid: string }) => x.wid)).toEqual(["w1", "w2", "w3"]);
    expect(w[2].skipped).toBeTruthy();
    expect(seen!.vars.frameOffsets).toMatch(/^w1 at \d+s$/);
  });
  it("full_video passes the uploaded clip by gs:// URI", async () => {
    let seen: AiCall | null = null;
    const clip = { gsUri: "gs://b/clips/alice/m/x.mp4", mimeType: "video/mp4", sha256: "x", bytes: 1, durationMs: 1000 };
    await runModule("full_video", { momentId: "m", moment: sealed, facts, clip }, engine({ passed: true, confidence: 0.7, reasons: [] }, (c) => (seen = c)));
    expect(seen!.media![0]).toEqual({ fileData: { fileUri: clip.gsUri, mimeType: "video/mp4" } });
  });
  it("throws (so the caller refunds) when the model gives no boolean verdict or fails", async () => {
    await expect(runModule("second_look", { momentId: "m", moment: sealed, facts }, engine({ passed: "yes", confidence: 1, reasons: [] }))).rejects.toThrow();
    await expect(runModule("second_look", { momentId: "m", moment: sealed, facts }, engine(new Error("down")))).rejects.toThrow("down");
  });
});

describe("credits (v3.6): grant once, debit either way", () => {
  it("grants the free demo credits on first use only", () => {
    expect(withGrant(undefined)).toEqual({ credits: { balance: 10, granted: 10, spent: 0 }, justGranted: true });
    expect(withGrant({ balance: 3, granted: 10, spent: 7 })).toEqual({ credits: { balance: 3, granted: 10, spent: 7 }, justGranted: false });
  });
  it("a session of spends and one refund keeps balance = granted - spent", () => {
    let c = withGrant(undefined).credits;
    for (const id of ["second_look", "place_time", "count_measure", "full_video"]) c = debit(c, getModule(id)!.cost);
    c = debit(c, -getModule("place_time")!.cost); // refund
    expect(c).toEqual({ balance: 10 - 1 - 2 - 3, granted: 10, spent: 6 });
    expect(c.balance).toBe(c.granted - c.spent);
    expect(withGrant({ balance: 0, granted: 10, spent: 10 }).justGranted).toBe(false); // never re-granted
  });
  it("module debit moves balance and spent; a refund reverses it exactly", () => {
    const start = withGrant(undefined).credits;
    const afterVideo = debit(start, getModule("full_video")!.cost);
    expect(afterVideo).toEqual({ balance: 7, granted: 10, spent: 3 });
    expect(debit(afterVideo, -3)).toEqual(start);
  });
});

describe("runLadderModule request + eligibility", () => {
  const id = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
  it("validates input with typed reasons", () => {
    expect(validateRunRequest({ momentId: id, module: "second_look", requestId: id })).toEqual({ momentId: id, module: "second_look", requestId: id });
    const reason = (d: unknown) => {
      try {
        validateRunRequest(d);
        return null;
      } catch (e) {
        return (e as { details?: { reason?: string } }).details?.reason;
      }
    };
    expect(reason({})).toBe("bad_request");
    expect(reason({ momentId: "a/b", module: "second_look", requestId: id })).toBe("bad_request");
    expect(reason({ momentId: id, module: "buy_score", requestId: id })).toBe("bad_module");
    expect(reason({ momentId: id, module: "full_video", requestId: id, clipSha: "ABC" })).toBe("bad_request");
  });
  it("requestId must be a UUID, so it can never collide with the ledger's own ids", () => {
    const reason = (requestId: unknown) => {
      try {
        validateRunRequest({ momentId: id, module: "second_look", requestId });
        return null;
      } catch (e) {
        return (e as { details?: { reason?: string } }).details?.reason;
      }
    };
    expect(reason(id.toUpperCase())).toBeNull(); // iOS UUID().uuidString
    expect(reason("grant")).toBe("bad_request");
    expect(reason(`${id}-refund`)).toBe("bad_request");
    expect(reason("abcdefgh-refund")).toBe("bad_request");
    expect(reason(undefined)).toBe("bad_request");
  });
  it("a run with neither result nor refund is settled only after the stale window", () => {
    const now = Date.UTC(2026, 10, 25, 12);
    expect(STALE_RUN_MS).toBeGreaterThan(300_000); // longer than runLadderModule's timeout
    expect(isStaleRun(now - 60_000, now)).toBe(false);
    expect(isStaleRun(now - STALE_RUN_MS, now)).toBe(true);
    expect(isStaleRun(undefined, now)).toBe(false);
    expect(isStaleRun(NaN, now)).toBe(false);
  });
  it("only sealed/rejected v3 Moments that are ladderEligible; each module once", () => {
    const seal = { sealed: true, checks: {}, reason: "", version: 3, ladderEligible: true };
    const v = { version: 3, baseline: 0.62, score: 0.62, bar: 0.8, verified: false, modules: [] as unknown[] };
    const m = (o: Partial<MomentDoc>) => moment({ status: "rejected", seal, verification: v, ...o });
    expect(eligibility(m({}), "second_look", "r1")).toBeNull();
    expect(eligibility(m({ status: "submitted" }), "second_look", "r1")).toBe("not_sealed_yet");
    expect(eligibility(m({ seal: { ...seal, version: 2 } }), "second_look", "r1")).toBe("not_sealed_yet");
    expect(eligibility(m({ seal: { ...seal, ladderEligible: false } }), "second_look", "r1")).toBe("not_eligible");
    expect(eligibility(m({ verification: { ...v, modules: [{ module: "second_look" }] } }), "second_look", "r1")).toBe("already_run");
    expect(eligibility(m({ verification: { ...v, pending: { second_look: "r0" } } }), "second_look", "r1")).toBe("already_run");
    expect(eligibility(m({ verification: { ...v, pending: { second_look: "r1" } } }), "second_look", "r1")).toBeNull();
  });
});
