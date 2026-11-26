import { afterEach, describe, expect, it } from "vitest";
import { _setDeviceRotation, currentFrameRotation, frameRotation, rotationFromGravity, toQuarter } from "./orientation";

const G = 9.81;
const tilt = (deg: number, g = G) => [g * Math.sin((deg * Math.PI) / 180), g * Math.cos((deg * Math.PI) / 180), 0] as const;

describe("rotationFromGravity", () => {
  it("reads the four held orientations (W3C sign convention)", () => {
    expect(rotationFromGravity(0, G, 0, 90)).toBe(0); // upright portrait
    expect(rotationFromGravity(G, 0, 0, 0)).toBe(90); // turned counter-clockwise (top to the left)
    expect(rotationFromGravity(0, -G, 0, 0)).toBe(180); // upside down
    expect(rotationFromGravity(-G, 0, 0, 0)).toBe(270); // turned clockwise
  });

  it("holds the last value when flat or mostly flat", () => {
    expect(rotationFromGravity(0, 0, G, 90)).toBe(90);
    expect(rotationFromGravity(0.5, 0.3, -G, 270)).toBe(270);
    expect(rotationFromGravity(3, 1, 9, 180)).toBe(180); // tilted only ~20° off flat
  });

  it("has hysteresis around the 45° diagonals", () => {
    expect(rotationFromGravity(...tilt(44), 0)).toBe(0);
    expect(rotationFromGravity(...tilt(46), 0)).toBe(0); // just past 45°: not yet
    expect(rotationFromGravity(...tilt(58), 0)).toBe(0);
    expect(rotationFromGravity(...tilt(62), 0)).toBe(90); // well inside the 90° quadrant
    expect(rotationFromGravity(...tilt(40), 90)).toBe(90); // and back needs to go well past 45° the other way
    expect(rotationFromGravity(...tilt(28), 90)).toBe(0);
    expect(rotationFromGravity(...tilt(-62), 0)).toBe(270);
    expect(rotationFromGravity(...tilt(170), 270)).toBe(180);
  });
});

describe("frameRotation", () => {
  it("is zero when the screen follows the device", () => {
    for (const q of [0, 90, 180, 270] as const) expect(frameRotation(q, q)).toBe(0);
  });
  it("turns the rear-camera frame back against the device rotation under the portrait lock", () => {
    expect(frameRotation(90, 0)).toBe(270); // top-left landscape: rotate 90° counter-clockwise
    expect(frameRotation(270, 0)).toBe(90);
    expect(frameRotation(180, 0)).toBe(180);
  });
  it("reverses the quarter turns for the un-mirrored front camera frame", () => {
    expect(frameRotation(90, 0, true)).toBe(90);
    expect(frameRotation(270, 0, true)).toBe(270);
    expect(frameRotation(180, 0, true)).toBe(180);
  });
  it("accepts window.orientation's -90 and odd screen angles", () => {
    expect(frameRotation(270, -90)).toBe(0);
    expect(toQuarter(-90)).toBe(270);
    expect(toQuarter(359)).toBe(0);
  });
});

describe("currentFrameRotation", () => {
  afterEach(() => _setDeviceRotation(null));
  it("is zero with no motion reading (desktop)", () => {
    _setDeviceRotation(null);
    expect(currentFrameRotation(false)).toBe(0);
    expect(currentFrameRotation(true)).toBe(0);
  });
});
