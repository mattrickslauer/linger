import { describe, expect, it } from "vitest";
import vectors from "../../shared/test-vectors.json";
import { chunkHash, makeChunk, sha256hex, verifyChain } from "./chain";
import type { Chunk, Payload } from "./types";

const id = vectors.momentId;

describe("chain hashing reproduces shared/test-vectors.json", () => {
  it("hashes UTF-8 to lowercase hex", async () => {
    expect(await sha256hex("aGVsbG8=")).toBe("333d6b3a3c1f5db6c9bdda5939b136986d170f4649172a68368d54ecb44c2ff2");
  });

  for (const v of vectors.chunks) {
    it(`chunk ${v.seq}: payloadSha and hash`, async () => {
      expect(await sha256hex(v.payload)).toBe(v.payloadSha);
      expect(await chunkHash(v.seq, v.t0, v.t1, v.prevHash, v.payload)).toBe(v.hash);
    });
  }

  it("makeChunk serialises the payload to the exact vector bytes", async () => {
    for (const v of vectors.chunks) {
      const p = JSON.parse(v.payload) as Payload;
      const prev = v.seq === 0 ? null : vectors.chunks[v.seq - 1].hash;
      const c = await makeChunk(id, v.seq, v.t0, v.t1, prev, p, null);
      expect(c.payload).toBe(v.payload);
      expect(c.prevHash).toBe(v.prevHash);
      expect(c.hash).toBe(v.hash);
    }
  });

  const asChunks = (): Chunk[] =>
    vectors.chunks.map((v) => ({
      seq: v.seq,
      t0: v.t0,
      t1: v.t1,
      prevHash: v.prevHash,
      payload: v.payload,
      hash: v.hash,
      frame: v.seq === 1 ? { jpegB64: "aGVsbG8=", w: 1, h: 1, t: v.t1 } : null,
    }));

  it("verifies the vector chain end to end", async () => {
    const r = await verifyChain(id, asChunks(), { headHash: vectors.chunks[1].hash, chunkCount: 2 });
    expect(r.links.map((l) => l.status)).toEqual(["ok", "ok"]);
    expect(r.ok).toBe(true);
  });

  it("detects a tampered payload, a swapped frame, a missing chunk and a wrong head", async () => {
    const tampered = asChunks();
    tampered[0].payload = tampered[0].payload.replace("33.6189", "33.6190");
    expect((await verifyChain(id, tampered)).links[0].status).toBe("bad-hash");

    const frame = asChunks();
    frame[1].frame!.jpegB64 = "aGVsbG9=";
    expect((await verifyChain(id, frame)).links[1].status).toBe("bad-frame");

    const gap = asChunks().slice(1);
    expect((await verifyChain(id, gap)).ok).toBe(false);

    expect((await verifyChain(id, asChunks(), { headHash: "00" })).ok).toBe(false);
    expect((await verifyChain(id, asChunks(), { chunkCount: 3 })).ok).toBe(false);
  });
});
