// Turn one MediaPipe Face Landmarker result into a gaze feature vector.
//
// Webcam gaze has two sources of signal: where the iris sits inside the eye opening, and
// where the head points. We take both and let the calibration regression weigh them, rather
// than hand-deriving yaw/pitch (which depends on matrix conventions we would have to get right).

export interface Pt {
  x: number;
  y: number;
  z?: number;
}

// Face mesh indices (478-point model with iris refinement).
const RIGHT = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const LEFT = { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473 };

function eyeRatio(lm: Pt[], e: typeof RIGHT) {
  const a = lm[e.outer];
  const b = lm[e.inner];
  const i = lm[e.iris];
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1e-9;
  // Projection of the iris onto the corner-to-corner axis, 0 = outer corner, 1 = inner.
  const h = ((i.x - a.x) * vx + (i.y - a.y) * vy) / len2;
  const top = lm[e.top];
  const bot = lm[e.bottom];
  const open = bot.y - top.y;
  const v = open > 1e-6 ? (i.y - top.y) / open : 0.5;
  return { h, v, open: Math.sqrt(len2) > 0 ? open / Math.sqrt(len2) : 0 };
}

/**
 * @param lm  normalised landmarks (0..1 image space)
 * @param mat optional 4×4 column-major facial transformation matrix
 * @returns feature vector, or null when the eyes are closed (blink) and the frame is useless
 */
export function gazeFeatures(lm: Pt[], mat?: ArrayLike<number>): number[] | null {
  if (lm.length < 478) return null;
  const r = eyeRatio(lm, RIGHT);
  // Mirror the left eye so both ratios increase in the same screen direction.
  const l = eyeRatio(lm, LEFT);
  const openness = (r.open + l.open) / 2;
  if (openness < 0.12) return null;

  const eh = (r.h + (1 - l.h)) / 2;
  const ev = (r.v + l.v) / 2;

  // Head: forward axis (third column) and translation, if the matrix is available. Falls back
  // to the nose tip position so the feature vector keeps a fixed length.
  const fx = mat ? mat[8] : lm[1].x;
  const fy = mat ? mat[9] : lm[1].y;
  const tx = mat ? mat[12] : lm[1].x;
  const ty = mat ? mat[13] : lm[1].y;

  return [eh, ev, fx, fy, tx, ty, eh * eh, ev * ev, eh * ev, eh * fx, ev * fy];
}
