import { describe, expect, it } from "vitest";
import { rot, rotatedSize, rotatedSrc, videoRotClass } from "./rotate";

describe("rot", () => {
  it("keeps the four quarter turns", () => {
    for (const d of [0, 90, 180, 270]) expect(rot(d)).toBe(d);
  });
  it("treats missing or non-numeric values as 0", () => {
    for (const v of [undefined, null, "270", NaN, Infinity, -Infinity, {}, [270], true]) expect(rot(v)).toBe(0);
  });
  it("wraps and snaps like the server's normaliser", () => {
    expect(rot(360)).toBe(0);
    expect(rot(450)).toBe(90);
    expect(rot(-90)).toBe(270);
    expect(rot(-270)).toBe(90);
    expect(rot(89)).toBe(90);
    expect(rot(44)).toBe(0);
    expect(rot(-0)).toBe(0);
    expect(Object.is(rot(-0), 0)).toBe(true);
  });
});

describe("rotatedSize", () => {
  it("swaps width and height for quarter turns only", () => {
    expect(rotatedSize(640, 480, 0)).toEqual({ w: 640, h: 480 });
    expect(rotatedSize(640, 480, 180)).toEqual({ w: 640, h: 480 });
    expect(rotatedSize(640, 480, 90)).toEqual({ w: 480, h: 640 });
    expect(rotatedSize(640, 480, 270)).toEqual({ w: 480, h: 640 });
  });
});

describe("videoRotClass", () => {
  it("adds no class at 0 and one per turn otherwise", () => {
    expect(videoRotClass(0)).toBe("");
    expect(videoRotClass(90)).toBe("rot-v rot-v90");
    expect(videoRotClass(270)).toBe("rot-v rot-v270");
  });
});

describe("rotatedSrc", () => {
  it("returns the src untouched at rotation 0 (no canvas)", async () => {
    await expect(rotatedSrc("data:image/jpeg;base64,AAAA", 0)).resolves.toBe("data:image/jpeg;base64,AAAA");
  });
});
