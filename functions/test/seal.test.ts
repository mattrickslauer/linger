import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ChunkDoc,
  MomentDoc,
  chunkHash,
  checkAi,
  checkChain,
  checkPhysics,
  downsample,
  evaluateSeal,
  genesis,
  isReadyToSeal,
  parsePayload,
  sha256hex,
} from "../src/seal";

const vectors = JSON.parse(readFileSync(new URL("../../shared/test-vectors.json", import.meta.url), "utf8"));
const ID: string = vectors.momentId;

describe("test vectors (shared/test-vectors.json)", () => {
  it("payloadSha matches", () => {
    for (const c of vectors.chunks) expect(sha256hex(c.payload)).toBe(c.payloadSha);
  });
  it("chunk hash matches", () => {
    for (const c of vectors.chunks) expect(chunkHash(c)).toBe(c.hash);
  });
  it("genesis and links", () => {
    expect(vectors.chunks[0].prevHash).toBe(genesis(ID));
    expect(vectors.chunks[1].prevHash).toBe(vectors.chunks[0].hash);
  });
  it("frameSha is sha256 of the base64 string", () => {
    expect(sha256hex("aGVsbG8=")).toBe(JSON.parse(vectors.chunks[1].payload).frameSha);
  });
  it("checkChain accepts the vector chain", () => {
    const m = { chunkCount: 2, headHash: vectors.chunks[1].hash };
    expect(checkChain(ID, m, vectors.chunks)).toEqual([]);
  });
  it("vector moment: chain/frames ok, timing fails (6 s < 20 s)", () => {
    const chunks: ChunkDoc[] = vectors.chunks.map((c: ChunkDoc, i: number) => ({
      ...c,
      frame: i === 1 ? { jpegB64: "aGVsbG8=", w: 1, h: 1, t: c.t1 } : null,
    }));
    const r = evaluateSeal(ID, moment({ chunkCount: 2, headHash: chunks[1].hash, startedAt: chunks[0].t0, endedAt: chunks[1].t1 }), chunks);
    expect(r.checks).toEqual({ chain: true, timing: false, physics: true, frames: true, ai: true });
    expect(r.sealed).toBe(false);
    expect(r.reason).toMatch(/too short/);
  });
});

// ───────── synthetic moments

function moment(over: Partial<MomentDoc> = {}): MomentDoc {
  return {
    ownerUid: "u1",
    status: "submitted",
    startedAt: 0,
    endedAt: 0,
    chunkCount: 0,
    headHash: null,
    judge: { verdict: "consistent", confidence: 0.9, reasons: ["Bass visible"] },
    skeptic: { verdict: "consistent", confidence: 0.8, reasons: ["No staging"] },
    seal: null,
    ...over,
  };
}

const JPEG = "/9j/AAAAfakejpeg";
function build(n = 6, mut?: (seq: number, p: any) => void): { m: MomentDoc; chunks: ChunkDoc[] } {
  const T0 = 1_764_000_000_000;
  const chunks: ChunkDoc[] = [];
  let prev = genesis(ID);
  for (let seq = 0; seq < n; seq++) {
    const t0 = T0 + seq * 5000;
    const t1 = t0 + 5000;
    const hasFrame = seq === 3;
    const p: any = {
      gps: [0, 1, 2, 3, 4].map((k) => [t0 + k * 1000, 33.6 + (seq * 5 + k) * 0.00002, -117.6, 5, null, 2]),
      motion: [0, 1, 2].map((k) => [t0 + k * 100, 0.1, 9.8, 0.2, 0.01, 0, 0]),
      events: [{ t: t0, type: seq === 0 ? "start" : "check" }],
      frameSha: hasFrame ? sha256hex(JPEG) : null,
      check: hasFrame ? { ok: true, reason: "keep going", mode: "on_device", label: "bass" } : null,
    };
    mut?.(seq, p);
    const payload = JSON.stringify(p);
    const c: ChunkDoc = { seq, t0, t1, prevHash: prev, payload, hash: "", frame: hasFrame ? { jpegB64: JPEG, w: 640, h: 480, t: t0 } : null };
    c.hash = chunkHash(c);
    prev = c.hash;
    chunks.push(c);
  }
  return { m: moment({ chunkCount: n, headHash: prev, startedAt: T0, endedAt: T0 + n * 5000 }), chunks };
}

