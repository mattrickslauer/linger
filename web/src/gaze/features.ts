// Turn one Face Landmarker result into a gaze feature vector.
//
// Everything is measured in real pixels (landmarks are normalised separately by width and height,
// so mixing them distorts every angle), in a per-eye coordinate frame:
//   origin = midpoint of the eye corners, x = along the corners (screen left→right for both eyes),
//   y = perpendicular (down), unit = eye width.
// That frame cancels head roll and distance. Iris position comes from the mean of the five iris
// landmarks and, when available, from the pupil found directly in a zoomed crop of the eye
// (pupil.ts). Head yaw/pitch/roll and position come from the facial transformation matrix.
// The regression decides how to weigh it all.

export interface Pt {
  x: number;
  y: number;
  z?: number;
}

export interface EyeIdx {
  a: number; // corner on the image-left
  b: number; // corner on the image-right
  top: number;
  bottom: number;
  iris: number[]; // centre + ring
}

// Subject's right eye appears on the image-left; left eye on the image-right.
export const RIGHT_EYE: EyeIdx = { a: 33, b: 133, top: 159, bottom: 145, iris: [468, 469, 470, 471, 472] };
export const LEFT_EYE: EyeIdx = { a: 362, b: 263, top: 386, bottom: 374, iris: [473, 474, 475, 476, 477] };

export const FEATURE_COUNT = 22;

export interface EyeFrame {
  o: Pt; // origin, px
  ex: Pt; // unit x
  ey: Pt; // unit y
  w: number; // eye width, px
}

export const px = (p: Pt, size: { w: number; h: number }): Pt => ({ x: p.x * size.w, y: p.y * size.h });

export function eyeFrame(lm: Pt[], e: EyeIdx, size: { w: number; h: number }): EyeFrame {
  const a = px(lm[e.a], size);
  const b = px(lm[e.b], size);
  const w = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
  const ex = { x: (b.x - a.x) / w, y: (b.y - a.y) / w };
  return { o: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ex, ey: { x: -ex.y, y: ex.x }, w };
}

/** A pixel point expressed in the eye frame (units of eye width). */
export function inFrame(f: EyeFrame, p: Pt): { u: number; v: number } {
  const dx = p.x - f.o.x;
  const dy = p.y - f.o.y;
  return { u: (dx * f.ex.x + dy * f.ex.y) / f.w, v: (dx * f.ey.x + dy * f.ey.y) / f.w };
}

export function irisCentre(lm: Pt[], e: EyeIdx, size: { w: number; h: number }): Pt {
  let x = 0;
  let y = 0;
  for (const i of e.iris) {
    const p = px(lm[i], size);
    x += p.x / e.iris.length;
    y += p.y / e.iris.length;
  }
  return { x, y };
}

function eye(lm: Pt[], e: EyeIdx, size: { w: number; h: number }, pupil?: Pt | null) {
  const f = eyeFrame(lm, e, size);
  const iris = inFrame(f, irisCentre(lm, e, size));
  const top = inFrame(f, px(lm[e.top], size));
  const bottom = inFrame(f, px(lm[e.bottom], size));
  const p = pupil ? inFrame(f, pupil) : iris;
  return { u: iris.u, v: iris.v, open: bottom.v - top.v, lidMid: (top.v + bottom.v) / 2, pu: p.u, pv: p.v };
}

/** Yaw, pitch, roll (radians) and translation from a column-major 4×4 transform. */
export function headPose(m: ArrayLike<number>) {
  const r20 = m[2];
  const r21 = m[6];
  const r22 = m[10];
  const r10 = m[1];
  const r00 = m[0];
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, -r20))),
    pitch: Math.atan2(r21, r22),
    roll: Math.atan2(r10, r00),
    tx: m[12],
    ty: m[13],
    tz: m[14],
  };
}

/**
 * @param lm     normalised landmarks (0..1 image space), 478 points
 * @param mat    4×4 column-major facial transformation matrix, if available
 * @param size   video size in px (for aspect-correct geometry)
 * @param pupils pupil centres found in the zoomed eye crops, video px
 * @returns feature vector, or null when the eyes are closed (blink) and the frame is useless
 */
export function gazeFeatures(
  lm: Pt[],
  mat?: ArrayLike<number> | null,
  size: { w: number; h: number } = { w: 640, h: 480 },
  pupils?: { right: Pt | null; left: Pt | null },
): number[] | null {
  if (lm.length < 478) return null;
  const r = eye(lm, RIGHT_EYE, size, pupils?.right);
  const l = eye(lm, LEFT_EYE, size, pupils?.left);
  const open = (r.open + l.open) / 2;
  if (open < 0.1) return null; // blink

  // Iris relative to the lid midline is less sensitive to how open the eye is.
  const u = (r.u + l.u) / 2;
  const v = (r.v - r.lidMid + (l.v - l.lidMid)) / 2;
  const pu = (r.pu + l.pu) / 2;
  const pv = (r.pv - r.lidMid + (l.pv - l.lidMid)) / 2;
  const h = mat
    ? headPose(mat)
    : { yaw: 0, pitch: 0, roll: 0, tx: lm[1].x, ty: lm[1].y, tz: 0 };

  return [
    r.u, r.v, l.u, l.v, // each eye on its own
    u, v, pu, pv, // both eyes, landmark iris and image pupil
    open,
    h.yaw, h.pitch, h.roll, h.tx, h.ty, h.tz,
    u * u, v * v, u * v, // mild curvature at the screen edges
    pu * pu, pv * pv,
    u * h.yaw, v * h.pitch, // eye-in-head combines with head-in-world
  ];
}
