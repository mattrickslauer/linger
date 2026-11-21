import { describe, expect, it } from "vitest";
import { DEFAULT_CLICK, DEFAULT_SCROLL, DwellClick, ScrollIntent } from "./intent";
import { CALIBRATION_POINTS, VALIDATION_POINTS, chooseModel, type Sample } from "./calibration";

const VH = 800;

describe("ScrollIntent", () => {
  it("does nothing in the reading area", () => {
    const s = new ScrollIntent();
    for (let t = 0; t < 2000; t += 50) expect(s.update({ x: 400, y: 400 }, t, VH)).toBe(0);
  });

  it("waits for the hold, then scrolls down faster the deeper the gaze", () => {
    const s = new ScrollIntent();
    expect(s.update({ x: 400, y: 760 }, 0, VH)).toBe(0);
    expect(s.update({ x: 400, y: 760 }, DEFAULT_SCROLL.holdMs - 10, VH)).toBe(0);
    const shallow = s.update({ x: 400, y: 700 }, DEFAULT_SCROLL.holdMs + 10, VH);
    const deep = s.update({ x: 400, y: 795 }, DEFAULT_SCROLL.holdMs + 20, VH);
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeLessThanOrEqual(DEFAULT_SCROLL.maxSpeed);
  });

  it("scrolls up from the top band and stops when gaze is lost", () => {
    const s = new ScrollIntent();
    s.update({ x: 400, y: 10 }, 0, VH);
    expect(s.update({ x: 400, y: 10 }, 500, VH)).toBeLessThan(0);
    expect(s.update(null, 550, VH)).toBe(0);
  });
});

describe("DwellClick", () => {
  const targets = [
    { id: "a", rect: { top: 100, bottom: 140, left: 100, right: 200 } },
    { id: "b", rect: { top: 300, bottom: 340, left: 100, right: 200 } },
  ];

  it("fills the ring and fires once after the dwell", () => {
    const d = new DwellClick();
    const fired: string[] = [];
    let peak = 0;
    for (let t = 0; t <= DEFAULT_CLICK.dwellMs + 100; t += 50) {
      const r = d.update({ x: 150, y: 120 }, t, targets);
      if (r.fire) fired.push(r.fire);
      peak = Math.max(peak, r.progress);
    }
    expect(fired).toEqual(["a"]);
    expect(peak).toBeGreaterThan(0.9);
  });

  it("is magnetic within the radius but not beyond it", () => {
    const d = new DwellClick();
    expect(d.update({ x: 150, y: 140 + DEFAULT_CLICK.magnet - 5 }, 0, targets).id).toBe("a");
    const far = new DwellClick();
    expect(far.update({ x: 150, y: 140 + DEFAULT_CLICK.magnet + 30 }, 0, targets).id).toBeNull();
  });

  it("survives a blink but resets when the gaze moves to another target", () => {
    const d = new DwellClick();
    d.update({ x: 150, y: 120 }, 0, targets);
    expect(d.update(null, 100, targets).id).toBe("a"); // blink within grace
    expect(d.update({ x: 150, y: 120 }, 300, targets).progress).toBeCloseTo(0.3, 1);
    expect(d.update({ x: 150, y: 320 }, 400, targets)).toMatchObject({ id: "b", progress: 0 });
  });

  it("cools down after a click", () => {
    const d = new DwellClick();
    let t = 0;
    for (; t <= DEFAULT_CLICK.dwellMs; t += 50) d.update({ x: 150, y: 120 }, t, targets);
    expect(d.update({ x: 150, y: 120 }, t + 100, targets).id).toBeNull();
  });
});

describe("calibration", () => {
  it("uses 16 dots, keeps the centre free, and validates on unseen dots", () => {
    expect(CALIBRATION_POINTS).toHaveLength(16);
    expect(CALIBRATION_POINTS.some((p) => Math.abs(p.x - 0.5) < 0.1 && Math.abs(p.y - 0.5) < 0.1)).toBe(false);
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const grid = new Set(CALIBRATION_POINTS.map(key));
    expect(VALIDATION_POINTS.every((p) => !grid.has(key(p)))).toBe(true);
  });

  it("reports honest held-out error and recovers a noisy mapping", () => {
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const make = (pts: { x: number; y: number }[], offset: number): Sample[] =>
      pts.flatMap((p, i) =>
        Array.from({ length: 15 }, () => ({
          f: [p.x + noise(), p.y + noise(), (p.x + noise()) * (p.y + noise())],
          x: p.x * 1200,
          y: p.y * 800,
          point: offset + i,
        })),
      );
    const { error, lambda } = chooseModel(make(CALIBRATION_POINTS, 0), make(VALIDATION_POINTS, 100));
    expect(error).toBeLessThan(25);
    expect([0.3, 1, 3, 10, 30]).toContain(lambda);
  });
});
