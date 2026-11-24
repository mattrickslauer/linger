// Small shared pieces: stamp, chips, links, track sketch, relative time.
import type { ReactNode } from "react";
import { linkClick } from "./router";
import type { CheckMode, Platform } from "./types";

export const jpegSrc = (b64: string) => "data:image/jpeg;base64," + b64;

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string; "aria-current"?: "page" | undefined }) {
  return (
    <a href={to} onClick={linkClick} className={className} {...rest}>
      {children}
    </a>
  );
}

export function Stamp({ sealed, size = "md" }: { sealed: boolean; size?: "md" | "lg" }) {
  return (
    <span className={`stamp ${sealed ? "stamp-ok" : "stamp-no"} stamp-${size}`}>
      {sealed ? "Verified ✓" : "Not verified"}
    </span>
  );
}

const PLATFORM: Record<Platform, string> = { ios: "iOS", android: "Android", web: "Web" };
const MODE: Record<CheckMode, string> = { on_device: "checked on-device", cloud: "checked in cloud", none: "no live check" };

export function Chips({ platform, mode }: { platform: Platform; mode: CheckMode }) {
  return (
    <span className="chips">
      <span className="chip">recorded on {PLATFORM[platform] ?? platform}</span>
      <span className={`chip ${mode === "on_device" ? "chip-device" : ""}`}>{MODE[mode] ?? mode}</span>
    </span>
  );
}

export function ago(ms: number | null): string {
  if (!ms) return "just now";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Equirectangular sketch of a track, scaled to fit, for cards and offline fallback. */
export function trackPath(track: [number, number][], w: number, h: number, pad = 6): { d: string; end: [number, number] | null; start: [number, number] | null } {
  if (track.length === 0) return { d: "", end: null, start: null };
  const k = Math.cos((track[0][0] * Math.PI) / 180);
  const xs = track.map((p) => p[1] * k);
  const ys = track.map((p) => -p[0]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-5);
  const s = Math.min((w - pad * 2) / span, (h - pad * 2) / span);
  const ox = (w - (maxX - minX) * s) / 2;
  const oy = (h - (maxY - minY) * s) / 2;
  const pts = xs.map((x, i) => [ox + (x - minX) * s, oy + (ys[i] - minY) * s] as [number, number]);
  return {
    d: pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(""),
    start: pts[0],
    end: pts[pts.length - 1],
  };
}

export function TrackSketch({ track, w = 96, h = 72, className }: { track: [number, number][]; w?: number; h?: number; className?: string }) {
  const { d, start, end } = trackPath(track, w, h);
  if (!d) return null;
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {start && <circle cx={start[0]} cy={start[1]} r="2.6" fill="currentColor" />}
      {end && <circle cx={end[0]} cy={end[1]} r="3.6" className="sketch-end" />}
    </svg>
  );
}
