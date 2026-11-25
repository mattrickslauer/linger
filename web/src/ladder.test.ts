import { describe, expect, it } from "vitest";
import v3 from "../../shared/test-vectors-v3.json";
import { applyStep, countsAsPass, evidenceOf, FREE_CREDITS, MODULES, offers, previews, reasonText, replay } from "./ladder";
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
