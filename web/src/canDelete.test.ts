import { describe, expect, it } from "vitest";
import { cameFromMe, canDeleteMoment, type DeleteContext } from "./canDelete";

const base: DeleteContext = { fixtures: false, uid: "u1", ownerUid: "u1", fromMe: true, id: "m1", recordingId: null };

describe("canDeleteMoment", () => {
  it("allows the signed-in owner coming from /me", () => expect(canDeleteMoment(base)).toBe(true));
  it("never for someone else's Moment", () => expect(canDeleteMoment({ ...base, ownerUid: "u2" })).toBe(false));
  it("never when signed out", () => {
    expect(canDeleteMoment({ ...base, uid: null })).toBe(false);
    expect(canDeleteMoment({ ...base, uid: undefined, ownerUid: undefined })).toBe(false);
  });
  it("never from the public feed", () => expect(canDeleteMoment({ ...base, fromMe: false })).toBe(false));
  it("never the Moment being recorded in this tab", () => {
    expect(canDeleteMoment({ ...base, recordingId: "m1" })).toBe(false);
    expect(canDeleteMoment({ ...base, recordingId: "other" })).toBe(true);
  });
  it("never in fixture mode", () => expect(canDeleteMoment({ ...base, fixtures: true })).toBe(false));
  it("never when the owner is unknown (feed-only data)", () => expect(canDeleteMoment({ ...base, ownerUid: null })).toBe(false));
});

describe("cameFromMe", () => {
  it("reads ?from=me", () => {
    expect(cameFromMe("?from=me")).toBe(true);
    expect(cameFromMe("?x=1&from=me")).toBe(true);
    expect(cameFromMe("")).toBe(false);
    expect(cameFromMe("?from=feed")).toBe(false);
  });
});
