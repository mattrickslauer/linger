import { describe, expect, it } from "vitest";
import prompts from "../../shared/prompts.json";
import { fill, parseJson, pickFrames } from "./ai-util";

describe("ai helpers", () => {
  it("fills prompt templates from shared/prompts.json", () => {
    const out = fill(prompts.liveCheck.user, { intention: "Catch a bass", frame: "(image)" });
    expect(out).toContain("Intention: Catch a bass");
    expect(out).not.toMatch(/\{\{/);
  });

  it("parses fenced or chatty JSON", () => {
    expect(parseJson<{ ok: boolean }>('```json\n{"ok": false}\n```')).toEqual({ ok: false });
    expect(parseJson<{ ok: boolean }>('Sure! {"ok": true} hope that helps')).toEqual({ ok: true });
    expect(parseJson("nope")).toEqual({});
  });

  it("picks the hero plus up to 3 frames, in time order", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6].map((seq) => ({ seq, t: seq * 1000 }));
    const got = pickFrames(frames, 4);
    expect(got.length).toBeLessThanOrEqual(4);
    expect(got.some((f) => f.seq === 4)).toBe(true);
    expect(got.map((f) => f.t)).toEqual([...got.map((f) => f.t)].sort((a, b) => a - b));
    expect(pickFrames([], null)).toEqual([]);
    expect(pickFrames([{ seq: 2, t: 5 }], null)).toEqual([{ seq: 2, t: 5 }]);
  });
});
