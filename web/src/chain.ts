// SHA-256 hash chain, byte-for-byte as in docs/ARCHITECTURE.md and shared/test-vectors.json.
// Uses WebCrypto (browser and Node 20+), so visitors can re-verify a Moment in their own browser.

import type { Chunk, Payload } from "./types";

const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  const b = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

export const genesis = (momentId: string) => "GENESIS:" + momentId;

export async function chunkHash(seq: number, t0: number, t1: number, prevHash: string, payload: string): Promise<string> {
  return sha256hex(`${seq}|${t0}|${t1}|${prevHash}|${await sha256hex(payload)}`);
}

/** Serialise a payload once, in contract key order. The returned string is what gets hashed and stored. */
export function serializePayload(p: Payload): string {
  return JSON.stringify({ gps: p.gps, motion: p.motion, events: p.events, frameSha: p.frameSha, check: p.check });
}

export async function makeChunk(
  momentId: string,
  seq: number,
  t0: number,
  t1: number,
  prevHash: string | null,
  payload: Payload,
  frame: Chunk["frame"],
): Promise<Chunk> {
  const prev = seq === 0 ? genesis(momentId) : prevHash!;
  const s = serializePayload(payload);
  return { seq, t0, t1, prevHash: prev, payload: s, hash: await chunkHash(seq, t0, t1, prev, s), frame };
}

export type LinkStatus = "ok" | "bad-hash" | "bad-link" | "bad-seq" | "bad-frame";

export interface LinkResult {
  seq: number;
  status: LinkStatus;
  computed: string;
  detail: string;
}

export interface ChainReport {
  ok: boolean;
  links: LinkResult[];
  headOk: boolean | null;
  countOk: boolean | null;
}

/**
 * Recompute every hash from the stored payload strings (never re-serialised), check each prevHash
 * points at the previous chunk's hash, seqs have no gaps, and each frame matches its frameSha.
 */
export async function verifyChain(
  momentId: string,
  chunks: Chunk[],
  opts: { headHash?: string | null; chunkCount?: number | null; onLink?: (r: LinkResult) => void } = {},
): Promise<ChainReport> {
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
  const links: LinkResult[] = [];
  let prev = genesis(momentId);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const computed = await chunkHash(c.seq, c.t0, c.t1, c.prevHash, c.payload);
    let status: LinkStatus = "ok";
    let detail = "hash matches";
    if (c.seq !== i) {
      status = "bad-seq";
      detail = `expected seq ${i}, found ${c.seq}`;
    } else if (c.prevHash !== prev) {
      status = "bad-link";
      detail = "prevHash does not point at the previous chunk";
    } else if (computed !== c.hash) {
      status = "bad-hash";
      detail = "stored hash differs from recomputed hash";
    } else {
      let frameSha: string | null = null;
      try {
        frameSha = (JSON.parse(c.payload) as Payload).frameSha ?? null;
      } catch {
        /* payload not JSON: hash still covers it */
      }
      if (frameSha || c.frame) {
        const got = c.frame ? await sha256hex(c.frame.jpegB64) : null;
        if (got !== frameSha) {
          status = "bad-frame";
          detail = "proof frame does not match its frameSha";
        } else detail = "hash and proof frame match";
      }
    }
    const r = { seq: c.seq, status, computed, detail };
    links.push(r);
    opts.onLink?.(r);
    prev = c.hash;
  }
  const headOk = opts.headHash == null ? null : sorted.length > 0 && sorted[sorted.length - 1].hash === opts.headHash;
  const countOk = opts.chunkCount == null ? null : opts.chunkCount === sorted.length;
  return { ok: links.every((l) => l.status === "ok") && headOk !== false && countOk !== false, links, headOk, countOk };
}
