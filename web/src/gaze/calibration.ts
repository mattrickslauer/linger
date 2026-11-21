// Calibration plan and model selection.
//
// 16 fixation dots (4×4, inset from the edges, snake order so the eyes never jump far), then
// 5 validation dots the model never trains on. The validation error is the honest accuracy we
// show, and it picks the ridge penalty. The final model is refit on every sample.

import { fitRidge, predictRidge, type RidgeModel } from "./ridge";

export interface Pt {
  x: number;
  y: number;
}

const GRID = [0.08, 0.36, 0.64, 0.92];

/** Fractions of the viewport, in snake order. The centre stays free for the camera panel. */
export const CALIBRATION_POINTS: Pt[] = GRID.flatMap((y, row) =>
  (row % 2 ? [...GRID].reverse() : GRID).map((x) => ({ x, y })),
);

/** Held-out dots, deliberately between the grid lines. */
export const VALIDATION_POINTS: Pt[] = [
  { x: 0.22, y: 0.22 },
  { x: 0.78, y: 0.22 },
  { x: 0.5, y: 0.78 },
  { x: 0.22, y: 0.62 },
  { x: 0.78, y: 0.62 },
];

export interface Sample {
  f: number[];
  x: number; // target, screen px
  y: number;
  point: number; // which dot
}

/** Mean, over dots, of the distance between the mean prediction and the dot. */
export function pointError(model: RidgeModel, samples: Sample[]): number {
  const byPoint = new Map<number, Sample[]>();
  for (const s of samples) byPoint.set(s.point, [...(byPoint.get(s.point) ?? []), s]);
  let total = 0;
  for (const group of byPoint.values()) {
    let px = 0;
    let py = 0;
    for (const s of group) {
      const p = predictRidge(model, s.f);
      px += p.x / group.length;
      py += p.y / group.length;
    }
    total += Math.hypot(px - group[0].x, py - group[0].y);
  }
  return byPoint.size ? total / byPoint.size : Infinity;
}

export function fit(samples: Sample[], lambda: number): RidgeModel {
  return fitRidge(
    samples.map((s) => s.f),
    samples.map((s) => s.x),
    samples.map((s) => s.y),
    lambda,
  );
}

/**
 * Choose the ridge penalty on held-out dots, report that held-out error, then refit on all
 * samples so the final model uses every bit of calibration data.
 */
export function chooseModel(
  train: Sample[],
  valid: Sample[],
  lambdas = [0.3, 1, 3, 10, 30],
): { model: RidgeModel; lambda: number; error: number } {
  let best = { lambda: lambdas[0], error: Infinity };
  for (const lambda of lambdas) {
    const error = pointError(fit(train, lambda), valid);
    if (error < best.error) best = { lambda, error };
  }
  return { model: fit([...train, ...valid], best.lambda), ...best };
}
