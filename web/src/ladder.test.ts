import { describe, expect, it } from "vitest";
import v3 from "../../shared/test-vectors-v3.json";
import { applyStep, countsAsPass, evidenceOf, FREE_CREDITS, MODULES, offers, offersV4, previews, reasonText, replay } from "./ladder";

describe("v4 offers: modules back claim kinds (docs/ARCHITECTURE.md v4.6)", () => {
  const claims = [
    { id: "c1", kind: "action" as const, text: "clapping" },
    { id: "c2", kind: "count" as const, text: "50 claps", metric: "claps", value: 50, unit: "claps" },
  ];
  const requirements = [
    { id: "r1", claimId: "c1", evidence: "video" as const, ask: "a" },
    { id: "r2", claimId: "c2", evidence: "video" as const, ask: "b", minSeconds: 20 },
  ];
  const scores = [
    { id: "c1", p: 0.52, sealP: 0.52, met: ["r1"], unmet: [], minimumMet: true, backedBy: ["video_review"] },
    { id: "c2", p: 0.4, sealP: 0.4, met: [], unmet: ["r2"], minimumMet: false, backedBy: [] },
  ];
  const ev = { frames: 2, gps: 10, witnessAnswered: 0, quantities: 0, videos: ["a".repeat(64)] };
  const list = offersV4({ claims, requirements, scores, modules: [], witness: [] }, ev, 10);
  const by = (id: string) => list.find((o) => o.module.id === id)!;
  it("count_measure is offered for the count (typed intentions too) with the spec's previews", () => {
    const o = by("count_measure");
    expect(o.state).toBe("ready");
    if (o.state !== "ready") return;
    expect(o.claims.map((c) => c.id)).toEqual(["c2"]);
    expect(o.claims[0].pass).toBeCloseTo(0.58, 9);
    expect(o.claims[0].fail).toBeCloseTo(0.28, 9);
    expect(o.pass).toBeCloseTo(0.52, 9); // min(0.52, 0.58)
    expect(o.cappedBy.map((c) => c.id)).toEqual(["c1"]); // the action claim (0.52) now holds the Moment down
  });
  it("names the claim that keeps the Moment score flat when a module only backs the other one", () => {
    // Shape of a real Moment: "sing the alphabet (action) in under 30 s (measure)", both at 0.22.
    const cs = [
      { id: "c1", kind: "action" as const, text: "singing the alphabet song" },
      { id: "c2", kind: "measure" as const, text: "under 30 seconds", metric: "duration", value: 30, unit: "s" },
    ];
    const sc = cs.map((c) => ({ id: c.id, p: 0.22, sealP: 0.22, met: [], unmet: [], minimumMet: false, backedBy: [] }));
    const o = offersV4({ claims: cs, requirements: [], scores: sc, modules: [], witness: [] }, ev, 10).find((x) => x.module.id === "second_look")!;
    if (o.state !== "ready" && o.state !== "blocked") throw new Error(o.state);
    expect(o.claims[0].pass).toBeCloseTo(0.376, 9); // the claim itself rises
    expect(o.pass).toBeCloseTo(0.22, 9); // the Moment doesn't: it is its weakest claim
    expect(o.cappedBy.map((c) => c.text)).toEqual(["under 30 seconds"]);
  });
  it("place_time backs no claim here; witness_review needs an answered request", () => {
    expect(by("place_time")).toMatchObject({ state: "blocked", reason: "Backs none of this Moment's claims." });
    expect(by("witness_review").state).toBe("blocked");
    expect(by("full_video")).toMatchObject({ state: "ready" });
    expect(by("human_review").state).toBe("soon");
  });
});
import type { Chunk, LadderResult } from "./types";

describe("ladder math (shared/test-vectors-v3.json ladders)", () => {
  for (const [i, l] of v3.ladders.entries()) {
    it(`vector ${i}: ${l.steps.map((s) => `${s.module}:${s.passed ? "pass" : "fail"}`).join(" → ")}`, () => {
      let p = l.baseline;
      for (const s of l.steps) {
        expect(p).toBeCloseTo(s.before, 9);
        p = applyStep(p, s.strength, s.passed);
        expect(p).toBeCloseTo(s.after, 9);
      }
      expect(replay(l.baseline, l.steps)).toBeCloseTo(l.score, 9);
      expect(replay(l.baseline, l.steps) >= l.bar).toBe(l.verified);
    });
  }

  it("previews both outcomes; pass needs confidence >= 0.6", () => {
    expect(previews(0.62, 0.45).pass).toBeCloseTo(0.791, 9);
    expect(previews(0.62, 0.2).fail).toBeCloseTo(0.496, 9);
    expect(countsAsPass(true, 0.6)).toBe(true);
    expect(countsAsPass(true, 0.59)).toBe(false);
    expect(countsAsPass(false, 0.99)).toBe(false);
  });

  it("catalog matches the contract", () => {
    expect(FREE_CREDITS).toBe(10);
    expect(MODULES.map((m) => [m.id, m.cost, m.strength, m.available])).toEqual([
      ["second_look", 1, 0.2, true],
      ["place_time", 1, 0.2, true],
      ["witness_review", 2, 0.3, true],
      ["count_measure", 2, 0.3, true],
      ["full_video", 3, 0.45, true],
      ["human_review", 10, 0.6, false],
    ]);
  });
});

const chunk = (seq: number, payload: object): Chunk => ({ seq, t0: seq, t1: seq + 1, prevHash: "", hash: "", frame: null, payload: JSON.stringify(payload) });

describe("offers", () => {
  const chunks = [
    chunk(0, { gps: [[1, 0, 0, 5, null, null]], motion: [], events: [{ t: 1, type: "start" }], frameSha: null, check: null }),
    chunk(1, { gps: [], motion: [], events: [{ t: 2, type: "frame", wid: "w1" }, { t: 2, type: "witness_answer", wid: "w1", via: "frame" }], frameSha: "ab", check: null }),
  ];
  const ev = evidenceOf(chunks, { text: "x", category: "fishing" });

  it("reads the evidence from the chain", () => {
    expect(ev).toEqual({ frames: 1, gps: 1, witnessAnswered: 1, quantities: 0, videos: [] });
  });

  it("marks done / ready / blocked / soon", () => {
    const done: LadderResult = { runId: "r", module: "second_look", title: "", cost: 1, strength: 0.2, passed: true, confidence: 0.8, before: 0.62, after: 0.696, reasons: [], model: "m", ranAt: 0 };
    const o = Object.fromEntries(offers({ score: 0.696, modules: [done] }, ev, 1).map((x) => [x.module.id, x]));
    expect(o.second_look.state).toBe("done");
    expect(o.place_time.state).toBe("ready");
    expect(o.witness_review.state).toBe("blocked"); // 2 credits, balance 1
    expect(o.count_measure.state).toBe("blocked"); // no quantities
    expect(o.full_video.state).toBe("blocked"); // no video
    expect(o.human_review.state).toBe("soon");
    if (o.place_time.state === "ready") expect(o.place_time.pass).toBeCloseTo(0.696 + 0.2 * 0.304, 9);
  });

  it("explains server reasons", () => {
    expect(reasonText("insufficient_credits", { balance: 1, cost: 3 })).toMatch(/costs 3, you have 1/);
    expect(reasonText("needs_video")).toMatch(/video/);
    expect(reasonText("model_failed")).toMatch(/refunded/);
  });
});
