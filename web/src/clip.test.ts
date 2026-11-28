import { describe, expect, it } from "vitest";
import { CLIP_PROFILES, HARD_CLIP_MS, MAX_CLIP_MS, clipCapMs, clipProfile } from "./clip";

const plan = (...secs: number[]) => ({ requirements: secs.map((s) => ({ evidence: "video", minSeconds: s })) });

describe("clip cap and encoding profile (v4.14)", () => {
  it("caps a session from its longest video requirement, 60 s to 2 h", () => {
    expect(clipCapMs(null)).toBe(MAX_CLIP_MS);
    expect(clipCapMs(plan(30))).toBe(MAX_CLIP_MS);
    expect(clipCapMs(plan(120))).toBe(141_000);
    // "meditate for 30 minutes": the whole half hour fits, with slack to start and stop.
    expect(clipCapMs(plan(1800))).toBe(1_905_000);
    expect(clipCapMs(plan(5 * 3600))).toBe(HARD_CLIP_MS);
  });
  it("picks a lower frame rate and bitrate the longer a clip may run", () => {
    expect(clipProfile(MAX_CLIP_MS).tier).toBe("live");
    expect(clipProfile(5 * 60_000).tier).toBe("live");
    expect(clipProfile(12 * 60_000)).toMatchObject({ tier: "long", fps: 5 });
    expect(clipProfile(clipCapMs(plan(1800)))).toMatchObject({ tier: "slow", fps: 1 });
  });
  it("every tier's longest clip stays well under the 200 MB upload limit", () => {
    const caps = { live: 5 * 60, long: 20 * 60, slow: HARD_CLIP_MS / 1000 };
    for (const p of Object.values(CLIP_PROFILES)) {
      const bytes = ((p.videoBps + p.audioBps) / 8) * caps[p.tier];
      expect(bytes).toBeLessThan(150e6);
    }
  });
});
