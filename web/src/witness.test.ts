import { describe, expect, it } from "vitest";
import v3 from "../../shared/test-vectors-v3.json";
import { chunkHash, sha256hex, verifyChain } from "./chain";
import type { AppEvent, Chunk } from "./types";
import { answerEvent, askedText, canAsk, frameEvent, nextWid, skipEvent, witnessEvent, witnessSummary, worthAsking, type WitnessLog } from "./witness";

const g = v3.guestChain;

/** Rebuild each event from our builders and check the serialized bytes match the vector. */
function rebuild(e: Record<string, unknown>): AppEvent {
  switch (e.type) {
    case "witness":
      return witnessEvent(e.t as number, e.wid as string, e.ask as string, e.kind as "show", e.by as "on_device");
    case "frame":
      return frameEvent(e.t as number, e.wid as string | undefined);
    case "witness_answer":
      return answerEvent(e.t as number, e.wid as string, e.via as "frame", e.text as string | undefined);
    case "witness_skip":
      return skipEvent(e.t as number, e.wid as string, e.reason as string | undefined);
    default:
      return e as AppEvent;
  }
}

describe("guest chain with witness events (shared/test-vectors-v3.json)", () => {
  it("event builders reproduce the vector payload bytes", () => {
    for (const c of g.chunks) {
      const p = JSON.parse(c.payload);
      const again = JSON.stringify({ ...p, events: p.events.map(rebuild) });
      expect(again).toBe(c.payload);
    }
  });
  it("every hash and the head reproduce; the chain binds no owner", async () => {
    for (const c of g.chunks) {
      expect(await sha256hex(c.payload)).toBe(c.payloadSha);
      expect(await chunkHash(c.seq, c.t0, c.t1, c.prevHash, c.payload)).toBe(c.hash);
      expect(c.payload).not.toMatch(/uid|owner/i);
    }
    const chunks = g.chunks.map((c) => ({ ...c, frame: null }) as unknown as Chunk);
    const r = await verifyChain(g.momentId, chunks.map((c) => ({ ...c, payload: c.payload })), { headHash: g.headHash });
    // frames are not in the vector (only their sha), so only check links and head here
    expect(r.links.every((l) => l.status === "ok" || l.status === "bad-frame")).toBe(true);
    expect(r.headOk).toBe(true);
  });
});

describe("witness pacing", () => {
  const start = 1_000_000;
  const log = (n: number, open = false): WitnessLog => ({
    requests: Array.from({ length: n }, (_, i) => ({
      wid: `w${i + 1}`,
      ask: "x",
      kind: "show" as const,
      why: "",
      by: "on_device" as const,
      at: start + 30_000 + i * 60_000,
      outcome: open && i === n - 1 ? undefined : ("answered" as const),
    })),
  });
  it("waits 30 s for the first request", () => {
    expect(canAsk(start + 29_999, start, log(0))).toBe(false);
    expect(canAsk(start + 30_000, start, log(0))).toBe(true);
  });
  it("one open request at a time, 60 s apart, at most 6", () => {
    expect(canAsk(start + 200_000, start, log(1, true))).toBe(false);
    expect(canAsk(start + 30_000 + 59_999, start, log(1))).toBe(false);
    expect(canAsk(start + 30_000 + 60_000, start, log(1))).toBe(true);
    expect(canAsk(start + 10_000_000, start, log(6))).toBe(false);
  });
  it("only asks worth at least 0.1 gain with text", () => {
    expect(worthAsking({ ask: "", gain: 0.9 })).toBe(false);
    expect(worthAsking({ ask: "Show the ruler", gain: 0.05 })).toBe(false);
    expect(worthAsking({ ask: "Show the ruler", gain: 0.1 })).toBe(true);
  });
  it("wids, summary and prompt text", () => {
    const w: WitnessLog = { requests: [] };
    expect(nextWid(w)).toBe("w1");
    w.requests.push({ wid: "w1", ask: "Show the ruler", kind: "show", why: "", by: "on_device", at: 1, outcome: "answered", via: "frame" });
    w.requests.push({ wid: "w2", ask: "How heavy?", kind: "tell", why: "", by: "cloud", at: 2, outcome: "skipped" });
    expect(nextWid(w)).toBe("w3");
    expect(witnessSummary(w)).toEqual({ asked: 2, answered: 1, skipped: 1, mode: "mixed" });
    expect(askedText(w)).toContain('w1: "Show the ruler" (show) -> answered via frame');
  });
});
