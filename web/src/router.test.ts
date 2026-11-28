import { describe, expect, it } from "vitest";
import { parse } from "./router";

describe("parse", () => {
  it("routes the SDK page", () => {
    expect(parse("/embed")).toEqual({ name: "embed" });
    expect(parse("/embed/")).toEqual({ name: "embed" });
    expect(parse("/embedded")).toEqual({ name: "missing" });
  });
  it("routes the download page", () => {
    expect(parse("/download")).toEqual({ name: "download" });
    expect(parse("/get/")).toEqual({ name: "download" });
    expect(parse("/downloads")).toEqual({ name: "missing" });
  });
  it("keeps the existing routes", () => {
    expect(parse("/")).toEqual({ name: "feed" });
    expect(parse("/m/abc-123")).toEqual({ name: "moment", id: "abc-123" });
    expect(parse("/me")).toEqual({ name: "me" });
  });
});
