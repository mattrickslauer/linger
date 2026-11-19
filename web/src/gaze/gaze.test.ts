import { describe, expect, it } from "vitest";
import { AttentionEngine, DEFAULT_ATTENTION, type AttentionEvent, type Target } from "./attention";
import { fitRidge, predictRidge } from "./ridge";
import { OneEuro } from "./oneEuro";
import { gazeFeatures } from "./features";

const col = { left: 100, right: 700 };
const targets: Target[] = [
  { id: "p0", index: 0, rect: { top: 0, bottom: 200, ...col }, words: 40 },
  { id: "p1", index: 1, rect: { top: 300, bottom: 500, ...col }, words: 40 },
  { id: "p2", index: 2, rect: { top: 600, bottom: 800, ...col }, words: 40 },
];
const at = (id: string) => {
  const r = targets.find((t) => t.id === id)!.rect;
  return { x: 400, y: (r.top + r.bottom) / 2 };
};

function run(eng: AttentionEngine, id: string | null, from: number, to: number, step = 33) {
  const ev: AttentionEvent[] = [];
  for (let t = from; t <= to; t += step) ev.push(...eng.update(id ? at(id) : null, t, targets));
  return ev;
}

describe("AttentionEngine", () => {
  it("focuses after the dwell time, not before", () => {
    const e = new AttentionEngine();
    expect(run(e, "p0", 0, 500)).toEqual([]);
    expect(run(e, "p0", 533, 700)).toEqual([{ type: "focus", id: "p0" }]);
  });

  it("does not switch blocks on a brief glance (hysteresis)", () => {
    const e = new AttentionEngine();
    run(e, "p0", 0, 1000);
    run(e, "p1", 1033, 1150); // < switchMs
    expect(e.currentId).toBe("p0");
  });

  it("flags long dwell relative to block length", () => {
    const e = new AttentionEngine();
    const limit = e.stuckAfter(targets[0]); // 40 words @200wpm ×1.6 = 19.2s
    const ev = run(e, "p0", 0, limit + 100, 100);
    expect(ev).toContainEqual({ type: "stuck", id: "p0", reason: "long-dwell" });
    expect(ev.filter((x) => x.type === "stuck")).toHaveLength(1);
  });

  it("never makes a reader wait longer than the ceiling, and never fires before the floor", () => {
    const e = new AttentionEngine();
    const long = { ...targets[0], words: 400 };
    const short = { ...targets[0], words: 5 };
    expect(e.stuckAfter(long)).toBe(DEFAULT_ATTENTION.maxStuckMs);
    expect(e.stuckAfter(short)).toBe(DEFAULT_ATTENTION.minStuckMs);
  });

  it("flags a re-read when the reader goes back to an earlier block", () => {
    const e = new AttentionEngine();
    let t = 0;
    run(e, "p0", t, (t += 2000));
    run(e, "p1", (t += 33), (t += 2000));
    const ev = run(e, "p0", (t += 33), (t += 1500));
    expect(ev).toContainEqual({ type: "stuck", id: "p0", reason: "reread" });
  });

  it("blurs when the face is lost", () => {
    const e = new AttentionEngine();
    run(e, "p0", 0, 1000);
    const ev = run(e, null, 1033, 1033 + DEFAULT_ATTENTION.lostMs + 100);
    expect(ev).toContainEqual({ type: "blur", id: "p0" });
    expect(e.currentId).toBeNull();
  });
});

describe("ridge calibration", () => {
  it("recovers a noisy linear map", () => {
    const F: number[][] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
    for (let i = 0; i < 200; i++) {
      const a = Math.random();
      const b = Math.random();
      F.push([a + rnd(), b + rnd()]);
      xs.push(1000 * a + 100);
      ys.push(600 * b + 50);
    }
    const m = fitRidge(F, xs, ys, 0.01);
    const p = predictRidge(m, [0.5, 0.5]);
    expect(p.x).toBeCloseTo(600, -1);
    expect(p.y).toBeCloseTo(350, -1);
  });
});

describe("OneEuro", () => {
  it("smooths jitter around a still point", () => {
    const f = new OneEuro(1, 0.007);
    let last = 0;
    for (let t = 0; t < 2000; t += 33) last = f.filter(500 + (t % 66 ? 20 : -20), t);
    expect(Math.abs(last - 500)).toBeLessThan(10);
  });
});

describe("gazeFeatures", () => {
  it("returns null for closed eyes and a fixed-length vector otherwise", () => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const set = (i: number, x: number, y: number) => (lm[i] = { x, y });
    // Right eye open
    set(33, 0.4, 0.4); set(133, 0.46, 0.4); set(159, 0.43, 0.39); set(145, 0.43, 0.41); set(468, 0.43, 0.4);
    // Left eye open
    set(263, 0.6, 0.4); set(362, 0.54, 0.4); set(386, 0.57, 0.39); set(374, 0.57, 0.41); set(473, 0.57, 0.4);
    const f = gazeFeatures(lm);
    expect(f).not.toBeNull();
    expect(f!).toHaveLength(11);
    expect(f![0]).toBeCloseTo(0.5, 5);
    // Close both eyes
    set(145, 0.43, 0.3901); set(374, 0.57, 0.3901);
    expect(gazeFeatures(lm)).toBeNull();
  });
});
