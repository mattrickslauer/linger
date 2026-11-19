// Ridge regression from gaze features to screen coordinates.
//
// Calibration gives us a few hundred (feature vector, screen point) pairs. We z-score the
// features, then solve (XᵀX + λI)β = Xᵀy once per screen axis. The system is ~10×10, so
// plain Gaussian elimination is exact enough and keeps us dependency-free.

export interface RidgeModel {
  mean: number[];
  std: number[];
  betaX: number[];
  betaY: number[];
}

export function fitRidge(features: number[][], xs: number[], ys: number[], lambda = 1): RidgeModel {
  const n = features.length;
  if (n === 0) throw new Error("fitRidge: no samples");
  const d = features[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const f of features) for (let j = 0; j < d; j++) mean[j] += f[j] / n;
  for (const f of features) for (let j = 0; j < d; j++) std[j] += (f[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;

  // Design matrix with a bias column that is not penalised.
  const X = features.map((f) => [1, ...f.map((v, j) => (v - mean[j]) / std[j])]);
  const p = d + 1;
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xtyX = new Array(p).fill(0);
  const xtyY = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X[i];
    for (let a = 0; a < p; a++) {
      xtyX[a] += row[a] * xs[i];
      xtyY[a] += row[a] * ys[i];
      for (let b = 0; b < p; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  for (let a = 1; a < p; a++) xtx[a][a] += lambda;

  return { mean, std, betaX: solve(xtx, xtyX), betaY: solve(xtx, xtyY) };
}

export function predictRidge(m: RidgeModel, f: number[]): { x: number; y: number } {
  let x = m.betaX[0];
  let y = m.betaY[0];
  for (let j = 0; j < f.length; j++) {
    const z = (f[j] - m.mean[j]) / m.std[j];
    x += m.betaX[j + 1] * z;
    y += m.betaY[j + 1] * z;
  }
  return { x, y };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const div = M[c][c] || 1e-12;
    for (let k = c; k <= n; k++) M[c][k] /= div;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row) => row[n]);
}
