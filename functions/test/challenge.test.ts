// v5 crowd rebuttals (docs/ARCHITECTURE.md v5): the outcome vectors, anchors, who may rebut, the round state
// machine, the rate limit, coercion of model answers and the fake agents.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiCall, AiEngine, fakeEngine } from "../src/ai";
import {
  acceptRebuttal,
  anchorProblem,
  challengeOutcome,
  challengeableWhy,
  claimsOf,
  coerceReview,
  coerceScreen,
  currentRoundUids,
  feedChallenge,
  mootIfDropped,
  framesForReview,
  rateCheck,
  resolveRound,
  storedVerdict,
  thresholdFor,
  validateRebuttalRequest,
  voidRound,
} from "../src/challenge";
import { anchorText, runChallengeReview, runScreen } from "../src/challengeAgents";
import { eligibility } from "../src/callable";
import type { MomentDoc } from "../src/seal";

const v5 = JSON.parse(readFileSync(new URL("../../shared/test-vectors-v5.json", import.meta.url), "utf8"));
const SHA = "a".repeat(64);

const sealed = (extra: Record<string, unknown> = {}): MomentDoc =>
  ({ ownerUid: "owner", status: "sealed", startedAt: 0, endedAt: 1, chunkCount: 1, headHash: null, seal: { sealed: true, version: 4, ladderEligible: true }, ...extra }) as MomentDoc;

describe("challengeOutcome reproduces every shared/test-vectors-v5.json case", () => {
  for (const c of v5.outcome) it(c.name, () => expect(challengeOutcome(c.input)).toEqual(c.expect));
});

describe("validateRebuttalRequest", () => {
  const ok = { momentId: "m1", text: " count restarts at 0:41 ", category: "edited", anchor: { claimId: "c2", kind: "claim" } };
  it("trims text and keeps a claim anchor", () => {
    const r = validateRebuttalRequest(ok);
    expect(r.text).toBe("count restarts at 0:41");
    expect(r.anchor).toEqual({ claimId: "c2", kind: "claim" });
    expect(r.draftedOnDevice).toBe(false);
  });
  it("rejects empty, over-long, unknown category, bad anchors", () => {
    expect(() => validateRebuttalRequest({ ...ok, text: "  " })).toThrow();
    expect(() => validateRebuttalRequest({ ...ok, text: "x".repeat(241) })).toThrow();
    expect(() => validateRebuttalRequest({ ...ok, category: "rude" })).toThrow();
    expect(() => validateRebuttalRequest({ ...ok, anchor: { claimId: "x", kind: "claim" } })).toThrow();
    expect(() => validateRebuttalRequest({ ...ok, anchor: { claimId: "c1", kind: "frame" } })).toThrow();
    expect(() => validateRebuttalRequest({ ...ok, anchor: { claimId: "c1", kind: "clip", clipSha: "zz", clipMs: 3 } })).toThrow();
    expect(() => validateRebuttalRequest({ ...ok, anchor: { claimId: "c1", kind: "track", trackIndex: -1 } })).toThrow();
  });
  it("keeps only the fields of the anchor kind", () => {
    const r = validateRebuttalRequest({ ...ok, anchor: { claimId: "c1", kind: "clip", clipSha: SHA, clipMs: 41000, frameSeq: 3 } });
    expect(r.anchor).toEqual({ claimId: "c1", kind: "clip", clipSha: SHA, clipMs: 41000 });
  });
});

describe("anchorProblem", () => {
  const facts = { frames: [{ seq: 2, t: 0, sha: "", wid: null, jpegB64: "" }] };
  const clips = [{ sha256: SHA, durationMs: 60000, uploaded: true }];
  const p = (a: Record<string, unknown>) => anchorProblem({ claimId: "c1", kind: "claim", ...a } as never, ["c1", "c2"], facts, clips, 10);
  it("accepts real anchors", () => {
    expect(p({})).toBeNull();
    expect(p({ kind: "frame", frameSeq: 2 })).toBeNull();
    expect(p({ kind: "clip", clipSha: SHA, clipMs: 60000 })).toBeNull();
    expect(p({ kind: "track", trackIndex: 9 })).toBeNull();
  });
  it("refuses what the Moment does not have", () => {
    expect(p({ claimId: "c3" })).toBe("no such claim");
    expect(p({ kind: "frame", frameSeq: 3 })).toBe("no such frame");
    expect(p({ kind: "clip", clipSha: "b".repeat(64), clipMs: 0 })).toBe("no such clip");
    expect(p({ kind: "clip", clipSha: SHA, clipMs: 60001 })).toBe("time is outside the clip");
    expect(p({ kind: "track", trackIndex: 10 })).toBe("no such map point");
  });
});

describe("claimsOf", () => {
  it("uses server claims, else the intention as c1", () => {
    expect(claimsOf(sealed({ claims: { items: [{ id: "c1", kind: "action", text: "clapping" }] } }))).toEqual([{ id: "c1", text: "clapping", kind: "action" }]);
    expect(claimsOf(sealed({ intention: { text: "Catch a bass" } }))).toEqual([{ id: "c1", text: "Catch a bass", kind: "outcome" }]);
  });
});

