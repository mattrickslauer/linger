// v3 + v4 contract checks over shared/ (docs/ARCHITECTURE.md "v3", "v4"). Every platform must reproduce these vectors.
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

// ───────────────────────────────────────────────── v4 (docs/ARCHITECTURE.md "v4")
import * as V4 from "../src/v4";

const v4 = read("test-vectors-v4.json");

type Verdict = { id: string; verdict: string; confidence: number };
/** Independent re-implementation of v4.5 (the reference is shared/make-test-vectors-v4.mjs). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreV4(input: any) {
  const backs = (x: Verdict | undefined) => !!x && x.verdict === "backed" && x.confidence >= V4.BACKED_CONFIDENCE;
  const f = input.facts;
  const framesBack = (id: string) => {
    const j = input.judge;
    if (!j || f.frameCount < 1) return false;
    if (Array.isArray(j.claims) && j.claims.length) return backs(j.claims.find((c: Verdict) => c.id === id));
    return j.verdict === "consistent" && j.confidence >= V4.BACKED_CONFIDENCE;
  };
  const goodClip = (c: any) => c.uploaded && c.hashOk === true;
  const videoBack = (id: string) =>
    input.videoReview?.status === "done" && f.clips.some(goodClip) && backs((input.videoReview.claims ?? []).find((c: Verdict) => c.id === id));
  const met = (r: any) =>
    r.evidence === "video" ? f.clips.some((c: any) => goodClip(c) && c.durationMs > 0 && c.durationMs >= (r.minSeconds ?? 0) * 1000) && videoBack(r.claimId)
    : r.evidence === "frames" ? framesBack(r.claimId)
    : r.evidence === "gps" ? f.gpsFixes >= 1
    : r.evidence === "motion" ? f.motionSeconds >= (r.minSeconds || V4.DEFAULT_MOTION_SECONDS)
    : r.evidence === "witness" ? f.witness.some((w: any) => w.answered && (w.rid === r.id || w.rid == null))
    : false;
  const signals: string[] = [];
  if (!f.integrity.chain) signals.push("chain: hashes do not link");
  if (!f.integrity.timing) signals.push("timing: clock does not add up");
  if (!f.integrity.physics) signals.push("physics: impossible movement");
  if (input.skeptic?.verdict === "inconsistent") signals.push("skeptic: " + (input.skeptic.reasons?.[0] ?? "fake signal"));
  if (f.clips.some((c: any) => c.uploaded && c.hashOk === false)) signals.push("video: clip does not match the chain");
  const rc = input.videoReview?.status === "done" ? input.videoReview.cheating : null;
  if (rc?.detected) signals.push(...(rc.signals?.length ? rc.signals.map((s: string) => "video: " + s) : ["video: cheating detected"]));
  const cheating = signals.length > 0;
  const base = input.baseline == null ? V4.DEFAULT_BASELINE : Math.min(1, Math.max(0, input.baseline));
  const claims = input.claims.map((c: any) => {
    const reqs = input.requirements.filter((r: any) => r.claimId === c.id);
    const m = reqs.filter(met).map((r: any) => r.id);
    const minimumMet = reqs.length > 0 && m.length === reqs.length;
    const sealP = minimumMet && !cheating ? Math.max(base, input.bar) : base;
    return { id: c.id, kind: c.kind, sealP, p: sealP };
  });
  for (const mod of input.ladder ?? []) {
    let ids = claims.filter((c: any) => mod.backs.includes(c.kind)).map((c: any) => c.id);
    const answered = f.witness.filter((w: any) => w.answered);
    if (mod.targetedOnly && !answered.some((w: any) => w.rid == null)) {
      const targeted = input.requirements.filter((r: any) => answered.some((w: any) => w.rid === r.id)).map((r: any) => r.claimId);
      ids = ids.filter((id: string) => targeted.includes(id));
    }
    for (const c of claims) if (ids.includes(c.id)) {
      c.p = backs((mod.claims ?? []).find((x: Verdict) => x.id === c.id)) ? c.p + mod.strength * (1 - c.p) : c.p * (1 - mod.strength);
    }
  }
  for (const c of claims) if (cheating) c.p = Math.min(c.p, V4.CHEATING_CAP);
  const score = Math.min(...claims.map((c: any) => c.p));
  const checks = {
    ...f.integrity,
    ai: !(input.judge?.verdict === "inconsistent" && input.judge.confidence >= V4.BACKED_CONFIDENCE),
    cheating: !cheating,
    bar: claims.every((c: any) => c.p >= input.bar),
  };
  return { claims, score, checks, sealed: Object.values(checks).every(Boolean), signals: signals.slice(0, V4.MAX_CHEATING_SIGNALS) };
}

describe("v4 per-claim scoring (shared/test-vectors-v4.json)", () => {
  it("constants match functions/src/v4.ts and ladder.json", () => {
    expect(v4.constants.DEFAULT_BASELINE).toBe(V4.DEFAULT_BASELINE);
    expect(v4.constants.CHEATING_CAP).toBe(V4.CHEATING_CAP);
    expect(v4.constants.BACKED_CONFIDENCE).toBe(V4.BACKED_CONFIDENCE);
    expect(v4.constants.BACKED_CONFIDENCE).toBe(catalog.passConfidence);
    expect(v4.constants.DEFAULT_MOTION_SECONDS).toBe(V4.DEFAULT_MOTION_SECONDS);
    expect(v4.constants.MAX_SIGNALS).toBe(V4.MAX_CHEATING_SIGNALS);
  });
  for (const c of v4.scoring) {
    it(c.name, () => {
      const got = scoreV4(c.input);
      const e = c.expect;
      expect(got.claims.map((x: any) => [x.id, x.sealP, x.p])).toEqual(e.claims.map((x: any) => [x.id, x.sealP, x.p]));
      expect(got.score).toBe(e.score);
      expect(got.checks).toEqual(e.checks);
      expect(got.sealed).toBe(e.sealed);
      expect(e.verified).toBe(e.sealed);
      expect(got.signals).toEqual(e.cheating.signals);
      expect(e.cheating.detected).toBe(e.cheating.signals.length > 0);
      expect(e.ladderEligible).toBe(e.checks.chain && e.checks.timing && e.checks.physics && e.checks.frames && e.checks.cheating);
      for (const x of e.claims) {
        expect([...x.met, ...x.unmet].sort()).toEqual(c.input.requirements.filter((r: any) => r.claimId === x.id).map((r: any) => r.id).sort());
        expect(x.minimumMet).toBe(x.met.length > 0 && x.unmet.length === 0);
      }
      for (const step of e.ladder) {
        const mod = catalog.modules.find((m: { id: string }) => m.id === step.module);
        const inMod = c.input.ladder.find((m: any) => m.module === step.module);
        expect(inMod.strength, step.module).toBe(mod.strength);
        expect(inMod.backs, step.module).toEqual(mod.backs);
        expect(!!inMod.targetedOnly).toBe(!!mod.backsTargetedOnly);
      }
    });
  }
  const byName = (s: string) => v4.scoring.find((c: any) => c.name.startsWith(s)).expect;
  it("minimum evidence + no cheating = bar (the clap-50 Moment is Verified for free)", () => {
    const e = byName("clap 50 with the full clip");
    expect(e.claims.every((c: any) => c.p === 0.52 && c.minimumMet)).toBe(true);
    expect(e.verified).toBe(true);
    expect(byName("clap 50 photo only").verified).toBe(false);
    expect(byName("no client scorer").baselineUsed).toBe(0.2);
    expect(byName("no client scorer").verified).toBe(true);
  });
  it("cheating caps every claim at 0.1 and rejects", () => {
    for (const n of ["video review detects cheating", "clip hash mismatch", "skeptic inconsistent", "broken chain"]) {
      const e = byName(n);
      expect(e.cheating.detected, n).toBe(true);
      expect(e.claims.every((c: any) => c.p <= 0.1), n).toBe(true);
      expect(e.verified, n).toBe(false);
      expect(e.ladderEligible, n).toBe(false);
    }
  });
  it("modules move only the claims they back; overall = min", () => {
    const e = byName("fish + count_measure");
    expect(e.claims.find((c: any) => c.id === "c3").p).toBe(0.73);
    expect(e.score).toBe(Math.min(...e.claims.map((c: any) => c.p)));
    expect(e.ladder.map((s: any) => s.claims.map((x: any) => x.id))).toEqual([["c2"], ["c1"]]);
  });
});

describe("v4 chain: witness rid + chained clip (shared/test-vectors-v4.json videoChain)", () => {
  const { momentId, headHash, chunks, clipSha } = v4.videoChain;
  it("hashes exactly like v1 and carries rid + the video event", () => {
    for (const c of chunks) {
      expect(sha256hex(c.payload)).toBe(c.payloadSha);
      expect(chunkHash(c)).toBe(c.hash);
    }
    expect(checkChain(momentId, { chunkCount: chunks.length, headHash }, chunks)).toEqual([]);
    const events = chunks.flatMap((c: { payload: string }) => parsePayload(c.payload)!.events);
    expect(events.find((e) => e.type === "witness")?.rid).toBe("r1");
    expect(events.find((e) => e.type === "video")?.sha256).toBe(clipSha);
    expect(clipSha).toBe(sha256hex("fake clip bytes"));
  });
});

describe("v4 prompts.json + ladder.json", () => {
  const schemaOf = (k: string) => prompts[k].schema;
  it("versions are 4", () => {
    expect(prompts.version).toBe(4);
    expect(catalog.version).toBe(4);
  });
  it("barAndClaims and videoReview are cloud-only functions prompts with claims (+ plan / cheating)", () => {
    for (const k of ["barAndClaims", "videoReview"]) {
      expect(prompts[k].runsIn, k).toBe("functions");
      expect(prompts[k].mode, k).toBe("ONLY_IN_CLOUD");
    }
    expect(schemaOf("barAndClaims").required).toEqual(["difficulty", "rationale", "factors", "claims", "plan"]);
    expect(schemaOf("videoReview").required).toEqual(["claims", "cheating", "summary"]);
    expect(schemaOf("videoReview").properties.claims.items.properties.verdict.enum).toEqual(["backed", "not_backed", "unclear"]);
    for (const v of ["intention", "draft", "context"]) expect(prompts.barAndClaims.user).toContain(`{{${v}}}`);
    for (const v of ["intention", "claims", "plan", "summary", "sensors", "clips"]) expect(prompts.videoReview.user).toContain(`{{${v}}}`);
    // the v3 bar prompt stays for compatibility
    expect(prompts.bar.runsIn).toBe("functions");
  });
  it("client prompts draft claims + plan; witness serves requirements; judge returns per-claim verdicts", () => {
    const claimKinds = schemaOf("structureIntention").properties.claims.items.properties.kind.enum;
    expect(claimKinds).toEqual(V4.CLAIM_KINDS);
    expect(catalog.kinds).toEqual(V4.CLAIM_KINDS);
    expect(schemaOf("structureIntention").required).toEqual(expect.arrayContaining(["claims", "plan"]));
    expect(schemaOf("interviewTurn").properties.draft.required).toEqual(expect.arrayContaining(["claims", "plan"]));
    for (const k of ["structureIntention", "barAndClaims"]) {
      const s = schemaOf(k);
      expect(s.properties.claims.maxItems, k).toBe(V4.MAX_CLAIMS);
      expect(s.properties.plan.properties.requirements.maxItems, k).toBe(V4.MAX_REQUIREMENTS);
      expect(s.properties.plan.properties.requirements.items.properties.evidence.enum, k).toEqual(["video", "frames", "gps", "motion", "witness"]);
    }
    for (const k of ["witnessDraft", "witnessRefine"]) {
      expect(prompts[k].user, k).toContain("{{plan}}");
      expect(prompts[k].user, k).toContain("{{unmet}}");
      expect(schemaOf(k).required, k).toContain("requirementId");
    }
    expect(prompts.judge.user).toContain("{{claims}}");
    expect(schemaOf("judge").required).toContain("claims");
    expect(prompts.interviewTurn.mode).toBe("PREFER_ON_DEVICE");
  });
  it("every module backs known kinds and returns per-claim verdicts", () => {
    for (const m of catalog.modules) {
      expect(Array.isArray(m.backs), m.id).toBe(true);
      expect(m.backs.length, m.id).toBeGreaterThan(0);
      for (const k of m.backs) expect(V4.CLAIM_KINDS, m.id).toContain(k);
      if (!m.available) continue;
      expect(prompts[m.prompt].user, m.id).toContain("{{claims}}");
      expect(schemaOf(m.prompt).required, m.id).toEqual(expect.arrayContaining(["passed", "confidence", "reasons", "claims"]));
    }
    const backs = Object.fromEntries(catalog.modules.map((m: any) => [m.id, m.backs]));
    expect(backs.second_look).toEqual(["action", "object", "outcome"]);
    expect(backs.place_time).toEqual(["place", "time"]);
    expect(backs.count_measure).toEqual(["count", "measure"]);
    expect(backs.full_video).toEqual(V4.CLAIM_KINDS);
  });
});