describe("evaluateSeal", () => {
  it("seals a good moment", () => {
    const { m, chunks } = build();
    const r = evaluateSeal(ID, m, chunks);
    expect(r.failures).toEqual([]);
    expect(r.sealed).toBe(true);
    expect(r.summary.frameCount).toBe(1);
    expect(r.summary.gpsCount).toBe(30);
    expect(r.summary.motionCount).toBe(18);
    expect(r.summary.durationMs).toBe(30000);
    expect(r.heroFrameSeq).toBe(3);
    expect(r.summary.distanceM).toBeGreaterThan(50);
  });

  it("order-independent input", () => {
    const { m, chunks } = build();
    expect(evaluateSeal(ID, m, chunks.slice().reverse()).sealed).toBe(true);
  });

  it("detects a tampered payload", () => {
    const { m, chunks } = build();
    chunks[2].payload = chunks[2].payload.replace("33.6", "34.6");
    const r = evaluateSeal(ID, m, chunks);
    expect(r.checks.chain).toBe(false);
    expect(r.sealed).toBe(false);
  });

  it("detects a removed chunk", () => {
    const { m, chunks } = build();
    chunks.splice(2, 1);
    expect(evaluateSeal(ID, m, chunks).checks.chain).toBe(false);
  });

  it("detects a wrong headHash", () => {
    const { m, chunks } = build();
    m.headHash = chunks[2].hash;
    expect(evaluateSeal(ID, m, chunks).checks.chain).toBe(false);
  });

  it("detects a swapped frame", () => {
    const { m, chunks } = build();
    chunks[3].frame!.jpegB64 = "/9j/other";
    const r = evaluateSeal(ID, m, chunks);
    expect(r.checks.frames).toBe(false);
    expect(r.checks.chain).toBe(true);
  });

  it("requires at least one frame", () => {
    const { m, chunks } = build(6, (_s, p) => {
      p.frameSha = null;
    });
    for (const c of chunks) c.frame = null;
    expect(evaluateSeal(ID, m, chunks).checks.frames).toBe(false);
  });

  it("detects a GPS teleport", () => {
    const { m, chunks } = build(6, (seq, p) => {
      if (seq === 4) p.gps[0][1] += 1; // ~111 km in 1 s
    });
    const r = evaluateSeal(ID, m, chunks);
    expect(r.checks.physics).toBe(false);
    expect(r.checks.chain).toBe(true);
  });

  it("flags all-zero motion", () => {
    const { m, chunks } = build(6, (_s, p) => {
      p.motion = p.motion.map((s: number[]) => [s[0], 0, 0, 0, 0, 0, 0]);
    });
    expect(evaluateSeal(ID, m, chunks).checks.physics).toBe(false);
  });

  it("no motion at all is fine (web)", () => {
    const { m, chunks } = build(6, (_s, p) => {
      p.motion = [];
    });
    expect(evaluateSeal(ID, m, chunks).checks.physics).toBe(true);
  });

  it("flags endedAt before last chunk, and backwards time", () => {
    const a = build();
    a.m.endedAt = a.m.startedAt;
    expect(evaluateSeal(ID, a.m, a.chunks).checks.timing).toBe(false);
    const b = build(6, (seq, p) => {
      if (seq === 2) p.gps.reverse();
    });
    expect(evaluateSeal(ID, b.m, b.chunks).checks.timing).toBe(false);
  });

  it("too short is rejected", () => {
    const { m, chunks } = build(3);
    expect(evaluateSeal(ID, m, chunks).checks.timing).toBe(false);
  });

  it("malformed payload fails chain, never throws", () => {
    const { m, chunks } = build();
    chunks[1].payload = "{not json";
    chunks[1].hash = chunkHash(chunks[1]);
    const r = evaluateSeal(ID, m, chunks);
    expect(r.checks.chain).toBe(false);
  });
});

describe("checkAi", () => {
  const ok = { verdict: "consistent" as const, confidence: 0.9, reasons: [] };
  it("passes consistent judge + non-inconsistent skeptic", () => {
    expect(checkAi(ok, { ...ok, verdict: "uncertain" })).toEqual([]);
  });
  it("needs confidence >= 0.6", () => {
    expect(checkAi({ ...ok, confidence: 0.59 }, ok)).toHaveLength(1);
    expect(checkAi({ ...ok, confidence: 0.6 }, ok)).toEqual([]);
  });
  it("skeptic veto", () => {
    const f = checkAi(ok, { verdict: "inconsistent", confidence: 0.9, reasons: ["Moire pattern: photo of a screen"] });
    expect(f[0]).toMatch(/screen/);
  });
  it("missing opinions fail", () => {
    expect(checkAi(null, undefined)).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("downsample keeps ends and caps length", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(pts, 200);
    expect(d).toHaveLength(200);
    expect(d[0]).toBe(0);
    expect(d[199]).toBe(999);
    expect(downsample([1, 2, 3], 200)).toEqual([1, 2, 3]);
  });
  it("parsePayload tolerates garbage", () => {
    expect(parsePayload("nope")).toBeNull();
    expect(parsePayload("{}")).toMatchObject({ gps: [], motion: [], frameSha: null });
  });
  it("isReadyToSeal", () => {
    expect(isReadyToSeal(moment())).toBe(true);
    expect(isReadyToSeal(moment({ judge: null }))).toBe(false);
    expect(isReadyToSeal(moment({ status: "recording" }))).toBe(false);
    expect(isReadyToSeal(moment({ seal: { sealed: true } }))).toBe(false);
  });
  it("checkPhysics ignores jitter within accuracy", () => {
    const p = parsePayload(JSON.stringify({ gps: [[0, 33.6, -117.6, 30, null, null], [100, 33.6002, -117.6, 30, null, null]] }))!;
    expect(checkPhysics([p])).toEqual([]);
  });
});
