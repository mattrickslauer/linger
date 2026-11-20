// Learn from the mouse while reading with the eyes.
//
// When a reader moves the mouse and watches it, or clicks, we know where they are looking. Each
// such moment is a free calibration sample. Webcam gaze drifts as the head moves, so we:
//   1. keep a running offset (exponential average of cursor − prediction) that fixes drift
//      within a second, and
//   2. refit the regression every few seconds on calibration + recent mouse samples (weighted
//      up, and capped, so the newest posture wins), then re-centre the offset on the new model.
// Pure and clock-injected; see adapt.test.ts.

import { fit, type Sample } from "./calibration";
import { predictRidge, type RidgeModel } from "./ridge";

export interface AdaptOptions {
  maxImplicit: number; // keep this many recent mouse samples
  weight: number; // how many times each mouse sample counts in a refit
  clickWeight: number; // clicks are stronger evidence than movement
  refitEveryMs: number;
  minNewForRefit: number;
  offsetAlpha: number; // how fast the drift offset follows
  lambda: number;
}

export const DEFAULT_ADAPT: AdaptOptions = {
  maxImplicit: 400,
  weight: 2,
  clickWeight: 4,
  refitEveryMs: 2000,
  minNewForRefit: 20,
  offsetAlpha: 0.08,
  lambda: 3,
};

type Pt = { x: number; y: number };

export class GazeAdapter {
  model: RidgeModel;
  offset: Pt = { x: 0, y: 0 };
  learned = 0; // total mouse samples taken
  private implicit: (Sample & { w: number })[] = [];
  private newSinceFit = 0;
  private lastFit = 0;
  private residuals: number[] = [];

  constructor(
    private base: Sample[],
    model: RidgeModel,
    private opts: AdaptOptions = DEFAULT_ADAPT,
  ) {
    this.model = model;
  }

  predict(f: number[]): Pt {
    const p = predictRidge(this.model, f);
    return { x: p.x + this.offset.x, y: p.y + this.offset.y };
  }

  /** The reader is looking at `target` (cursor or click) while the eyes produced `f`. */
  observe(f: number[], target: Pt, t: number, kind: "move" | "click" = "move") {
    const p = this.predict(f);
    this.residuals.push(Math.hypot(target.x - p.x, target.y - p.y));
    if (this.residuals.length > 40) this.residuals.shift();

    const a = kind === "click" ? Math.min(1, this.opts.offsetAlpha * 3) : this.opts.offsetAlpha;
    this.offset = { x: this.offset.x + a * (target.x - p.x), y: this.offset.y + a * (target.y - p.y) };

    this.implicit.push({ f, x: target.x, y: target.y, point: -1, w: kind === "click" ? this.opts.clickWeight : this.opts.weight });
    if (this.implicit.length > this.opts.maxImplicit) this.implicit.shift();
    this.learned++;
    this.newSinceFit++;
    this.maybeRefit(t);
  }

  /** Median distance between estimate and cursor over the last few dozen samples. */
  get liveError(): number | null {
    if (this.residuals.length < 10) return null;
    const s = [...this.residuals].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  private maybeRefit(t: number) {
    if (this.newSinceFit < this.opts.minNewForRefit || t - this.lastFit < this.opts.refitEveryMs) return;
    const weighted: Sample[] = [...this.base];
    for (const s of this.implicit) for (let k = 0; k < s.w; k++) weighted.push(s);
    this.model = fit(weighted, this.opts.lambda);
    this.lastFit = t;
    this.newSinceFit = 0;
    // Re-centre the offset on the new model using the most recent mouse samples.
    const recent = this.implicit.slice(-30);
    let dx = 0;
    let dy = 0;
    for (const s of recent) {
      const p = predictRidge(this.model, s.f);
      dx += (s.x - p.x) / recent.length;
      dy += (s.y - p.y) / recent.length;
    }
    this.offset = { x: dx, y: dy };
  }
}

/**
 * Where was the pointer `lagMs` ago? Eyes following a moving cursor trail it slightly, so the
 * pointer position slightly in the past is the better label for a gaze sample.
 */
export class PointerTrail {
  private trail: { t: number; x: number; y: number }[] = [];

  push(t: number, x: number, y: number) {
    this.trail.push({ t, x, y });
    while (this.trail.length && t - this.trail[0].t > 1000) this.trail.shift();
  }

  /** Position at time t, or null if the pointer was not moving recently or moving too fast. */
  at(t: number, opts = { idleMs: 250, maxSpeed: 1800 }): Pt | null {
    const n = this.trail.length;
    if (n < 2) return null;
    const last = this.trail[n - 1];
    if (t - last.t > opts.idleMs) return null; // not being watched-and-moved right now
    let i = n - 1;
    while (i > 0 && this.trail[i - 1].t > t) i--;
    const b = this.trail[i];
    const a = this.trail[Math.max(0, i - 1)];
    const dt = Math.max(1, b.t - a.t);
    const speed = (Math.hypot(b.x - a.x, b.y - a.y) / dt) * 1000;
    if (speed > opts.maxSpeed) return null; // a flick, the eyes aren't on it
    const k = Math.min(1, Math.max(0, (t - a.t) / dt));
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
}