describe("challengeableWhy", () => {
  it("only sealed, unrevoked, not reviewing/overturned, not the owner, once per person", () => {
    expect(challengeableWhy(sealed(), "bob")).toBeNull();
    expect(challengeableWhy(undefined, "bob")).toBe("not_challengeable");
    expect(challengeableWhy(sealed({ status: "rejected" }), "bob")).toBe("not_challengeable");
    expect(challengeableWhy(sealed({ seal: { sealed: false, revoked: { round: 1 } } }), "bob")).toBe("not_challengeable");
    expect(challengeableWhy(sealed({ challenge: { status: "reviewing", rebutters: [] } }), "bob")).toBe("not_challengeable");
    expect(challengeableWhy(sealed({ challenge: { status: "overturned", rebutters: [] } }), "bob")).toBe("not_challengeable");
    expect(challengeableWhy(sealed(), "owner")).toBe("own_moment");
    expect(challengeableWhy(sealed({ challenge: { status: "survived", rebutters: ["bob"] } }), "bob")).toBe("already_rebutted");
  });
});

describe("rounds", () => {
  it("thresholds double: 3, 6, 12", () => expect([1, 2, 3].map(thresholdFor)).toEqual([3, 6, 12]));
  it("the third accepted rebuttal starts the review", () => {
    let c = acceptRebuttal(null, "a").next;
    expect(c).toMatchObject({ round: 1, threshold: 3, accepted: 1, status: "open", rebutters: ["a"] });
    c = acceptRebuttal(c, "b").next;
    const r = acceptRebuttal(c, "c");
    expect(r.reviewing).toBe(true);
    expect(r.next).toMatchObject({ accepted: 3, status: "reviewing", rebutters: ["a", "b", "c"] });
  });
  it("after Survived the next rebuttal opens round 2 at threshold 6", () => {
    const done = resolveRound({ round: 1, threshold: 3, accepted: 3, status: "reviewing", tries: 1, rebutters: ["a", "b", "c"], rounds: [] }, { outcome: "survived", fallen: [], holding: [], reason: null }, "holds", 3, 5);
    expect(done.status).toBe("survived");
    expect(done.rounds).toEqual([{ round: 1, threshold: 3, outcome: "survived", summary: "holds", at: 5, upheld: 0, total: 3 }]);
    const r = acceptRebuttal(done, "d");
    expect(r.next).toMatchObject({ round: 2, threshold: 6, accepted: 1, status: "open", rebutters: ["a", "b", "c", "d"] });
    expect(feedChallenge(done)).toMatchObject({ status: "survived", upheld: 0, summary: "holds", survived: 1 });
  });
  it("a voided round frees its rebutters and reopens the same round empty", () => {
    const c = { round: 2, threshold: 6, accepted: 6, status: "reviewing" as const, tries: 3, rebutters: ["a", "b", "x", "y"], rounds: [] };
    const v = voidRound(c, "error", ["x", "y"], 9);
    expect(v).toMatchObject({ round: 2, threshold: 6, accepted: 0, status: "open", tries: 0, rebutters: ["a", "b"] });
    expect(v.rounds[0]).toMatchObject({ outcome: "error", total: 2, upheld: 0 });
  });
});

describe("rateCheck", () => {
  it("allows 10 per rolling 24 h", () => {
    const now = 100 * 3_600_000;
    const nine = Array.from({ length: 9 }, (_, i) => now - i * 1000);
    expect(rateCheck(nine, now).ok).toBe(true);
    expect(rateCheck([...nine, now], now).ok).toBe(false);
    expect(rateCheck([...nine, now - 25 * 3_600_000], now)).toEqual({ ok: true, kept: nine });
  });
});

describe("coercion", () => {
  it("screen: unknown category falls back, reason trimmed", () => {
    expect(coerceScreen({ accepted: true, reason: " fine ", category: "zzz" }, "edited")).toEqual({ accepted: true, reason: "fine", category: "edited" });
    expect(coerceScreen({}, "other").accepted).toBe(false);
  });
  it("review: unknown ids dropped, confidence clamped, first answer wins, signals only when detected", () => {
    const r = coerceReview(
      {
        rebuttals: [{ id: "r1", verdict: "upheld", confidence: 4, reason: "x" }, { id: "r1", verdict: "dismissed", confidence: 1 }, { id: "rX", verdict: "upheld", confidence: 1 }, { id: "r2", verdict: "maybe", confidence: 1 }],
        claims: [{ id: "c1", verdict: "not_backed", confidence: -1, reasons: ["a", "b", "c"] }],
        cheating: { detected: false, signals: ["loop"] },
        summary: "s",
      },
      ["r1", "r2"],
      ["c1"],
    );
    expect(r.rebuttals).toEqual([{ id: "r1", verdict: "upheld", confidence: 1, reason: "x" }]);
    expect(r.claims).toEqual([{ id: "c1", verdict: "not_backed", confidence: 0, reasons: ["a", "b"] }]);
    expect(r.cheating).toEqual({ detected: false, signals: [] });
    expect(() => coerceReview({}, [], [])).toThrow();
  });
  it("stored verdict: low-confidence upheld is unclear", () => {
    expect(storedVerdict({ id: "r", verdict: "upheld", confidence: 0.59, reason: "" })).toBe("unclear");
    expect(storedVerdict({ id: "r", verdict: "upheld", confidence: 0.6, reason: "" })).toBe("upheld");
    expect(storedVerdict(undefined)).toBe("unclear");
  });
});

