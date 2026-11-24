// Acceleration magnitude over time, with proof shots marked and a cursor shared with the scrubber.
import { useMemo, useRef } from "react";
import { accelMagnitude } from "../geo";
import type { MotionRow } from "../types";

interface Props {
  motion: MotionRow[];
  start: number;
  duration: number;
  frames: number[]; // absolute t
  t: number; // ms from start
  onSeek: (ms: number) => void;
}

const W = 800;
const H = 140;
const PAD = 4;

export default function MotionChart({ motion, start, duration, frames, t, onSeek }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const { line, area, max } = useMemo(() => {
    if (motion.length === 0 || duration <= 0) return { line: "", area: "", max: 0 };
    // Bucket to one value per x pixel pair: max deviation from gravity shows effort, not orientation.
    const buckets = 400;
    const vals = new Array<number>(buckets).fill(0);
    for (const r of motion) {
      const b = Math.min(buckets - 1, Math.max(0, Math.floor(((r[0] - start) / duration) * buckets)));
      vals[b] = Math.max(vals[b], Math.abs(accelMagnitude(r) - 9.81));
    }
    const mx = Math.max(0.5, ...vals);
    const pts = vals.map((v, i) => [(i / (buckets - 1)) * W, H - PAD - (v / mx) * (H - PAD * 2)]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    return { line, area: `${line}L${W},${H}L0,${H}Z`, max: mx };
  }, [motion, start, duration]);

  const seek = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration);
  };

  if (!line) return <p className="muted small">No motion sensor data in this Moment.</p>;
  const x = (t / duration) * W;
  return (
    <figure className="motion">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Motion intensity over the session, peak ${max.toFixed(1)} metres per second squared`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
      >
        <path d={area} className="motion-area" />
        <path d={line} className="motion-line" vectorEffect="non-scaling-stroke" />
        {frames.map((f) => (
          <line key={f} x1={((f - start) / duration) * W} x2={((f - start) / duration) * W} y1={0} y2={H} className="motion-frame" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={x} x2={x} y1={0} y2={H} className="motion-cursor" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>Motion intensity (deviation from gravity, m/s²). Lines mark proof shots.</figcaption>
    </figure>
  );
}
