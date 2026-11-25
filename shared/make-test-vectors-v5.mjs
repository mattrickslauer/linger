// Regenerates shared/test-vectors-v5.json: the v5 challenge outcome (docs/ARCHITECTURE.md "v5 — crowd rebuttals").
// Run: node shared/make-test-vectors-v5.mjs
// This file is the REFERENCE implementation of the outcome rule. functions/src/challenge.ts (`challengeOutcome`) must
// reproduce `expect` for every case. AI proposes (the challengeReview answer); this code decides.
import { writeFileSync } from "node:fs";

export const HOLD_CONFIDENCE = 0.6;

/**
 * input = { rebuttals: [{id, claimId}], claims: [{id, text}],
 *           review: { rebuttals: [{id, verdict, confidence, reason}], claims: [{id, verdict, confidence}],
 *                     cheating: {detected, signals} } }
 */
export function challengeOutcome(input) {
  const holding = [];
  for (const r of input.rebuttals) {
    const v = (input.review.rebuttals ?? []).find((x) => x.id === r.id);
    if (v && v.verdict === "upheld" && typeof v.confidence === "number" && v.confidence >= HOLD_CONFIDENCE) holding.push(r);
  }
  const fallen = [];
  for (const c of input.claims) {
    if (!holding.some((r) => r.claimId === c.id)) continue;
    const v = (input.review.claims ?? []).find((x) => x.id === c.id);
    if (v && v.verdict === "not_backed" && typeof v.confidence === "number" && v.confidence >= HOLD_CONFIDENCE) fallen.push(c.id);
  }
  const cheating = input.review.cheating?.detected === true;
  const overturned = fallen.length > 0 || (cheating && holding.length > 0);
  if (!overturned) return { outcome: "survived", fallen: [], holding: holding.map((r) => r.id), reason: null };
  const firstHold = holding[0];
  const holdReason = (input.review.rebuttals.find((x) => x.id === firstHold.id)?.reason ?? "").trim();
  const signal = ((input.review.cheating?.signals ?? [])[0] ?? "").trim();
  const x = fallen.length > 0 ? input.claims.find((c) => c.id === fallen[0]).text : signal ? "cheating — " + signal : "cheating detected";
  return { outcome: "overturned", fallen, holding: holding.map((r) => r.id), reason: "Overturned by challenge: " + x + " · " + holdReason };
}

const claims = [
  { id: "c1", text: "clapping" },
  { id: "c2", text: "50 claps" },
];
const rb = (id, claimId) => ({ id, claimId });
const three = [rb("r1", "c2"), rb("r2", "c2"), rb("r3", "c1")];
const v = (id, verdict, confidence, reason = `reason ${id}`) => ({ id, verdict, confidence, reason });
const cv = (id, verdict, confidence) => ({ id, verdict, confidence, reasons: [] });
const noCheat = { detected: false, signals: [] };

const cases = [
  {
    name: "upheld rebuttal + claim not_backed → overturned",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r1", "upheld", 0.8, "count restarts at 0:41"), v("r2", "dismissed", 0.7), v("r3", "dismissed", 0.9)], claims: [cv("c1", "backed", 0.9), cv("c2", "not_backed", 0.8)], cheating: noCheat } },
  },
  {
    name: "upheld rebuttal but its claim still backed → survived",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r1", "upheld", 0.8), v("r2", "dismissed", 0.7), v("r3", "dismissed", 0.9)], claims: [cv("c1", "backed", 0.9), cv("c2", "backed", 0.7)], cheating: noCheat } },
  },
  {
    name: "upheld below 0.6 confidence does not hold → survived",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r1", "upheld", 0.59), v("r2", "upheld", 0.5), v("r3", "dismissed", 0.9)], claims: [cv("c1", "backed", 0.9), cv("c2", "not_backed", 0.9)], cheating: noCheat } },
  },
  {
    name: "claim not_backed below 0.6 does not fall → survived",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r1", "upheld", 0.9)], claims: [cv("c2", "not_backed", 0.55)], cheating: noCheat } },
  },
  {
    name: "holding rebuttal on c1, but only c2 is not_backed → survived",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r3", "upheld", 0.9)], claims: [cv("c1", "backed", 0.9), cv("c2", "not_backed", 0.9)], cheating: noCheat } },
  },
  {
    name: "cheating + one holding rebuttal → overturned, cheating reason",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r3", "upheld", 0.7, "the clip is cut at 0:41")], claims: [cv("c1", "backed", 0.9), cv("c2", "unclear", 0.5)], cheating: { detected: true, signals: ["cut: a jump at 0:41"] } } },
  },
  {
    name: "cheating without signals + holding → 'cheating detected'",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r2", "upheld", 0.6, "looks looped")], claims: [], cheating: { detected: true, signals: [] } } },
  },
  {
    name: "cheating but no holding rebuttal → survived",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r1", "dismissed", 0.9), v("r2", "unclear", 0.4), v("r3", "dismissed", 0.8)], claims: [cv("c2", "not_backed", 0.9)], cheating: { detected: true, signals: ["loop"] } } },
  },
  {
    name: "only unclear answers → survived",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r1", "unclear", 0.9), v("r2", "unclear", 0.9), v("r3", "unclear", 0.9)], claims: [cv("c1", "unclear", 0.9), cv("c2", "unclear", 0.9)], cheating: noCheat } },
  },
  {
    name: "two claims fall → first fallen claim in claim order, first holding rebuttal in rebuttal order",
    input: { rebuttals: three, claims, review: { rebuttals: [v("r3", "upheld", 0.9, "no hands visible"), v("r1", "upheld", 0.7, "count restarts")], claims: [cv("c2", "not_backed", 0.9), cv("c1", "not_backed", 0.9)], cheating: noCheat } },
  },
  {
    name: "review answers unknown rebuttal ids only → survived",
    input: { rebuttals: three, claims, review: { rebuttals: [v("rX", "upheld", 1)], claims: [cv("c2", "not_backed", 1)], cheating: noCheat } },
  },
];

const out = { version: 5, holdConfidence: HOLD_CONFIDENCE, outcome: cases.map((c) => ({ ...c, expect: challengeOutcome(c.input) })) };
writeFileSync(new URL("./test-vectors-v5.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.outcome.length} outcome cases`);
