// Guest mode + claim-on-upload (docs/ARCHITECTURE.md v3.1): a Moment recorded with no account seals exactly
// like any other once a signed-in user uploads it, because the chain binds the momentId and never an owner.
import { describe, expect, it } from "vitest";
import { chainFacts, witnessCounts } from "../src/ladder";
import { ChunkDoc, MomentDoc, chunkHash, evaluateSeal, genesis, isReadyToSeal, needsBar, sha256hex } from "../src/seal";

const ID = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
const JPEG = "/9j/guestframe";
const T0 = Date.UTC(2026, 10, 20, 14, 0); // recorded days before the claim

/** Builds a guest chain the way every client records it: no uid anywhere, witness events in the payload. */
function guestChunks(): ChunkDoc[] {
  const chunks: ChunkDoc[] = [];
  let prev = genesis(ID);
  for (let seq = 0; seq < 7; seq++) {
    const t0 = T0 + seq * 5000;
    const t1 = t0 + 5000;
    const frame = seq === 4;
    const events: Array<Record<string, unknown>> = [];
    if (seq === 0) events.push({ t: t0, type: "start" });
    if (seq === 3) events.push({ t: t0 + 1000, type: "witness", wid: "w1", ask: "Hold the fish next to the ruler", kind: "show", by: "on_device" });
    if (frame) events.push({ t: t1, type: "frame", wid: "w1" }, { t: t1, type: "witness_answer", wid: "w1", via: "frame" });
    if (seq === 6) events.push({ t: t1, type: "stop" });
    const payload = JSON.stringify({
      gps: [0, 1, 2, 3, 4].map((k) => [t0 + k * 1000, 33.6 + (seq * 5 + k) * 0.00002, -117.6, 5, null, 1]),
      motion: [0, 1, 2].map((k) => [t0 + k * 100, 0.1, 9.8, 0.2, 0.01, 0, 0]),
      events,
      frameSha: frame ? sha256hex(JPEG) : null,
      check: frame ? { ok: true, reason: "keep going", mode: "on_device", label: "bass on ruler" } : null,
    });
    const c: ChunkDoc = { seq, t0, t1, prevHash: prev, payload, hash: "", frame: frame ? { jpegB64: JPEG, w: 640, h: 480, t: t1 } : null };
    c.hash = chunkHash(c);
    prev = c.hash;
    chunks.push(c);
  }
  return chunks;
}

/** The journal entry after the claim sheet (v3.1 step 2), as the vault re-creates and submits it. */
function claimed(uid: string, chunks: ChunkDoc[]): MomentDoc {
  return {
    ownerUid: uid,
    owner: { name: uid, photoURL: null },
    recordedAsGuest: true,
    claimedAt: T0 + 3 * 86_400_000,
    intention: { text: "Catch a bass", category: "fishing" },
    status: "submitted",
    startedAt: T0,
    endedAt: chunks[chunks.length - 1].t1,
    chunkCount: chunks.length,
    headHash: chunks[chunks.length - 1].hash,
    witness: { asked: 1, answered: 1, skipped: 0, mode: "on_device" },
    judge: { verdict: "consistent", confidence: 0.9, reasons: [] },
    skeptic: { verdict: "consistent", confidence: 0.8, reasons: [] },
    score: { probability: 0.7, reasons: [] },
    bar: { value: 0.59, difficulty: 0.2, rationale: "Ordinary catch", factors: [], source: "ai", model: "m", ranAt: 0 },
    seal: null,
  };
}

describe("guest claim (v3.1)", () => {
  const chunks = guestChunks();
  it("the guest chain carries no owner, uid or device id", () => {
    for (const c of chunks) expect(c.payload + c.prevHash).not.toMatch(/uid|owner|alice|deviceId/i);
  });
  it("a claimed guest Moment seals like any other, days after it was recorded", () => {
    const m = claimed("alice", chunks);
    expect(needsBar({ ...m, bar: null })).toBe(true);
    expect(isReadyToSeal(m)).toBe(true);
    const r = evaluateSeal(ID, m, chunks);
    expect(r.failures).toEqual([]);
    expect(r.sealed).toBe(true);
    expect(r.ladderEligible).toBe(true);
  });
  it("the same bytes seal identically whoever claims them: the owner is bound at upload, not in the chain", () => {
    const a = evaluateSeal(ID, claimed("alice", chunks), chunks);
    const b = evaluateSeal(ID, claimed("bob", chunks), chunks);
    expect(b).toEqual(a);
  });
  it("re-keying the chain to another momentId breaks it (a claim cannot copy someone else's Moment)", () => {
    const r = evaluateSeal("00000000-0000-4000-8000-000000000000", claimed("alice", chunks), chunks);
    expect(r.checks.chain).toBe(false);
  });
  it("witness answers recorded as a guest count on the feed after the claim", () => {
    expect(witnessCounts(chainFacts(chunks))).toEqual({ asked: 1, answered: 1, skipped: 0 });
  });
});
