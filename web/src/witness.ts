// Witness agent: pure pacing rules and chain events (docs/ARCHITECTURE.md v3.4). No Firebase import (unit-tested).
// Events go into payload.events, so they are hashed with the chunk; key order is the contract's, so a payload
// rebuilt from these builders is byte-identical to shared/test-vectors-v3.json.

import type { AppEvent } from "./types";

export const PACE = { firstAfterMs: 30_000, gapMs: 60_000, max: 6, minGain: 0.1 } as const;

export type WitnessKind = "show" | "tell" | "do";
export type WitnessBy = "on_device" | "cloud";
export type AnswerVia = "frame" | "voice" | "text" | "done";

export interface WitnessRequest {
  wid: string;
  ask: string;
  kind: WitnessKind;
  why: string;
  by: WitnessBy;
  at: number;
  outcome?: "answered" | "skipped";
  via?: AnswerVia;
  text?: string;
  closedAt?: number;
}

export interface WitnessLog {
  requests: WitnessRequest[];
}

export const openRequest = (w: WitnessLog) => w.requests.find((r) => !r.outcome) ?? null;

/** First request 30 s after start, one open at a time, 60 s apart, at most 6 per Moment. */
export function canAsk(now: number, startedAt: number, w: WitnessLog): boolean {
  if (now - startedAt < PACE.firstAfterMs) return false;
  if (openRequest(w)) return false;
  if (w.requests.length >= PACE.max) return false;
  const last = w.requests[w.requests.length - 1];
  return !last || now - last.at >= PACE.gapMs;
}

/** Only real asks that would move the score. */
export const worthAsking = (a: { ask: string; gain: number }) => a.ask.trim() !== "" && a.gain >= PACE.minGain;

export const nextWid = (w: WitnessLog) => "w" + (w.requests.length + 1);

// ---------------------------------------------------------------- chain events (contract key order)

export const witnessEvent = (t: number, wid: string, ask: string, kind: WitnessKind, by: WitnessBy): AppEvent => ({ t, type: "witness", wid, ask, kind, by });
export const frameEvent = (t: number, wid?: string): AppEvent => (wid ? { t, type: "frame", wid } : { t, type: "frame" });
export const answerEvent = (t: number, wid: string, via: AnswerVia, text?: string): AppEvent =>
  text != null && text !== "" ? { t, type: "witness_answer", wid, via, text: text.slice(0, 200) } : { t, type: "witness_answer", wid, via };
export const skipEvent = (t: number, wid: string, reason?: string): AppEvent => (reason ? { t, type: "witness_skip", wid, reason } : { t, type: "witness_skip", wid });

/** `witness` written on the Moment at submit (informational; the server recounts from the chain). */
export function witnessSummary(w: WitnessLog): { asked: number; answered: number; skipped: number; mode: "on_device" | "cloud" | "mixed" | "none" } {
  const by = new Set(w.requests.map((r) => r.by));
  return {
    asked: w.requests.length,
    answered: w.requests.filter((r) => r.outcome === "answered").length,
    skipped: w.requests.filter((r) => r.outcome === "skipped").length,
    mode: by.size === 0 ? "none" : by.size === 2 ? "mixed" : by.has("cloud") ? "cloud" : "on_device",
  };
}

/** `{{asked}}` for the prompts: previous asks with what happened. */
export const askedText = (w: WitnessLog) =>
  w.requests.length
    ? w.requests.map((r) => `${r.wid}: "${r.ask}" (${r.kind}) -> ${r.outcome ? `${r.outcome}${r.via ? " via " + r.via : ""}${r.text ? `: "${r.text}"` : ""}` : "open"}`).join("\n")
    : "none";

/** `{{session}}` for the prompts. */
export function sessionText(s: { elapsedMs: number; distanceM: number; labels: string[]; gpsCount: number; motionOn: boolean }) {
  return [
    `elapsed ${Math.round(s.elapsedMs / 1000)} s`,
    `distance ${Math.round(s.distanceM)} m`,
    `GPS ${s.gpsCount ? "present" : "none"}`,
    `motion ${s.motionOn ? "present" : "none"}`,
    `proof frames so far: ${s.labels.length ? s.labels.map((l) => l || "unlabelled").join("; ") : "none"}`,
  ].join(", ");
}
