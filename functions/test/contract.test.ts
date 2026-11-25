// v3 contract checks over shared/ (docs/ARCHITECTURE.md "v3"). Every platform must reproduce these vectors.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkChain, chunkHash, genesis, parsePayload, sha256hex } from "../src/seal";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../shared/${p}`, import.meta.url), "utf8"));
const v3 = read("test-vectors-v3.json");
const prompts = read("prompts.json");
const catalog = read("ladder.json");

describe("v3 guest chain (shared/test-vectors-v3.json)", () => {
  const { momentId, headHash, chunks } = v3.guestChain;
  it("hashes and links exactly like v1", () => {
    for (const c of chunks) {
      expect(sha256hex(c.payload)).toBe(c.payloadSha);
      expect(chunkHash(c)).toBe(c.hash);
    }
    expect(chunks[0].prevHash).toBe(genesis(momentId));
    expect(checkChain(momentId, { chunkCount: chunks.length, headHash }, chunks)).toEqual([]);
  });
  it("binds no owner: nothing in the chain mentions a uid", () => {
    for (const c of chunks) expect(c.payload).not.toMatch(/uid|owner/i);
  });
  it("witness events parse and pair up by wid", () => {
    const events = chunks.flatMap((c: { payload: string }) => parsePayload(c.payload)!.events);
    const asked = events.filter((e) => e.type === "witness").map((e) => e.wid);
    const answered = events.filter((e) => e.type === "witness_answer").map((e) => e.wid);
    const skipped = events.filter((e) => e.type === "witness_skip").map((e) => e.wid);
    expect(asked).toEqual(["w1", "w2", "w3"]);
    expect([...answered, ...skipped].sort()).toEqual(asked);
    const frameEvent = events.find((e) => e.type === "frame");
    expect(frameEvent?.wid).toBe("w1");
  });
});

describe("v3 bar and ladder math", () => {
  const barOf = (d: number) => Math.round((0.5 + 0.45 * Math.min(1, Math.max(0, d))) * 100) / 100;
  it("bar = round2(0.5 + 0.45 * clamp01(difficulty))", () => {
    for (const b of v3.bars) expect(barOf(b.difficulty)).toBe(b.bar);
  });
  it("pass p + s(1-p), fail p(1-s), in order; verified = score >= bar", () => {
    for (const l of v3.ladders) {
      let p = l.baseline;
      for (const s of l.steps) {
        expect(s.before).toBe(p);
        p = s.passed ? p + s.strength * (1 - p) : p * (1 - s.strength);
        expect(s.after).toBe(p);
        const mod = catalog.modules.find((m: { id: string }) => m.id === s.module);
        expect(mod?.strength).toBe(s.strength);
      }
      expect(l.score).toBe(p);
      expect(l.verified).toBe(p >= l.bar);
    }
  });
});

describe("shared/prompts.json + shared/ladder.json", () => {
  const keys = Object.keys(prompts).filter((k) => k !== "version");
  it("every prompt has mode, runsIn, system, user and an object schema", () => {
    for (const k of keys) {
      const p = prompts[k];
      expect(["PREFER_ON_DEVICE", "ONLY_IN_CLOUD"], k).toContain(p.mode);
      expect(["client", "functions"], k).toContain(p.runsIn);
      expect(typeof p.system, k).toBe("string");
      expect(typeof p.user, k).toBe("string");
      expect(p.schema?.type, k).toBe("object");
      for (const r of p.schema.required ?? []) expect(p.schema.properties, `${k}.${r}`).toHaveProperty(r);
    }
  });
  it("server-side agents are cloud-only; on-device prompts never run in functions", () => {
    for (const k of keys) if (prompts[k].runsIn === "functions") expect(prompts[k].mode, k).toBe("ONLY_IN_CLOUD");
    for (const k of ["interviewTurn", "witnessDraft", "barPreview", "liveCheck"]) expect(prompts[k].mode).toBe("PREFER_ON_DEVICE");
    for (const k of ["structureIntention", "bar"]) expect(prompts[k].mode).toBe("ONLY_IN_CLOUD");
  });
  it("every available ladder module names a functions prompt", () => {
    for (const m of catalog.modules) {
      expect(m.cost).toBeGreaterThan(0);
      expect(m.strength).toBeGreaterThan(0);
      expect(m.strength).toBeLessThan(1);
      for (const n of m.needs) expect(catalog.needs).toHaveProperty(n);
      if (m.available) expect(prompts[m.prompt]?.runsIn, m.id).toBe("functions");
    }
  });
});
