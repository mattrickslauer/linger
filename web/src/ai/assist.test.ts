import { describe, expect, it, vi } from "vitest";

vi.mock("../firebase", () => ({ readerModel: vi.fn(), figureModel: vi.fn() }));
vi.mock("firebase/ai", () => ({ InferenceSource: { ON_DEVICE: "on_device", IN_CLOUD: "in_cloud" } }));
const { friendlyError, parseHelp } = await import("./assist");

describe("friendlyError", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  it.each([
    ["timeout after 21000 ms", /taking too long/],
    ["[401 ] Firebase App Check token is invalid.", /verify this browser/],
    ["[400 ] Firebase AI Logic genai config not found.", /isn't switched on/],
    ["[429 ] RESOURCE_EXHAUSTED", /Too many requests/],
    ["TypeError: Failed to fetch", /Couldn't reach/],
    ["something odd", /Try again/],
  ])("%s", (raw, expected) => {
    const msg = friendlyError(new Error(raw));
    expect(msg).toMatch(expected);
    expect(msg).not.toMatch(/https?:|\[\d{3}/); // never show URLs or status codes to a reader
  });
});

describe("parseHelp", () => {
  it("reads JSON, fenced JSON, and falls back to plain text", () => {
    const j = { plain: "Simple.", terms: [{ term: "a", meaning: "b" }] };
    expect(parseHelp(JSON.stringify(j))).toEqual(j);
    expect(parseHelp("```json\n" + JSON.stringify(j) + "\n```")).toEqual(j);
    expect(parseHelp("Just text.")).toEqual({ plain: "Just text.", terms: [] });
  });
});
