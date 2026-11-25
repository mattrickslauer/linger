import { describe, expect, it } from "vitest";
import v3 from "../../shared/test-vectors-v3.json";
import {
  barFromDifficulty,
  buildContext,
  compactIntention,
  guessCategory,
  interviewMode,
  localTimeString,
  normalizeIntention,
  normalizeQuantities,
  wantsToStart,
  withDraftClaims,
} from "./intention";

describe("bar mapping reproduces shared/test-vectors-v3.json bars", () => {
  for (const b of v3.bars) it(`difficulty ${b.difficulty} -> ${b.bar}`, () => expect(barFromDifficulty(b.difficulty)).toBe(b.bar));
});

describe("structured intention", () => {
  const pos = { lat: 33.6189, lng: -117.6681 };
  it("takes lat/lng from GPS, never from the model, and nulls empty strings", () => {
    const i = normalizeIntention(
      {
        text: "Catch a 5 lb largemouth bass at Lake Mission Viejo",
        category: "fishing",
        activity: "fishing",
        goal: "catch a largemouth bass of at least 5 lb",
        quantities: [
          { metric: "weight", value: 5, unit: "lb", measuredBy: "scale" },
          { metric: "count", value: 0, unit: "", measuredBy: "count" },
        ],
        place: { name: "Lake Mission Viejo", region: "", country: "USA", lat: 1, lng: 2 },
        expectedMinutes: 90,
        conditions: ["autumn", "dawn"],
        assumptions: ["Bank fishing"],
      },
      { pos, start: 1000, turns: 2, mode: "mixed" },
    );
    expect(i.v).toBe(4);
    expect(i.claims).toEqual([]);
    expect(i.plan).toBeNull();
    expect(i.place).toEqual({ name: "Lake Mission Viejo", lat: 33.6189, lng: -117.6681, region: null, country: "USA" });
    expect(i.quantities).toEqual([{ metric: "weight", value: 5, unit: "lb", measuredBy: "scale" }]);
    expect(i.window).toEqual({ start: 1000, expectedMinutes: 90 });
    expect(i.interview).toEqual({ turns: 2, mode: "mixed" });
  });
  it("clamps lengths and falls back to a guessed category", () => {
    const i = normalizeIntention({ text: "x".repeat(300), category: "dancing", conditions: Array(9).fill("c") }, { pos: null, start: 0, turns: 0, mode: "typed" });
    expect(i.text.length).toBe(200);
    expect(i.category).toBe("other");
    expect(i.conditions).toHaveLength(6);
    expect(i.place).toBeNull();
  });
  it("drops unknown quantities and bad measuredBy", () => {
    expect(normalizeQuantities([{ metric: "reps", value: 20, unit: "", measuredBy: "telepathy" }, { value: 3 }])).toEqual([
      { metric: "reps", value: 20, unit: "", measuredBy: "claim" },
    ]);
  });
  it("v4: claims and plan from the model, ids renumbered, recordMode from the plan", () => {
    const i = normalizeIntention(
      {
        text: "Clap 50 times",
        claims: [
          { id: "c1", kind: "action", text: "clapping", metric: "", value: 0, unit: "" },
          { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
        ],
        plan: {
          requirements: [{ id: "r1", claimId: "c2", evidence: "video", ask: "One continuous video of all 50 claps", minSeconds: 20 }],
          recordMode: "photo",
          note: "Both hands in frame.",
        },
      },
      { pos: null, start: 0, turns: 1, mode: "cloud" },
    );
    expect(i.claims).toEqual([
      { id: "c1", kind: "action", text: "clapping" },
      { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
    ]);
    expect(i.plan?.recordMode).toBe("video");
    expect(i.plan?.requirements).toEqual([{ id: "r1", claimId: "c2", evidence: "video", ask: "One continuous video of all 50 claps", minSeconds: 20 }]);
  });
  it("typed intention: withDraftClaims keeps the typed text and adds claims + plan", () => {
    const typed = { text: "clap 50 times", category: "other" as const };
    expect(withDraftClaims(typed, { claims: [] })).toBe(typed);
    const i = withDraftClaims(typed, { text: "ignored", claims: [{ id: "c1", kind: "count", text: "50 claps", value: 50, metric: "claps", unit: "claps" }], plan: null });
    expect(i).toEqual({ text: "clap 50 times", category: "other", v: 4, claims: [{ id: "c1", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" }], plan: null });
  });
  it("compactIntention removes undefined keys", () => {
    const i = compactIntention(normalizeIntention({ text: "Walk" }, { pos: null, start: 0, turns: 0, mode: "typed" }));
    expect(Object.values(i).includes(undefined)).toBe(false);
  });
});

describe("interview helpers", () => {
  it("recognises start words only on their own", () => {
    for (const s of ["start", "Go!", "let's go", "ok, start now", "Lets go."]) expect(wantsToStart(s)).toBe(true);
    for (const s of ["going fishing", "start a run", "I want to go to the lake"]) expect(wantsToStart(s)).toBe(false);
  });
  it("mode is typed / on_device / cloud / mixed", () => {
    expect(interviewMode([])).toBe("typed");
    expect(interviewMode(["on_device", "on_device"])).toBe("on_device");
    expect(interviewMode(["cloud", "none"])).toBe("cloud");
    expect(interviewMode(["on_device", "cloud"])).toBe("mixed");
  });
  it("context has local time, month and hemisphere", () => {
    const c = buildContext({ lat: -33.86, lng: 151.2 }, new Date(2026, 10, 25, 6, 42));
    expect(c.localTime).toBe("2026-11-25T06:42 Wed");
    expect(localTimeString(new Date(2026, 0, 4, 9, 5))).toBe("2026-01-04T09:05 Sun");
    expect(c.month).toBe(11);
    expect(c.hemisphere).toBe("S");
  });
  it("guesses categories from keywords", () => {
    expect(guessCategory("going fishing for bass")).toBe("fishing");
    expect(guessCategory("run 5 km")).toBe("fitness");
    expect(guessCategory("hike to the summit")).toBe("outdoors");
  });
});
