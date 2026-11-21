import { describe, expect, it } from "vitest";
import { GazeAdapter, PointerTrail } from "./adapt";
import { CALIBRATION_POINTS, fit, type Sample } from "./calibration";

// Synthetic eyes: features are a linear function of where you look, plus noise.
let seed = 11;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
const eyes = (p: { x: number; y: number }, drift = { x: 0, y: 0 }) => {
  const u = p.x / 1200 + drift.x;
  const v = p.y / 800 + drift.y;
  return [u + noise(), v + noise(), (u + noise()) * (v + noise())];
};

function calibrated() {
  const base: Sample[] = CALIBRATION_POINTS.flatMap((p, i) =>
    Array.from({ length: 12 }, () => {
      const s = { x: p.x * 1200, y: p.y * 800 };
      return { f: eyes(s), ...s, point: i };
    }),
  );
  return new GazeAdapter(base, fit(base, 3));
}

const err = (a: GazeAdapter, drift: { x: number; y: number }) => {
  const probes = [
    { x: 300, y: 200 },
    { x: 900, y: 600 },
    { x: 600, y: 400 },
  ];
  return probes.reduce((s, p) => s + Math.hypot(a.predict(eyes(p, drift)).x - p.x, a.predict(eyes(p, drift)).y - p.y), 0) / probes.length;
};

describe("GazeAdapter", () => {
  it("is accurate right after calibration", () => {
    expect(err(calibrated(), { x: 0, y: 0 })).toBeLessThan(30);
  });

  it("recovers from head-movement drift by watching the mouse", () => {
    const a = calibrated();
    const drift = { x: 0.06, y: -0.05 }; // the head moved
    const before = err(a, drift);
    expect(before).toBeGreaterThan(60);
    // The reader moves the mouse around and watches it for ~6 s at 30 fps.
    for (let k = 0; k < 180; k++) {
      const cursor = { x: 600 + 450 * Math.cos(k / 15), y: 400 + 300 * Math.sin(k / 11) };
      a.observe(eyes(cursor, drift), cursor, k * 33);
    }
    const after = err(a, drift);
    expect(after).toBeLessThan(before / 3);
    expect(a.liveError).not.toBeNull();
    expect(a.learned).toBe(180);
  });

  it("a few clicks are enough to pull the offset most of the way", () => {
    const a = calibrated();
    const drift = { x: 0.05, y: 0 };
    const before = err(a, drift);
    for (let k = 0; k < 8; k++) {
      const c = { x: 200 + k * 100, y: 300 + (k % 3) * 100 };
      a.observe(eyes(c, drift), c, k * 500, "click");
    }
    expect(err(a, drift)).toBeLessThan(before * 0.6);
  });
});

describe("PointerTrail", () => {
  it("interpolates the pointer slightly in the past, and ignores idle or flicking pointers", () => {
    const tr = new PointerTrail();
    tr.push(0, 0, 0);
    tr.push(100, 100, 0);
    expect(tr.at(50)).toEqual({ x: 50, y: 0 });
    expect(tr.at(500)).toBeNull(); // idle for 400 ms
    const flick = new PointerTrail();
    flick.push(0, 0, 0);
    flick.push(10, 500, 0); // 50 000 px/s
    expect(flick.at(10)).toBeNull();
  });
});
