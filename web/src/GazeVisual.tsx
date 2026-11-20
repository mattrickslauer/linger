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
  zoom = true,
}: {
  /** crop to the eyes instead of showing the whole face */
  zoom?: boolean;
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
  const crop = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

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

      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const lm = tracker?.latest;

      // Source rectangle in video px: the whole frame, or (zoomed) the band around both eyes.
      let want = { x: 0, y: 0, w: vw, h: vh };
      if (zoom && lm && lm.length >= 478) {
        const xs = [33, 133, 362, 263].map((i) => lm[i].x * vw);
        const ys = [159, 145, 386, 374, 33, 263].map((i) => lm[i].y * vh);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const bw = Math.max(80, (Math.max(...xs) - Math.min(...xs)) * 1.45);
        const bh = bw * (h / w); // keep the canvas aspect
        want = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
      } else {
        // Cover-fit the whole frame into the canvas aspect.
        const ch = vw * (h / w);
        want = ch <= vh ? { x: 0, y: (vh - ch) / 2, w: vw, h: ch } : { x: (vw - vh * (w / h)) / 2, y: 0, w: vh * (w / h), h: vh };
      }
      // Glide the crop instead of jumping with every landmark jitter.
      const c = (crop.current ??= want);
      const k = 0.15;
      crop.current = { x: c.x + (want.x - c.x) * k, y: c.y + (want.y - c.y) * k, w: c.w + (want.w - c.w) * k, h: c.h + (want.h - c.h) * k };
      const src = crop.current;

      // Mirror, so it behaves like a mirror for the reader.
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, src.x, src.y, src.w, src.h, 0, 0, w, h);
      ctx.restore();

      // Video px → canvas px (mirrored).
      const fromVideo = (p: Pt) => ({ x: w - ((p.x - src.x) / src.w) * w, y: ((p.y - src.y) / src.h) * h });
      const toCanvas = (p: Pt) => fromVideo({ x: p.x * vw, y: p.y * vh });
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
        // The pupil found directly in the zoomed eye image: a small cross.
        const found = tracker?.pupils.last;
        for (const e of [found?.right, found?.left]) {
          if (!e?.pupil) continue;
          const p = fromVideo(e.pupil);
          const s = 5 * devicePixelRatio;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5 * devicePixelRatio;
          ctx.beginPath();
          ctx.moveTo(p.x - s, p.y);
          ctx.lineTo(p.x + s, p.y);
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x, p.y + s);
          ctx.stroke();
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
  }, [tracker, target, gaze, lines, zoom]);

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
