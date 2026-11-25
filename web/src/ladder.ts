// Verification ladder (docs/ARCHITECTURE.md v3.6): the catalog, the score math and the offer list. Pure, no Firebase
// import (unit-tested). The client only PREVIEWS: runLadderModule in a Cloud Function runs a module, spends credits and
// recomputes the score; clients never write a score.

import catalog from "../../shared/ladder.json";
import type { Chunk, Intention, LadderResult, ModuleId, Verification } from "./types";

export type Need = "frames" | "gps" | "witness_answered" | "quantities" | "video";
export interface ModuleSpec {
  id: ModuleId;
  title: string;
  blurb: string;
  cost: number;
  strength: number;
  available: boolean;
  needs: Need[];
  prompt: string | null;
}

export const MODULES = catalog.modules as ModuleSpec[];
export const FREE_CREDITS = catalog.freeCredits;
export const PASS_CONFIDENCE = catalog.passConfidence;
export const moduleSpec = (id: ModuleId) => MODULES.find((m) => m.id === id) ?? null;

/** Pass `p + s(1 − p)`, fail `p(1 − s)`. No rounding: the server and the vectors don't round either. */
export const applyStep = (p: number, s: number, passed: boolean) => (passed ? p + s * (1 - p) : p * (1 - s));
export const previews = (p: number, s: number) => ({ pass: applyStep(p, s, true), fail: applyStep(p, s, false) });
/** The model's "passed" only counts with confidence >= passConfidence (code decides, not the model). */
export const countsAsPass = (passed: boolean, confidence: number) => passed && confidence >= PASS_CONFIDENCE;
export const replay = (baseline: number, steps: { strength: number; passed: boolean }[]) =>
  steps.reduce((p, s) => applyStep(p, s.strength, s.passed), baseline);

/** What the chain and the intention hold, for each module's `needs`. */
export interface Evidence {
  frames: number;
  gps: number;
  witnessAnswered: number;
  quantities: number;
  /** sha256 of every chained `video` event, in order. */
  videos: string[];
}

export function evidenceOf(chunks: Chunk[], intention: Intention | null | undefined): Evidence {
  const ev: Evidence = { frames: 0, gps: 0, witnessAnswered: 0, quantities: intention?.quantities?.length ?? 0, videos: [] };
  for (const c of chunks) {
    let p: { gps?: unknown[]; events?: { type: string; sha256?: unknown }[]; frameSha?: unknown };
    try {
      p = JSON.parse(c.payload);
    } catch {
      continue;
    }
    if (p.frameSha) ev.frames++;
    ev.gps += p.gps?.length ?? 0;
    for (const e of p.events ?? []) {
      if (e.type === "witness_answer") ev.witnessAnswered++;
      if (e.type === "video" && typeof e.sha256 === "string") ev.videos.push(e.sha256);
    }
  }
  return ev;
}

const NEED_TEXT: Record<Need, string> = {
  frames: "Needs at least one proof shot.",
  gps: "Needs GPS in the recording.",
  witness_answered: "Needs at least one answered witness request.",
  quantities: "Needs a number in the claim (like 6 lb or 10 km).",
  video: "Needs a video clip recorded in this Moment.",
};

export function unmetNeed(m: ModuleSpec, ev: Evidence): string | null {
  for (const n of m.needs) {
    const ok =
      n === "frames" ? ev.frames > 0 : n === "gps" ? ev.gps > 0 : n === "witness_answered" ? ev.witnessAnswered > 0 : n === "quantities" ? ev.quantities > 0 : ev.videos.length > 0;
    if (!ok) return NEED_TEXT[n];
  }
  return null;
}

export type Offer =
  | { module: ModuleSpec; state: "done"; result: LadderResult }
  | { module: ModuleSpec; state: "ready"; pass: number; fail: number }
  | { module: ModuleSpec; state: "blocked"; reason: string; pass: number; fail: number }
  | { module: ModuleSpec; state: "soon" };

/** The owner's offer list: every module, already run / ready (with both previews) / blocked (with why) / coming soon. */
export function offers(v: Pick<Verification, "score" | "modules">, ev: Evidence, balance: number | null): Offer[] {
  const p = v.score ?? 0;
  return MODULES.map((m): Offer => {
    const result = v.modules.find((r) => r.module === m.id);
    if (result) return { module: m, state: "done", result };
    if (!m.available) return { module: m, state: "soon" };
    const pv = previews(p, m.strength);
    const need = unmetNeed(m, ev);
    if (need) return { module: m, state: "blocked", reason: need, ...pv };
    if (balance != null && balance < m.cost) return { module: m, state: "blocked", reason: `Needs ${m.cost} credits; you have ${balance}.`, ...pv };
    return { module: m, state: "ready", ...pv };
  });
}

/** Human text for runLadderModule's `details.reason` (v3.7 error table). */
export function reasonText(reason: string | undefined, details?: { balance?: number; cost?: number }): string {
  switch (reason) {
    case "sign_in":
      return "Sign in to run checks.";
    case "insufficient_credits":
      return `Not enough credits${details?.cost != null ? `: this check costs ${details.cost}, you have ${details.balance ?? 0}` : ""}.`;
    case "already_run":
      return "This check already ran on this Moment.";
    case "not_owner":
      return "Only the person who recorded this Moment can run checks on it.";
    case "not_sealed_yet":
      return "The seal hasn't been written yet. Try again in a moment.";
    case "not_eligible":
      return "Checks run only on Moments that passed the integrity and AI checks.";
    case "unavailable_module":
      return "This check isn't available yet.";
    case "needs_frames":
    case "needs_gps":
    case "needs_witness_answered":
    case "needs_quantities":
    case "needs_video":
      return NEED_TEXT[reason.slice(6) as Need];
    case "clip_missing":
      return "The clip hasn't reached the server. It uploads from the device that recorded it.";
    case "clip_hash_mismatch":
      return "The uploaded clip doesn't match the fingerprint in the chain. No credits were spent.";
    case "model_failed":
      return "The check couldn't run right now. Your credits were refunded.";
    case "moment_missing":
      return "This Moment no longer exists.";
    default:
      return "The check couldn't run. Try again.";
  }
}

export const fmtScore = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(2));