describe("framesForReview", () => {
  const frames = Array.from({ length: 20 }, (_, i) => ({ seq: i }));
  it("keeps anchored frames, fills to 8, chain order", () => {
    const got = framesForReview(frames, [17, 3]).map((f) => f.seq);
    expect(got).toHaveLength(8);
    expect(got).toContain(17);
    expect(got).toContain(3);
    expect([...got].sort((a, b) => a - b)).toEqual(got);
  });
  it("more than 8 anchored → the first 8 anchored", () => {
    expect(framesForReview(frames, frames.map((f) => f.seq)).map((f) => f.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("agents (fake engine)", () => {
  const facts = { startT: 0, endT: 60000, frames: [{ seq: 1, t: 41000, sha: "", wid: null, jpegB64: "AA" }], gps: [], motion: [], witness: [], videos: [] };
  it("screen refuses junk and accepts a specific point", async () => {
    expect((await runScreen({ claim: { id: "c1", text: "x" }, anchor: "a", text: "fake lol", category: "other" }, fakeEngine)).accepted).toBe(false);
    expect((await runScreen({ claim: { id: "c1", text: "x" }, anchor: "a", text: "the count restarts near 0:41", category: "edited" }, fakeEngine)).accepted).toBe(true);
  });
  it("review upholds #rebut-hold and sends anchored frames + rebuttals without identities", async () => {
    let seen: AiCall | null = null;
    const spy: AiEngine = { name: "spy", generateJson: (c) => ((seen = c), fakeEngine.generateJson(c)) };
    const r = await runChallengeReview(
      {
        moment: sealed({ intention: { text: "clap 50 times" } }),
        facts,
        claims: [{ id: "c1", text: "50 claps", p: 0.6 }],
        rebuttals: [{ id: "r1", claimId: "c1", anchor: { claimId: "c1", kind: "frame", frameSeq: 1 }, category: "edited", text: "restarts #rebut-hold" }],
        clips: [],
      },
      spy,
    );
    expect(r.rebuttals[0]).toMatchObject({ id: "r1", verdict: "upheld" });
    expect(r.claims[0]).toMatchObject({ id: "c1", verdict: "not_backed" });
    expect(seen!.media).toHaveLength(1);
    expect(seen!.vars.rebuttals).toContain("proof frame seq 1 at 0:41");
    expect(seen!.vars.rebuttals).not.toContain("uid");
  });
  it("anchorText", () => {
    expect(anchorText({ claimId: "c1", kind: "clip", clipSha: SHA, clipMs: 61000 }, facts)).toBe("video clip aaaaaaaa at 1:01");
    expect(anchorText({ claimId: "c1", kind: "track", trackIndex: 4 }, facts)).toBe("map point 4 of the GPS track");
  });
});

describe("round helpers", () => {
  it("current round uids are the last `accepted` rebutters; moot only for an open round with rebuttals dropping to rejected", () => {
    const c = { round: 2, threshold: 6, accepted: 2, status: "open" as const, tries: 0, rebutters: ["a", "b", "c", "d", "e"], rounds: [] };
    expect(currentRoundUids(c)).toEqual(["d", "e"]);
    expect(currentRoundUids({ ...c, accepted: 0 })).toEqual([]);
    expect(mootIfDropped(c, "rejected")).toBe(true);
    expect(mootIfDropped(c, "sealed")).toBe(false);
    expect(mootIfDropped({ ...c, accepted: 0 }, "rejected")).toBe(false);
    expect(mootIfDropped({ ...c, status: "survived" }, "rejected")).toBe(false);
    expect(mootIfDropped(null, "rejected")).toBe(false);
  });
});

describe("ladder eligibility (v5 guards)", () => {
  it("refuses overturned and in-review Moments", () => {
    expect(eligibility(sealed({ status: "rejected", seal: { sealed: false, version: 4, ladderEligible: true, revoked: { round: 1 } } }), "second_look", "r")).toBe("overturned");
    expect(eligibility(sealed({ challenge: { status: "reviewing" } }), "second_look", "r")).toBe("in_review");
    expect(eligibility(sealed({ challenge: { status: "open" } }), "second_look", "r")).toBeNull();
  });
});
