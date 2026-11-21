// Find the pupil directly in a zoomed crop of each eye.
//
// The face model's iris landmarks are good but quantised and smoothed. In the full-resolution
// frame the pupil is the darkest blob inside the eye opening; its darkness-weighted centroid is a
// sub-pixel estimate of where the eye points. We crop the eye (from the landmarks), scale it up
// into a small buffer, mask everything outside the eyelids, threshold the darkest part and take
// the weighted centroid. The pure core (`pupilFromGray`) is unit-tested.

import { LEFT_EYE, RIGHT_EYE, px, type EyeIdx, type Pt } from "./features";

// Upper and lower lid contours (image-left → image-right) for the eyelid mask.
const RIGHT_LIDS = { upper: [33, 246, 161, 160, 159, 158, 157, 173, 133], lower: [33, 7, 163, 144, 145, 153, 154, 155, 133] };
const LEFT_LIDS = { upper: [362, 398, 384, 385, 386, 387, 388, 466, 263], lower: [362, 382, 381, 380, 374, 373, 390, 249, 263] };

export const CROP_W = 64;
export const CROP_H = 32;

/**
 * Darkness-weighted centroid of the darkest pixels inside a mask.
 * @param gray  row-major luminance 0..255, w×h
 * @param mask  1 = inside the eye opening
 * @returns centroid in crop pixels, or null if there is too little eye visible
 */
export function pupilFromGray(gray: Uint8ClampedArray | number[], mask: Uint8Array, w: number, h: number): Pt | null {
  const vals: number[] = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) vals.push(gray[i]);
  if (vals.length < 40) return null;
  vals.sort((a, b) => a - b);
  const darkest = vals[Math.floor(vals.length * 0.02)];
  const median = vals[Math.floor(vals.length * 0.5)];
  if (median - darkest < 15) return null; // no contrast: closed eye or blown-out image
  // Relative to the contrast, not a fixed share of pixels: the iris can fill most of a narrow
  // eye or very little of a wide one, and a fixed percentile then leaks in sclera and skin.
  const cut = darkest + 0.4 * (median - darkest);
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || gray[i] >= cut) continue;
      const wt = cut - gray[i]; // darker counts more; nothing at the cut-off
      sx += x * wt;
      sy += y * wt;
      sw += wt;
    }
  return sw ? { x: sx / sw, y: sy / sw } : null;
}

/** Point-in-polygon by ray casting (crop coordinates). */
function inside(poly: Pt[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export interface EyeCrop {
  /** crop rectangle in video px */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  pupil: Pt | null; // video px
}

export class PupilFinder {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private masks = new Map<string, { key: string; mask: Uint8Array }>();
  last: { right: EyeCrop | null; left: EyeCrop | null } = { right: null, left: null };

  constructor() {
    this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(CROP_W, CROP_H) : document.createElement("canvas");
    this.canvas.width = CROP_W;
    this.canvas.height = CROP_H;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  }

  find(video: HTMLVideoElement, lm: Pt[]): { right: Pt | null; left: Pt | null } {
    const size = { w: video.videoWidth, h: video.videoHeight };
    const right = this.one(video, lm, RIGHT_EYE, RIGHT_LIDS, size, "r");
    const left = this.one(video, lm, LEFT_EYE, LEFT_LIDS, size, "l");
    this.last = { right, left };
    return { right: right?.pupil ?? null, left: left?.pupil ?? null };
  }

  private one(
    video: HTMLVideoElement,
    lm: Pt[],
    e: EyeIdx,
    lids: { upper: number[]; lower: number[] },
    size: { w: number; h: number },
    tag: string,
  ): EyeCrop | null {
    const a = px(lm[e.a], size);
    const b = px(lm[e.b], size);
    const w = Math.hypot(b.x - a.x, b.y - a.y);
    if (w < 8) return null; // face too far away to see a pupil
    // A 2:1 crop centred on the eye, a little wider than the corners.
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const sw = w * 1.3;
    const sh = sw / 2;
    const sx = cx - sw / 2;
    const sy = cy - sh / 2;
    this.ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CROP_W, CROP_H);
    const img = this.ctx.getImageData(0, 0, CROP_W, CROP_H).data;
    const gray = new Uint8ClampedArray(CROP_W * CROP_H);
    for (let i = 0; i < gray.length; i++) gray[i] = (img[i * 4] * 77 + img[i * 4 + 1] * 150 + img[i * 4 + 2] * 29) >> 8;

    // Eyelid polygon in crop coordinates, shrunk slightly to avoid lashes and corners.
    const toCrop = (i: number) => {
      const p = px(lm[i], size);
      return { x: ((p.x - sx) / sw) * CROP_W, y: ((p.y - sy) / sh) * CROP_H };
    };
    const poly = [...lids.upper.map(toCrop), ...lids.lower.slice(1, -1).reverse().map(toCrop)];
    const pc = poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
    const shrunk = poly.map((p) => ({ x: pc.x + (p.x - pc.x) * 0.85, y: pc.y + (p.y - pc.y) * 0.8 }));
    const key = shrunk.map((p) => `${p.x | 0},${p.y | 0}`).join(";");
    let m = this.masks.get(tag);
    if (!m || m.key !== key) {
      const mask = new Uint8Array(CROP_W * CROP_H);
      for (let y = 0; y < CROP_H; y++) for (let x = 0; x < CROP_W; x++) mask[y * CROP_W + x] = inside(shrunk, x + 0.5, y + 0.5) ? 1 : 0;
      m = { key, mask };
      this.masks.set(tag, m);
    }
    const c = pupilFromGray(gray, m.mask, CROP_W, CROP_H);
    return { sx, sy, sw, sh, pupil: c ? { x: sx + (c.x / CROP_W) * sw, y: sy + (c.y / CROP_H) * sh } : null };
  }
}
