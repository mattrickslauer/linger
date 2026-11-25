// Pure helpers for the voice interview -> structured intention (docs/ARCHITECTURE.md v3.2) and the bar mapping
// (v3.3). No Firebase import, so everything here unit-tests in Node against shared/test-vectors-v3.json.

import { CATEGORIES, type Category, type Intention, type InterviewMode, type MeasuredBy, type Quantity } from "./types";
import { normalizeClaimsAndPlan } from "./v4";

export const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
export const round2 = (x: number) => Math.round(x * 100) / 100;
/** The contract's bar mapping; the server uses the same formula for the binding bar. */
export const barFromDifficulty = (d: number) => round2(0.5 + 0.45 * clamp01(d));

export interface Turn {
  who: "me" | "ai";
  text: string;
  mode?: "on_device" | "cloud" | "none";
}

export const transcriptText = (turns: Turn[]) => turns.map((t) => `${t.who}: ${t.text}`).join("\n");

/** "start", "go", "let's go" end the interview at once (contract v3.2 step 2). */
export const wantsToStart = (said: string) => /^\s*(ok(ay)?[, ]+)?(start|go|let'?s go|start (it|now|recording)|begin)[.!\s]*$/i.test(said);

export interface InterviewContext {
  lat: number | null;
  lng: number | null;
  place: string | null;
  localTime: string;
  month: number;
  hemisphere: "N" | "S" | null;
  platform: "web";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** "2026-11-25T06:42 Wed" in the device's local time. */
export function localTimeString(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())} ${DAYS[d.getDay()]}`;
}
export function buildContext(pos: { lat: number; lng: number } | null, now = new Date()): InterviewContext {
  return {
    lat: pos ? round4(pos.lat) : null,
    lng: pos ? round4(pos.lng) : null,
    place: null, // the web has no reverse geocoder; the model may name the place from coordinates
    localTime: localTimeString(now),
    month: now.getMonth() + 1,
    hemisphere: pos ? (pos.lat >= 0 ? "N" : "S") : null,
    platform: "web",
  };
}
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

const MEASURED: MeasuredBy[] = ["scale", "ruler", "photo", "count", "gps", "motion", "claim"];
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const orNull = (v: unknown, max: number): string | null => str(v, max) || null;
const strList = (v: unknown, n: number, max = 60): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(x, max))
    .filter(Boolean)
    .slice(0, n);

/** Model output (on-device draft or cloud structuring) -> the contract's `Quantity[]`, dropping unknowns. */
export function normalizeQuantities(v: unknown): Quantity[] {
  if (!Array.isArray(v)) return [];
  const out: Quantity[] = [];
  for (const q of v) {
    const o = (q ?? {}) as Record<string, unknown>;
    const value = Number(o.value);
    const metric = str(o.metric, 30);
    if (!metric || !Number.isFinite(value) || value === 0) continue; // 0 = "unknown" in the prompt
    const mb = str(o.measuredBy, 10) as MeasuredBy;
    out.push({ metric, value, unit: str(o.unit, 16), measuredBy: MEASURED.includes(mb) ? mb : "claim" });
    if (out.length === 5) break;
  }
  return out;
}

/** Keyword fallback when no model answered at all (sample-data build, offline without Nano). */
export function guessCategory(text: string): Category {
  const t = text.toLowerCase();
  if (/fish|bass|trout|salmon|pike|carp|angl|catch/.test(t)) return "fishing";
  if (/run|jog|km\b|mile|rep|push.?up|squat|gym|swim|bike|cycl|workout|plank/.test(t)) return "fitness";
  if (/hike|climb|summit|peak|trail|camp|ski|surf|kayak|mountain/.test(t)) return "outdoors";
  if (/bake|build|make|cook|paint|knit|carve|turn|craft|sew|brew/.test(t)) return "making";
  return "other";
}

export interface NormalizeOpts {
  pos: { lat: number; lng: number } | null;
  start: number;
  turns: number;
  mode: InterviewMode;
  preview?: Intention["preview"];
  fallbackText?: string;
}

/**
 * Model JSON -> `intention` v3. lat/lng come from GPS, never from the model; "" from the model becomes null;
 * every string and list is clamped to the contract's limits.
 */
export function normalizeIntention(raw: Record<string, unknown>, o: NormalizeOpts): Intention {
  const cat = str(raw.category, 12) as Category;
  const text = str(raw.text, 200) || str(raw.goal, 200) || (o.fallbackText ?? "").slice(0, 200);
  const place = (raw.place ?? {}) as Record<string, unknown>;
  const name = orNull(place.name, 80);
  const region = orNull(place.region, 60);
  const country = orNull(place.country, 60);
  const mins = Number(raw.expectedMinutes);
  const { claims, plan } = normalizeClaimsAndPlan(raw.claims, raw.plan);
  return {
    text,
    category: CATEGORIES.includes(cat) ? cat : guessCategory(text),
    v: 4,
    activity: str(raw.activity, 40) || undefined,
    goal: str(raw.goal, 120) || undefined,
    quantities: normalizeQuantities(raw.quantities),
    place: name || region || country || o.pos ? { name, lat: o.pos?.lat ?? null, lng: o.pos?.lng ?? null, region, country } : null,
    window: { start: o.start, expectedMinutes: Number.isFinite(mins) && mins > 0 ? Math.round(mins) : null },
    conditions: strList(raw.conditions, 6),
    assumptions: strList(raw.assumptions, 6, 120),
    interview: { turns: o.turns, mode: o.mode },
    preview: o.preview ?? null,
    claims,
    plan,
  };
}

/**
 * Typed path (v4.1): attach the cloud's claims + plan for the typed sentence, keeping exactly what the person typed
 * and picked. Returns the v1 intention unchanged when the model gave no usable claims.
 */
export function withDraftClaims(i: Intention, raw: Record<string, unknown>): Intention {
  const { claims, plan } = normalizeClaimsAndPlan(raw.claims, raw.plan);
  if (!claims.length) return i;
  return { ...i, v: 4, claims, plan };
}

/** Which side ran the interview: every model turn plus the structuring call. */
export function interviewMode(modes: ("on_device" | "cloud" | "none" | undefined)[]): InterviewMode {
  const used = new Set(modes.filter((m): m is "on_device" | "cloud" => m === "on_device" || m === "cloud"));
  if (used.size === 0) return "typed";
  if (used.size === 2) return "mixed";
  return used.has("cloud") ? "cloud" : "on_device";
}

/** Strip undefined keys: Firestore rejects them and the journal does not need them. */
export function compactIntention(i: Intention): Intention {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(i)) if (v !== undefined) out[k] = v;
  return out as unknown as Intention;
}
