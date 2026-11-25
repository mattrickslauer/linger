// v4.1 claims + v4.2 evidence plan: normalization (client and server alike), the server's default requirements and
// the deterministic stand-in the fake AI engine uses for `barAndClaims`. Pure: no Firebase imports.
// Contract: docs/ARCHITECTURE.md v4.1 - v4.3.
import {
  CLAIM_KINDS,
  Claim,
  ClaimKind,
  ClaimsSource,
  Evidence,
  MAX_CLAIMS,
  MAX_REQUIREMENTS,
  Plan,
  Requirement,
} from "./v4";

export const EVIDENCE: Evidence[] = ["video", "frames", "gps", "motion", "witness"];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface NormalizedClaims {
  claims: Claim[];
  /** Old id (as the model or client wrote it) → new id c1..cN; used to remap the plan's claimIds. */
  idMap: Map<string, string>;
}

/**
 * v4.1: trim, cut text to 80, drop unknown kinds and empty texts, keep the first 5, renumber c1..cN in order, keep
 * metric/value/unit only on count/measure claims with value > 0.
 */
export function normalizeClaims(raw: unknown): NormalizedClaims {
  const claims: Claim[] = [];
  const idMap = new Map<string, string>();
  if (!Array.isArray(raw)) return { claims, idMap };
  for (const x of raw) {
    if (claims.length >= MAX_CLAIMS) break;
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const kind = str(o.kind) as ClaimKind;
    const text = str(o.text).slice(0, 80).trim();
    if (!CLAIM_KINDS.includes(kind) || !text) continue;
    const id = `c${claims.length + 1}`;
    const c: Claim = { id, kind, text };
    const value = finite(o.value);
    if ((kind === "count" || kind === "measure") && value != null && value > 0) {
      c.metric = str(o.metric).slice(0, 40);
      c.value = value;
      c.unit = str(o.unit).slice(0, 20);
    }
    const old = str(o.id);
    if (old && !idMap.has(old)) idMap.set(old, id);
    claims.push(c);
  }
  return { claims, idMap };
}

/** Default `ask` for a requirement the server adds (v4.2). */
export function defaultRequirement(c: Claim): Omit<Requirement, "id"> {
  if (c.kind === "count" || c.kind === "action") return { claimId: c.id, evidence: "video", ask: `A continuous video showing ${c.text}`.slice(0, 120) };
  if (c.kind === "place" || c.kind === "time") return { claimId: c.id, evidence: "gps", ask: "Keep location on during the session" };
  return { claimId: c.id, evidence: "frames", ask: `A clear proof shot of ${c.text}`.slice(0, 120) };
}

/**
 * v4.2: drop requirements whose claimId is unknown (after the claims' renumbering) or whose evidence is invalid, keep
 * the first 6, renumber r1..rN, omit minSeconds when ≤ 0 or not video/motion, recordMode = video iff any video
 * requirement. `addDefaults` (server only): every claim without a requirement gets the default one while < 6.
 */
export function normalizePlan(raw: unknown, claims: Claim[], idMap: Map<string, string> | null, addDefaults: boolean): Plan {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const known = new Set(claims.map((c) => c.id));
  const reqs: Requirement[] = [];
  for (const x of Array.isArray(o.requirements) ? o.requirements : []) {
    if (reqs.length >= MAX_REQUIREMENTS) break;
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const rawId = str(r.claimId);
    const claimId = idMap ? (idMap.get(rawId) ?? "") : rawId;
    const evidence = str(r.evidence) as Evidence;
    if (!known.has(claimId) || !EVIDENCE.includes(evidence)) continue;
    const claim = claims.find((c) => c.id === claimId)!;
    const ask = str(r.ask).slice(0, 120).trim() || defaultRequirementAsk(claim, evidence);
    const req: Requirement = { id: `r${reqs.length + 1}`, claimId, evidence, ask };
    const min = finite(r.minSeconds);
    if ((evidence === "video" || evidence === "motion") && min != null && min > 0) req.minSeconds = min;
    reqs.push(req);
  }
  if (addDefaults) {
    for (const c of claims) {
      if (reqs.length >= MAX_REQUIREMENTS) break;
      if (reqs.some((r) => r.claimId === c.id)) continue;
      reqs.push({ id: `r${reqs.length + 1}`, ...defaultRequirement(c) });
    }
  }
  return { requirements: reqs, recordMode: reqs.some((r) => r.evidence === "video") ? "video" : "photo", note: str(o.note).slice(0, 160) };
}

