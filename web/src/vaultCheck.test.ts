import { describe, expect, it } from "vitest";
import { compareVault, type VaultChunk } from "./vaultCheck";

// Mirrors android/app/src/test/java/com/mattricks/verified/VaultCheckTest.kt
const local: VaultChunk[] = [
  { seq: 0, hash: "h0", payload: '{"gps":[]}', frameB64: null },
  { seq: 1, hash: "h1", payload: '{"gps":[1]}', frameB64: "AAAA" },
];

function check(server: VaultChunk[], o: { head?: string | null; count?: number | null; status?: string | null } = {}) {
  const { head = "h1", count = 2, status = "submitted" } = o;
  return compareVault("h1", 2, head, count, status, local, server);
}

describe("compareVault (raw vault: delete the local copy only on a full match)", () => {
  it("identical server copy passes", () => {
    expect(check(local)).toEqual([]);
    expect(check(local, { status: "sealed" })).toEqual([]);
    expect(check(local, { status: "rejected" })).toEqual([]);
  });

  it("missing chunk keeps the local copy", () => {
    expect(check(local.slice(0, 1)).some((p) => p.includes("chunk 1 missing"))).toBe(true);
  });

  it("different payload, hash or frame keeps the local copy", () => {
    expect(check([local[0], { ...local[1], payload: "{}" }]).some((p) => p.includes("payload"))).toBe(true);
    expect(check([local[0], { ...local[1], hash: "x" }]).some((p) => p.includes("hash"))).toBe(true);
    expect(check([local[0], { ...local[1], frameB64: null }]).some((p) => p.includes("frame"))).toBe(true);
    expect(check([local[0], { ...local[1], frameB64: "BBBB" }]).some((p) => p.includes("frame"))).toBe(true);
  });

  it("wrong head, count or status keeps the local copy", () => {
    expect(check(local, { head: "other" })).toContain("headHash");
    expect(check(local, { head: null })).toContain("headHash");
    expect(check(local, { count: 3 }).some((p) => p.includes("chunkCount"))).toBe(true);
    expect(check(local, { count: null }).some((p) => p.includes("chunkCount"))).toBe(true);
    expect(check(local, { status: "recording" }).some((p) => p.includes("status"))).toBe(true);
    expect(check(local, { status: null }).some((p) => p.includes("status"))).toBe(true);
  });

  it("extra server chunk is flagged", () => {
    expect(check([...local, { seq: 2, hash: "h2", payload: "{}", frameB64: null }]).some((p) => p.includes("server has 3"))).toBe(true);
  });
});
