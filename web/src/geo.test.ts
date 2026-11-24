import { describe, expect, it } from "vitest";
import vectors from "../../shared/test-vectors.json";
import { computeSummary, downsample, fmtDistance, fmtDuration, haversineM } from "./geo";
import type { Chunk } from "./types";

describe("geo", () => {
  it("haversine: 1 degree of latitude is about 111 km", () => {
    expect(haversineM(0, 0, 1, 0)).toBeGreaterThan(111000);
    expect(haversineM(0, 0, 1, 0)).toBeLessThan(111400);
  });

  it("downsample keeps first and last and caps length", () => {
    const pts = Array.from({ length: 1001 }, (_, i) => i);
    const d = downsample(pts, 200);
    expect(d.length).toBe(200);
    expect(d[0]).toBe(0);
    expect(d[199]).toBe(1000);
  });

  it("summarises the vector chunks", () => {
    const chunks: Chunk[] = vectors.chunks.map((v) => ({ ...v, frame: v.seq === 1 ? { jpegB64: "aGVsbG8=", w: 1, h: 1, t: v.t1 } : null }));
    const s = computeSummary(1764000000000, 1764000006000, chunks, null);
    expect(s).toMatchObject({ durationMs: 6000, distanceM: 0, frameCount: 1, gpsCount: 1, motionCount: 1, heroFrameSeq: 1 });
    expect(s.start).toEqual({ lat: 33.6189, lng: -117.6681 });
  });

  it("formats", () => {
    expect(fmtDuration(65_000)).toBe("1:05");
    expect(fmtDuration(3_725_000)).toBe("1:02:05");
    expect(fmtDistance(850)).toBe("850 m");
    expect(fmtDistance(4210)).toBe("4.21 km");
  });
});