function defaultRequirementAsk(c: Claim, evidence: Evidence): string {
  switch (evidence) {
    case "video":
      return `A continuous video showing ${c.text}`.slice(0, 120);
    case "frames":
      return `A clear proof shot of ${c.text}`.slice(0, 120);
    case "gps":
      return "Keep location on during the session";
    case "motion":
      return "Keep the phone on you the whole time";
    default:
      return `Answer the witness about ${c.text}`.slice(0, 120);
  }
}

/** Does every claim have at least one requirement in this plan? */
export function planCovers(plan: Plan, claims: Claim[]): boolean {
  return claims.every((c) => plan.requirements.some((r) => r.claimId === c.id));
}

export interface ServerClaims {
  claims: { items: Claim[]; source: ClaimsSource; model: string | null; ranAt: number };
  plan: Plan & { source: ClaimsSource };
}

/** The intention text the fallback claim uses: goal, else text, cut to 80. */
function fallbackText(intention: Record<string, unknown>): string {
  return (str(intention.goal) || str(intention.text) || "the moment").slice(0, 80).trim();
}

/**
 * v4.3 model-failure fallback (and the base the model result is checked against): claims = normalized
 * intention.claims (source client) or one outcome claim (source default); plan = the normalized client plan with the
 * server defaults appended (source client when the client plan had any requirement, else default).
 */
export function fallbackClaims(intention: unknown, now: number): ServerClaims {
  const i = intention && typeof intention === "object" ? (intention as Record<string, unknown>) : {};
  const n = normalizeClaims(i.claims);
  if (n.claims.length > 0) {
    const plan = normalizePlan(i.plan, n.claims, n.idMap, true);
    const clientPlan = normalizePlan(i.plan, n.claims, n.idMap, false);
    return {
      claims: { items: n.claims, source: "client", model: null, ranAt: now },
      plan: { ...plan, source: clientPlan.requirements.length > 0 ? "client" : "default" },
    };
  }
  const claims: Claim[] = [{ id: "c1", kind: "outcome", text: fallbackText(i) }];
  return { claims: { items: claims, source: "default", model: null, ranAt: now }, plan: { ...normalizePlan(null, claims, null, true), source: "default" } };
}

/** Normalizes a barAndClaims model answer; null when it has no usable claim (the caller falls back). */
export function claimsFromModel(data: Record<string, unknown>, model: string, now: number): ServerClaims | null {
  const n = normalizeClaims(data.claims);
  if (n.claims.length === 0) return null;
  const plan = normalizePlan(data.plan, n.claims, n.idMap, true);
  return { claims: { items: n.claims, source: "ai", model, ranAt: now }, plan: { ...plan, source: "ai" } };
}

/** The intention as `barAndClaims` sees it in `{{intention}}`: without claims, plan and the client's bar preview. */
export function intentionWithoutDraft(intention: unknown): Record<string, unknown> {
  if (!intention || typeof intention !== "object") return { text: "", category: "other" };
  const { claims: _c, plan: _p, preview: _pr, ...rest } = intention as Record<string, unknown>;
  return rest;
}

/** `{{draft}}` for barAndClaims: {"claims": intention.claims ?? [], "plan": intention.plan ?? null}. */
export function draftOf(intention: unknown): { claims: unknown[]; plan: unknown } {
  const i = intention && typeof intention === "object" ? (intention as Record<string, unknown>) : {};
  return { claims: Array.isArray(i.claims) ? i.claims : [], plan: i.plan ?? null };
}

// ───────────────────────────────── fake engine stand-in (emulator / tests)

