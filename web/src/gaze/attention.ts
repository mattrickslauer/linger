// The attention engine: gaze samples in, reading events out.
//
// Webcam gaze is accurate to roughly 100–200 px, so we never reason about words or lines,
// only about blocks (paragraphs, figures). Three events matter to the product:
//
//   focus  — the reader has settled on a block (dwell ≥ dwellMs). We magnify it, and warm an
//            on-device answer speculatively because on-device inference is free and private.
//   stuck  — the reader is struggling with the block: either they have stayed far longer than
//            its length warrants ("long-dwell"), or they moved on and came back ("reread").
//   blur   — the reader left the block.
//
// Everything here is pure and clock-injected so it is unit-testable without a camera.

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Target {
  id: string;
  index: number; // document order
  rect: Rect;
  words: number;
}

export type StuckReason = "long-dwell" | "reread";

export type AttentionEvent =
  | { type: "focus"; id: string }
  | { type: "stuck"; id: string; reason: StuckReason }
  | { type: "blur"; id: string };

export interface AttentionConfig {
  dwellMs: number; // settle time before focus
  switchMs: number; // a new block must win for this long before we switch (hysteresis)
  lostMs: number; // no gaze for this long → blur
  wpm: number; // assumed comfortable reading speed
  stuckFactor: number; // stuck when dwell > expected reading time × factor
  minStuckMs: number; // floor so short blocks don't trigger instantly
  maxStuckMs: number; // ceiling: help must arrive while the reader is still stuck, not after they give up
  rereadWindowMs: number; // a return to an earlier block within this window counts as a re-read
  margin: number; // px of slack around blocks
}

export const DEFAULT_ATTENTION: AttentionConfig = {
  dwellMs: 600,
  switchMs: 250,
  lostMs: 1200,
  wpm: 200,
  stuckFactor: 1.2,
  minStuckMs: 6000,
  maxStuckMs: 12000,
  rereadWindowMs: 20000,
  margin: 60,
};

interface Visit {
  id: string;
  enteredAt: number;
  focused: boolean;
  stuck: boolean;
  isReread: boolean;
}

export class AttentionEngine {
  private visit: Visit | null = null;
  private pending: { id: string; since: number } | null = null;
  private lastSeen = 0;
  /** id → last time the reader *finished* a focused visit there, and its index */
  private read = new Map<string, { leftAt: number; index: number }>();
  private furthestIndex = -1;

  constructor(public cfg: AttentionConfig = DEFAULT_ATTENTION) {}

  get currentId(): string | null {
    return this.visit?.id ?? null;
  }

  reset() {
    this.visit = null;
    this.pending = null;
    this.read.clear();
    this.furthestIndex = -1;
  }

  update(p: { x: number; y: number } | null, t: number, targets: Target[]): AttentionEvent[] {
    const out: AttentionEvent[] = [];
    if (p) this.lastSeen = t;
    const candidate = p ? this.pick(p, targets) : null;

    // Lost the reader (looked away, face out of frame).
    if (!p) {
      if (this.visit && t - this.lastSeen >= this.cfg.lostMs) this.leave(t, targets, out);
      return out;
    }

    const cid = candidate?.id ?? null;
    if (cid !== (this.visit?.id ?? null)) {
      if (!this.pending || this.pending.id !== (cid ?? "")) this.pending = { id: cid ?? "", since: t };
      if (t - this.pending.since >= this.cfg.switchMs) {
        this.leave(t, targets, out);
        if (candidate) this.enter(candidate, this.pending.since, t);
        this.pending = null;
      }
    } else {
      this.pending = null;
    }

    const v = this.visit;
    if (!v) return out;
    const target = targets.find((x) => x.id === v.id);
    const elapsed = t - v.enteredAt;

    if (!v.focused && elapsed >= this.cfg.dwellMs) {
      v.focused = true;
      out.push({ type: "focus", id: v.id });
    }
    if (v.focused && !v.stuck) {
      if (v.isReread) {
        v.stuck = true;
        out.push({ type: "stuck", id: v.id, reason: "reread" });
      } else if (target && elapsed >= this.stuckAfter(target)) {
        v.stuck = true;
        out.push({ type: "stuck", id: v.id, reason: "long-dwell" });
      }
    }
    return out;
  }

  /** Expected time to read a block, scaled by the stuck factor. */
  stuckAfter(t: Target): number {
    const expected = (t.words / this.cfg.wpm) * 60000;
    return Math.min(this.cfg.maxStuckMs, Math.max(this.cfg.minStuckMs, expected * this.cfg.stuckFactor));
  }

  private enter(target: Target, since: number, t: number) {
    const prior = this.read.get(target.id);
    const isReread =
      !!prior && target.index < this.furthestIndex && t - prior.leftAt <= this.cfg.rereadWindowMs;
    this.visit = { id: target.id, enteredAt: since, focused: false, stuck: false, isReread };
  }

  private leave(t: number, targets: Target[], out: AttentionEvent[]) {
    const v = this.visit;
    if (!v) return;
    if (v.focused) {
      const idx = targets.find((x) => x.id === v.id)?.index ?? -1;
      this.read.set(v.id, { leftAt: t, index: idx });
      this.furthestIndex = Math.max(this.furthestIndex, idx);
      out.push({ type: "blur", id: v.id });
    }
    this.visit = null;
  }

  private pick(p: { x: number; y: number }, targets: Target[]): Target | null {
    const m = this.cfg.margin;
    let best: Target | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const r = t.rect;
      if (p.x < r.left - m || p.x > r.right + m) continue;
      const dy = p.y < r.top ? r.top - p.y : p.y > r.bottom ? p.y - r.bottom : 0;
      if (dy > m) continue;
      if (dy < bestDist) {
        bestDist = dy;
        best = t;
      }
    }
    return best;
  }
}
