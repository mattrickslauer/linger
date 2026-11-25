import { describe, expect, it } from "vitest";
import v4 from "../../shared/test-vectors-v4.json";
import {
  captured,
  claimsBackedByModule,
  factsOf,
  judgeClaims,
  normalizeClaims,
  normalizeClaimsAndPlan,
  normalizePlan,
  scoreV4,
  unmetRequirements,
  withoutClaim,
  type ScoreInput,
} from "./v4";

describe("scoreV4 reproduces shared/test-vectors-v4.json", () => {
  for (const c of v4.scoring) {
    it(c.name, () => {
      const got = scoreV4(c.input as unknown as ScoreInput);
      // toEqual compares doubles exactly: same order of operations as the reference.
      expect(JSON.parse(JSON.stringify(got))).toEqual(c.expect);
    });
  }
});

describe("normalize claims and plan (v4.1 / v4.2)", () => {
  it("drops unknown kinds and empty text, renumbers, keeps numbers only on count/measure > 0", () => {
    const { claims, remap } = normalizeClaims([
      { id: "c1", kind: "action", text: " clapping ", metric: "", value: 0, unit: "" },
      { id: "c2", kind: "vibe", text: "good" },
      { id: "c3", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
      { id: "c4", kind: "measure", text: "", value: 3 },
      { id: "c5", kind: "place", text: "garden", value: 7 },
    ]);
    expect(claims).toEqual([
      { id: "c1", kind: "action", text: "clapping" },
      { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
      { id: "c3", kind: "place", text: "garden" },
    ]);
    expect(remap.get("c3")).toBe("c2");
    expect(remap.get("c5")).toBe("c3");
  });
  it("keeps at most 5 claims and cuts text to 80", () => {
    const { claims } = normalizeClaims(Array.from({ length: 7 }, (_, i) => ({ kind: "object", text: "x".repeat(100) + i })));
    expect(claims).toHaveLength(5);
    expect(claims[0].text).toHaveLength(80);
  });
  it("remaps claimIds, drops unknown claims or evidence, omits minSeconds when not video/motion or ≤ 0", () => {
    const out = normalizeClaimsAndPlan(
      [
        { id: "c1", kind: "action", text: "clapping" },
        { id: "c2", kind: "bogus", text: "?" },
        { id: "c3", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
      ],
      {
        requirements: [
          { id: "r1", claimId: "c1", evidence: "video", ask: "Clap on camera", minSeconds: 0 },
          { id: "r2", claimId: "c2", evidence: "frames", ask: "?" },
          { id: "r3", claimId: "c3", evidence: "video", ask: "All 50 claps", minSeconds: 25 },
          { id: "r4", claimId: "c3", evidence: "frames", ask: "x", minSeconds: 5 },
          { id: "r5", claimId: "c1", evidence: "smell", ask: "x" },
        ],
        recordMode: "photo",
        note: "Keep both hands in frame.",
      },
    );
    expect(out.plan).toEqual({
      requirements: [
        { id: "r1", claimId: "c1", evidence: "video", ask: "Clap on camera" },
        { id: "r2", claimId: "c2", evidence: "video", ask: "All 50 claps", minSeconds: 25 },
        { id: "r3", claimId: "c2", evidence: "frames", ask: "x" },
      ],
      recordMode: "video",
      note: "Keep both hands in frame.",
    });
  });
  it("withoutClaim drops a claim and its requirements, renumbering both", () => {
    const { claims, plan } = normalizeClaimsAndPlan(
      [
        { id: "c1", kind: "action", text: "clapping" },
        { id: "c2", kind: "count", text: "50 claps", value: 50, metric: "claps", unit: "claps" },
      ],
      { requirements: [{ claimId: "c1", evidence: "frames", ask: "a" }, { claimId: "c2", evidence: "video", ask: "b", minSeconds: 20 }], recordMode: "video", note: "" },
    );
    const out = withoutClaim(claims, plan, "c1");
    expect(out.claims.map((c) => [c.id, c.text])).toEqual([["c1", "50 claps"]]);
    expect(out.plan?.requirements).toEqual([{ id: "r1", claimId: "c1", evidence: "video", ask: "b", minSeconds: 20 }]);
  });
  it("judgeClaims keeps one verdict per sent claim id", () => {
    expect(
      judgeClaims(
        [
          { id: "c1", verdict: "backed", confidence: 1.4 },
          { id: "c1", verdict: "not_backed", confidence: 0.9 },
          { id: "c9", verdict: "backed", confidence: 0.9 },
          { id: "c2", verdict: "maybe", confidence: "x" },
        ],
        [{ id: "c1" }, { id: "c2" }],
      ),
    ).toEqual([
      { id: "c1", verdict: "backed", confidence: 1 },
      { id: "c2", verdict: "unclear", confidence: 0 },
    ]);
    expect(judgeClaims(undefined, [])).toEqual([]);
  });
  it("a plan with nothing usable is null", () => {
    expect(normalizePlan({ requirements: [], recordMode: "video", note: "" }, [{ id: "c1", kind: "action", text: "x" }])).toBeNull();
    expect(normalizePlan(null, [])).toBeNull();
  });
});

describe("chain facts and the record-screen checklist", () => {
  const facts = factsOf(v4.videoChain.chunks);
  it("reads the clip, the frame and the rid-tagged witness answer from the v4 chain vector", () => {
    expect(facts.frameCount).toBe(1);
    expect(facts.clips).toEqual([{ sha256: v4.videoChain.clipSha, durationMs: 35000, startedAt: 1764200001000, bytes: 15, name: "verified-clap.webm" }]);
    expect(facts.witness).toEqual([{ wid: "w1", rid: "r1", answered: true }]);
    expect(facts.gpsFixes).toBe(0);
  });
  it("ticks video by length, witness by rid, motion by span", () => {
    expect(captured({ id: "r1", claimId: "c1", evidence: "video", ask: "", minSeconds: 30 }, facts)).toBe(true);
    expect(captured({ id: "r2", claimId: "c1", evidence: "video", ask: "", minSeconds: 40 }, facts)).toBe(false);
    expect(captured({ id: "r1", claimId: "c1", evidence: "witness", ask: "" }, facts)).toBe(true);
    expect(captured({ id: "r2", claimId: "c1", evidence: "witness", ask: "" }, facts)).toBe(false);
    expect(captured({ id: "r3", claimId: "c1", evidence: "motion", ask: "" }, facts)).toBe(false);
    const moving = factsOf([{ payload: JSON.stringify({ motion: [[1000, 0, 0, 0, 0, 0, 0], [2000, 0.1, 9.8, 0, 0, 0, 0], [13000, 0.2, 9.7, 0, 0, 0, 0]], gps: [[1, 1, 1, 150, null, null], [2, 1, 1, 8, null, null]] }) }]);
    expect(moving.motionSeconds).toBe(11);
    expect(moving.gpsFixes).toBe(1);
    expect(captured({ id: "r3", claimId: "c1", evidence: "motion", ask: "" }, moving)).toBe(true);
  });
  it("unmet requirements list what the witness should ask for first", () => {
    const plan = {
      requirements: [
        { id: "r1", claimId: "c1", evidence: "video" as const, ask: "Clap on camera" },
        { id: "r2", claimId: "c2", evidence: "gps" as const, ask: "Location on" },
      ],
      recordMode: "video" as const,
      note: "",
    };
    expect(unmetRequirements(plan, facts)).toEqual([{ id: "r2", claimId: "c2", evidence: "gps", ask: "Location on" }]);
  });
  it("witness_review moves only targeted claims unless an answer has no rid", () => {
    const input = {
      claims: [
        { id: "c1", kind: "outcome" as const },
        { id: "c2", kind: "place" as const },
      ],
      requirements: [
        { id: "r1", claimId: "c1", evidence: "witness" as const, ask: "" },
        { id: "r2", claimId: "c2", evidence: "gps" as const, ask: "" },
      ],
      facts: { witness: [{ rid: "r1", answered: true }] },
    };
    const all = ["action", "count", "measure", "place", "time", "object", "outcome"];
    expect(claimsBackedByModule(input, { backs: all, targetedOnly: true })).toEqual(["c1"]);
    expect(claimsBackedByModule({ ...input, facts: { witness: [{ rid: null, answered: true }] } }, { backs: all, targetedOnly: true })).toEqual(["c1", "c2"]);
  });
});
