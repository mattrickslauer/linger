// Shows the reader what the tracker sees: the camera image with eye outlines and irises, and
// lines from each eye to where Linger thinks they are looking (and, during calibration, to the
// dot they should be looking at). Everything is drawn in one requestAnimationFrame loop from
// refs, so it never re-renders React and never moves the <video> element (moving a video out of
// the document pauses it).

import { useEffect, useRef } from "react";
import type { GazeTracker } from "./gaze/tracker";

type Pt = { x: number; y: number };

const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const RIGHT_IRIS = 468; // centre; 469–472 ring
const LEFT_IRIS = 473; // centre; 474–477 ring

export function GazeVisual({
  tracker,
  placement,
  target,
  gaze,
  lines = true,
}: {
  tracker: GazeTracker | null;
  placement: "hero" | "center" | "corner";
  /** where the eyes should be looking (calibration dot), screen px */
  target?: React.RefObject<Pt | null>;
  /** where Linger thinks the eyes are looking, screen px */
  gaze?: React.RefObject<Pt | null>;
  lines?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const v = tracker?.video;
      if (!canvas || !v || v.readyState < 2) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const h = (canvas.height = canvas.clientHeight * devicePixelRatio);

      // Mirror, so it behaves like a mirror for the reader.
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      // Cover-fit the 4:3 camera into the canvas.
      const s = Math.max(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * s;
      const dh = v.videoHeight * s;
      const ox = (w - dw) / 2;
      const oy = (h - dh) / 2;
      ctx.drawImage(v, ox, oy, dw, dh);
      ctx.restore();

      const lm = tracker?.latest;
      const toCanvas = (p: Pt) => ({ x: w - (ox + p.x * dw), y: oy + p.y * dh });
      const eyesOnScreen: Pt[] = [];
      if (lm && lm.length >= 478) {
        ctx.lineWidth = 1.5 * devicePixelRatio;
        ctx.strokeStyle = "rgba(255, 243, 207, 0.95)";
        for (const ring of [RIGHT_EYE, LEFT_EYE]) {
          ctx.beginPath();
          ring.forEach((i, k) => {
            const c = toCanvas(lm[i]);
            if (k) ctx.lineTo(c.x, c.y);
            else ctx.moveTo(c.x, c.y);
          });
          ctx.closePath();
          ctx.stroke();
        }
        const rect = canvas.getBoundingClientRect();
        for (const centre of [RIGHT_IRIS, LEFT_IRIS]) {
          const c = toCanvas(lm[centre]);
          const edge = toCanvas(lm[centre + 1]);
          const r = Math.max(2, Math.hypot(edge.x - c.x, edge.y - c.y));
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(33, 112, 95, 0.55)";
          ctx.fill();
          ctx.strokeStyle = "#5fc2a8";
          ctx.stroke();
          eyesOnScreen.push({ x: rect.left + c.x / devicePixelRatio, y: rect.top + c.y / devicePixelRatio });
        }
      }

      // Lines from each eye to the target dot (dashed) and to the estimated gaze (solid).
      const svg = svgRef.current;
      if (!svg) return;
      const [toTarget1, toTarget2, toGaze1, toGaze2, gazeMark] = Array.from(svg.children) as SVGElement[];
      const t = target?.current ?? null;
      const g = gaze?.current ?? null;
      const set = (el: SVGElement, from: Pt | undefined, to: Pt | null) => {
        if (!lines || !from || !to) {
          el.setAttribute("visibility", "hidden");
          return;
        }
        el.setAttribute("visibility", "visible");
        el.setAttribute("x1", String(from.x));
        el.setAttribute("y1", String(from.y));
        el.setAttribute("x2", String(to.x));
        el.setAttribute("y2", String(to.y));
      };
      set(toTarget1, eyesOnScreen[0], t);
      set(toTarget2, eyesOnScreen[1], t);
      set(toGaze1, eyesOnScreen[0], g);
      set(toGaze2, eyesOnScreen[1], g);
      if (g && lines) {
        gazeMark.setAttribute("visibility", "visible");
        gazeMark.setAttribute("cx", String(g.x));
        gazeMark.setAttribute("cy", String(g.y));
      } else gazeMark.setAttribute("visibility", "hidden");
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [tracker, target, gaze, lines]);

  return (
    <>
      <canvas ref={canvasRef} className={`gv gv-${placement}`} aria-label="Camera view with eye tracking" role="img" />
      <svg ref={svgRef} className="gv-lines" aria-hidden>
        <line className="to-target" />
        <line className="to-target" />
        <line className="to-gaze" />
        <line className="to-gaze" />
        <circle className="gaze-mark" r="10" />
      </svg>
    </>
  );
}
