// Track maths shared by the recorder (summary at submit) and the viewers.

import type { Chunk, GpsRow, MotionRow, Payload, Summary } from "./types";

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function trackDistanceM(gps: GpsRow[]): number {
  let d = 0;
  for (let i = 1; i < gps.length; i++) d += haversineM(gps[i - 1][1], gps[i - 1][2], gps[i][1], gps[i][2]);
  return d;
}

/** Keep every n-th point so a track has at most `max` points, always keeping the last. */
export function downsample<T>(pts: T[], max = 200): T[] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

export interface Decoded {
  gps: GpsRow[];
  motion: MotionRow[];
  frames: { seq: number; t: number; jpegB64: string; label: string; ok: boolean | null; mode: string }[];
  events: Payload["events"];
}

export function decodeChunks(chunks: Chunk[]): Decoded {
  const out: Decoded = { gps: [], motion: [], frames: [], events: [] };
  for (const c of [...chunks].sort((a, b) => a.seq - b.seq)) {
    let p: Payload;
    try {
      p = JSON.parse(c.payload) as Payload;
    } catch {
      continue;
    }
    out.gps.push(...(p.gps ?? []));
    out.motion.push(...(p.motion ?? []));
    out.events.push(...(p.events ?? []));
    if (c.frame) out.frames.push({ seq: c.seq, t: c.frame.t, jpegB64: c.frame.jpegB64, label: p.check?.label ?? "", ok: p.check?.ok ?? null, mode: p.check?.mode ?? "none" });
  }
  return out;
}

export function computeSummary(startedAt: number, endedAt: number, chunks: Chunk[], heroFrameSeq: number | null): Summary {
  const d = decodeChunks(chunks);
  const first = d.gps[0];
  const last = d.gps[d.gps.length - 1];
  return {
    durationMs: endedAt - startedAt,
    distanceM: Math.round(trackDistanceM(d.gps)),
    frameCount: d.frames.length,
    gpsCount: d.gps.length,
    motionCount: d.motion.length,
    start: first ? { lat: first[1], lng: first[2] } : null,
    end: last ? { lat: last[1], lng: last[2] } : null,
    heroFrameSeq: heroFrameSeq ?? (d.frames.length ? d.frames[d.frames.length - 1].seq : null),
  };
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function accelMagnitude(r: MotionRow): number {
  return Math.sqrt(r[1] * r[1] + r[2] * r[2] + r[3] * r[3]);
}
