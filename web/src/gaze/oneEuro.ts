// One Euro filter (Casiez et al., CHI 2012): heavy smoothing when the gaze is still,
// light smoothing when it moves fast. Webcam gaze is jittery at rest and jumps on saccades,
// which is exactly the case this filter was designed for.

export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.007,
    private dCutoff = 1.0,
  ) {}

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    this.tPrev = tMs;
    const dx = (x - this.xPrev) / dt;
    const edx = lerp(this.dxPrev, dx, alpha(this.dCutoff, dt));
    this.dxPrev = edx;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const out = lerp(this.xPrev, x, alpha(cutoff, dt));
    this.xPrev = out;
    return out;
  }
}

function alpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
