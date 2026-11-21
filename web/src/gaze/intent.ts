// Gaze intent: scrolling and clicking with the eyes.
//
// Both are deliberately conservative. Webcam gaze is ~100–200 px accurate, so:
//   scroll — only from the outer bands of the viewport, only after a short hold, and with a
//            speed that ramps with how deep into the band the reader looks;
//   click  — only on targets explicitly marked gaze-clickable, with a magnetic radius, a
//            visible dwell ring, a grace period for blinks, and a cooldown after each click.
// Both are pure and clock-injected so they can be unit-tested without a camera.

import type { Rect } from "./attention";

export interface ScrollConfig {
  zone: number; // fraction of viewport height at top and bottom that scrolls
  holdMs: number; // gaze must stay in the band this long before scrolling starts
  maxSpeed: number; // px/s at the very edge
}

export const DEFAULT_SCROLL: ScrollConfig = { zone: 0.14, holdMs: 400, maxSpeed: 650 };

export class ScrollIntent {
  private since: number | null = null;
  private dir = 0;

  constructor(public cfg: ScrollConfig = DEFAULT_SCROLL) {}

  /** @returns scroll velocity in px/s, positive = down. */
  update(p: { x: number; y: number } | null, t: number, viewportHeight: number): number {
    if (!p) return this.reset();
    const band = viewportHeight * this.cfg.zone;
    const down = (p.y - (viewportHeight - band)) / band;
    const up = (band - p.y) / band;
    const dir = down > 0 ? 1 : up > 0 ? -1 : 0;
    if (!dir) return this.reset();
    if (dir !== this.dir || this.since === null) {
      this.dir = dir;
      this.since = t;
    }
    if (t - this.since < this.cfg.holdMs) return 0;
    const depth = Math.min(1, dir > 0 ? down : up);
    return dir * this.cfg.maxSpeed * Math.pow(depth, 1.5);
  }

  private reset() {
    this.since = null;
    this.dir = 0;
    return 0;
  }
}

export interface ClickTarget {
  id: string;
  rect: Rect;
}

export interface ClickConfig {
  dwellMs: number;
  magnet: number; // px of slack around each target
  graceMs: number; // tolerate this much lost gaze (blinks, jitter) without resetting
  cooldownMs: number; // after a click, ignore everything for this long
}

export const DEFAULT_CLICK: ClickConfig = { dwellMs: 1000, magnet: 50, graceMs: 200, cooldownMs: 1500 };

export interface ClickState {
  id: string | null;
  progress: number; // 0..1 for the dwell ring
  fire: string | null; // id clicked on this update
}

export class DwellClick {
  private id: string | null = null;
  private start = 0;
  private lastSeen = 0;
  private coolUntil = 0;

  constructor(public cfg: ClickConfig = DEFAULT_CLICK) {}

  update(p: { x: number; y: number } | null, t: number, targets: ClickTarget[]): ClickState {
    if (t < this.coolUntil) return { id: null, progress: 0, fire: null };
    const hit = p ? this.pick(p, targets) : null;
    if (hit) this.lastSeen = t;
    if (!hit) {
      if (this.id && t - this.lastSeen <= this.cfg.graceMs) return { id: this.id, progress: this.progress(t), fire: null };
      this.id = null;
      return { id: null, progress: 0, fire: null };
    }
    if (hit !== this.id) {
      this.id = hit;
      this.start = t;
    }
    const progress = this.progress(t);
    if (progress >= 1) {
      const fire = this.id;
      this.id = null;
      this.coolUntil = t + this.cfg.cooldownMs;
      return { id: null, progress: 0, fire };
    }
    return { id: this.id, progress, fire: null };
  }

  private progress(t: number) {
    return Math.min(1, (t - this.start) / this.cfg.dwellMs);
  }

  private pick(p: { x: number; y: number }, targets: ClickTarget[]): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const { id, rect: r } of targets) {
      const dx = p.x < r.left ? r.left - p.x : p.x > r.right ? p.x - r.right : 0;
      const dy = p.y < r.top ? r.top - p.y : p.y > r.bottom ? p.y - r.bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d <= this.cfg.magnet && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }
}