const DISTANCE_UNITS: Record<string, string> = { k: "km", km: "km", kilometers: "km", kilometres: "km", mi: "mi", mile: "mi", miles: "mi", m: "m", meters: "m", metres: "m" };
const WEIGHT_UNITS: Record<string, string> = { lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", kg: "kg", g: "g", oz: "oz" };
const LENGTH_UNITS: Record<string, string> = { cm: "cm", in: "in", inch: "in", inches: "in", ft: "ft", feet: "ft" };
const TIME_UNITS: Record<string, string> = { min: "min", mins: "min", minutes: "min", minute: "min", h: "h", hours: "h", hour: "h", s: "s", sec: "s", seconds: "s" };

function gerund(verb: string): string {
  const v = verb.toLowerCase();
  if (v.endsWith("ing")) return v;
  if (/[^e]e$/.test(v)) return v.slice(0, -1) + "ing";
  if (v.length <= 4 && /[^aeiou][aeiou][bdgmnprt]$/.test(v)) return v + v.slice(-1) + "ing";
  return v + "ing";
}

/**
 * Deterministic claims + plan for the fake engine: every number becomes a count or measure claim (never invented),
 * the rest of the sentence is the action (with a number) or the outcome, "at <Capitalized Place>" becomes a place.
 * "Clap 50 times" → c1 action "clapping" (video), c2 count "50 claps" (video ≥ 20 s).
 */
export function fakeClaimsAndPlan(intention: Record<string, unknown>): { claims: Array<Record<string, unknown>>; plan: Record<string, unknown> } {
  const text = str(intention.goal) || str(intention.text);
  const claims: Array<Record<string, unknown>> = [];
  const reqs: Array<Record<string, unknown>> = [];
  let rest = text;
  let numberClaim: Record<string, unknown> | null = null;
  const num = /(\d+(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(text);
  const words = text.split(/\s+/).filter(Boolean);
  if (num) {
    const value = Number(num[1]);
    const unitWord = (num[2] ?? "").toLowerCase();
    const verb = words[0] && !/\d/.test(words[0]) ? words[0].toLowerCase() : "reps";
    if (DISTANCE_UNITS[unitWord]) numberClaim = { kind: "measure", metric: "distance", value, unit: DISTANCE_UNITS[unitWord], text: `${value} ${DISTANCE_UNITS[unitWord]}` };
    else if (WEIGHT_UNITS[unitWord]) numberClaim = { kind: "measure", metric: "weight", value, unit: WEIGHT_UNITS[unitWord], text: `at least ${value} ${WEIGHT_UNITS[unitWord]}` };
    else if (LENGTH_UNITS[unitWord]) numberClaim = { kind: "measure", metric: "length", value, unit: LENGTH_UNITS[unitWord], text: `at least ${value} ${LENGTH_UNITS[unitWord]}` };
    else if (TIME_UNITS[unitWord]) numberClaim = { kind: "measure", metric: "duration", value, unit: TIME_UNITS[unitWord], text: `${value} ${TIME_UNITS[unitWord]}` };
    else {
      const noun = !unitWord || unitWord === "times" || unitWord === "reps" ? `${verb.replace(/s$/, "")}s` : unitWord;
      numberClaim = { kind: "count", metric: noun, value, unit: noun, text: `${value} ${noun}` };
    }
    rest = (text.slice(0, num.index) + text.slice(num.index + num[0].length)).replace(/\b(a|an)\s+(?=(on|at|in|of)\b)/gi, "");
  }
  let place = str((intention.place as Record<string, unknown> | undefined)?.name);
  const at = /\s(?:at|on)\s+(?:the\s+)?([A-Z][\w']*(?:\s+[A-Z][\w']*)*)/.exec(rest);
  if (at) {
    place ||= at[1];
    rest = rest.slice(0, at.index) + rest.slice(at.index + at[0].length);
  }
  rest = rest.replace(/\s+/g, " ").trim();
  const restWords = rest.split(" ").filter(Boolean);
  const isAction = !!numberClaim && numberClaim.kind === "count";
  const mainText = isAction && restWords.length <= 2 ? gerund(restWords[0] ?? "doing it") : rest || "the moment";
  claims.push({ id: "c1", kind: isAction ? "action" : "outcome", text: mainText.slice(0, 80), metric: "", value: 0, unit: "" });
  if (numberClaim) claims.push({ id: "c2", ...numberClaim });
  if (place) claims.push({ id: `c${claims.length + 1}`, kind: "place", text: place.slice(0, 80), metric: "", value: 0, unit: "" });

  for (const c of claims) {
    const id = c.id as string;
    const t = c.text as string;
    if (c.kind === "action") reqs.push({ claimId: id, evidence: "video", ask: `Do it on camera: ${t}, start to finish`, minSeconds: 0 });
    else if (c.kind === "count") {
      reqs.push({ claimId: id, evidence: "video", ask: `One continuous video of all ${t}`, minSeconds: Math.min(120, Math.max(10, Math.round(Number(c.value) * 0.4))) });
    } else if (c.kind === "measure" && c.metric === "distance") reqs.push({ claimId: id, evidence: "gps", ask: `Keep location on for the whole ${t}`, minSeconds: 0 });
    else if (c.kind === "measure") reqs.push({ claimId: id, evidence: "frames", ask: `A clear shot of the reading: ${t}`, minSeconds: 0 });
    else if (c.kind === "place") reqs.push({ claimId: id, evidence: "gps", ask: `Keep location on at ${t}`, minSeconds: 0 });
    else reqs.push({ claimId: id, evidence: "frames", ask: `A clear proof shot of ${t}`, minSeconds: 0 });
  }
  const requirements = reqs.slice(0, MAX_REQUIREMENTS).map((r, i) => ({ ...r, id: `r${i + 1}` }) as Record<string, unknown>);
  return {
    claims,
    plan: {
      requirements,
      recordMode: requirements.some((r) => r.evidence === "video") ? "video" : "photo",
      note: "Emulator plan: capture exactly this and nothing more.",
    },
  };
}
