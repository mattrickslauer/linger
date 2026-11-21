import { describe, expect, it } from "vitest";
import { AttentionEngine, DEFAULT_ATTENTION, type AttentionEvent, type Target } from "./attention";
import { fitRidge, predictRidge } from "./ridge";
import { OneEuro } from "./oneEuro";
import { FEATURE_COUNT, gazeFeatures } from "./features";
import { pupilFromGray } from "./pupil";

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
  const SIZE = { w: 1280, h: 720 };
  // A face in pixel space, converted to normalised landmarks the way MediaPipe reports them.
  function face(irisShift = 0, open = 14, roll = 0) {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const put = (i: number, x: number, y: number) => {
      const rx = 640 + (x - 640) * c - (y - 360) * s;
      const ry = 360 + (x - 640) * s + (y - 360) * c;
      lm[i] = { x: rx / SIZE.w, y: ry / SIZE.h };
    };
    const eyeAt = (cx: number, a: number, b: number, top: number, bottom: number, iris: number[]) => {
      put(a, cx - 30, 340);
      put(b, cx + 30, 340);
      put(top, cx, 340 - open / 2);
      put(bottom, cx, 340 + open / 2);
      for (const i of iris) put(i, cx + irisShift, 340);
    };
    eyeAt(560, 33, 133, 159, 145, [468, 469, 470, 471, 472]);
    eyeAt(720, 362, 263, 386, 374, [473, 474, 475, 476, 477]);
    return lm;
  }

  it("returns a fixed-length vector, and null on a blink", () => {
    const f = gazeFeatures(face(), null, SIZE);
    expect(f).toHaveLength(FEATURE_COUNT);
    expect(gazeFeatures(face(0, 3), null, SIZE)).toBeNull();
  });

  it("measures both eyes in the same screen direction, in units of eye width", () => {
    const f = gazeFeatures(face(6), null, SIZE)!;
    expect(f[0]).toBeCloseTo(0.1, 3); // right eye u: 6 px / 60 px
    expect(f[2]).toBeCloseTo(0.1, 3); // left eye u, same sign
  });

  it("is unaffected by head roll and by the camera's aspect ratio", () => {
    const flat = gazeFeatures(face(6), null, SIZE)!;
    const rolled = gazeFeatures(face(6, 14, 0.3), null, SIZE)!;
    for (const i of [0, 1, 2, 3, 8]) expect(rolled[i]).toBeCloseTo(flat[i], 3);
  });

  it("uses the image pupil when one was found", () => {
    const lm = face(0);
    const withPupil = gazeFeatures(lm, null, SIZE, { right: { x: 566, y: 340 }, left: { x: 726, y: 340 } })!;
    expect(withPupil[4]).toBeCloseTo(0, 3); // landmark iris centred
    expect(withPupil[6]).toBeCloseTo(0.1, 3); // image pupil 6 px right
  });
});

describe("pupilFromGray", () => {
  it("finds the centre of a dark disc inside the mask", () => {
    const w = 64;
    const h = 32;
    const gray = new Uint8ClampedArray(w * h).fill(200);
    const mask = new Uint8Array(w * h).fill(1);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (Math.hypot(x - 41.5, y - 14.5) < 6) gray[y * w + x] = 30;
    const p = pupilFromGray(gray, mask, w, h)!;
    expect(Math.abs(p.x - 41.5)).toBeLessThan(0.3);
    expect(Math.abs(p.y - 14.5)).toBeLessThan(0.3);
  });

  it("ignores an iris-coloured background gradient (skin/shadow) around a darker pupil", () => {
    const w = 64;
    const h = 32;
    const gray = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = 150 + x; // lighting gradient
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (Math.hypot(x - 20, y - 16) < 5) gray[y * w + x] = 25;
    const p = pupilFromGray(gray, new Uint8Array(w * h).fill(1), w, h)!;
    expect(Math.abs(p.x - 20)).toBeLessThan(0.5);
  });

  it("gives up on a featureless (closed or blown-out) eye", () => {
    const gray = new Uint8ClampedArray(64 * 32).fill(120);
    expect(pupilFromGray(gray, new Uint8Array(64 * 32).fill(1), 64, 32)).toBeNull();
  });
});
