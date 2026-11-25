// The server-side agents (ONLY_IN_CLOUD, Cloud Functions): the bar agent (v3.3) and the ladder modules (v3.6).
// Each builds its prompt variables from data the server trusts (the hashed chain, the server-set bar, the
// client's AI opinions only as "earlier reasons"), calls Gemini through ai.ts, and coerces the answer. The model
// proposes; the callers in index.ts apply the deterministic math and write the results.
import { AiEngine, Part, asNumber, asStrings, getEngine } from "./ai";
import {
  ChainFacts,
  IntentionLike,
  Measured,
  barFromDifficulty,
  clamp01,
  countMotionReps,
  gpsAt,
  gpsDistanceM,
  localTimeLabel,
  pickFrames,
  round2,
  sunElevationDeg,
} from "./ladder";
import { Bar, DEFAULT_BAR, MomentDoc, Summary } from "./seal";
import type { ModuleId } from "./shared";
import type { Claim, VerdictForClaim } from "./v4";
import { coerceVerdicts } from "./video";
import { ServerClaims, claimsFromModel, draftOf, fakeClaimsAndPlan, fallbackClaims, intentionWithoutDraft } from "./claims";

const MAX_MODULE_FRAMES = 8;

/** The intention as the server shows it to a model: the client's bar preview is dropped (it must not anchor). */
export function intentionForModel(intention: unknown): IntentionLike {
  if (!intention || typeof intention !== "object") return { text: "", category: "other" };
  const { preview: _preview, ...rest } = intention as Record<string, unknown>;
  return rest as IntentionLike;
}

export function defaultBar(now = Date.now()): Bar {
  return { value: DEFAULT_BAR, difficulty: 0, rationale: "Standard bar", factors: [], source: "default", model: null, ranAt: now };
}

/** Context for the bar: place from the recorded GPS (never from the model), local date and time. */
export function barContext(m: Pick<MomentDoc, "startedAt" | "summary"> & { intention?: unknown }): Record<string, unknown> {
  const start = (m.summary as Partial<Summary> | null | undefined)?.start ?? null;
  const place = (m.intention as { place?: { name?: string | null; region?: string | null; country?: string | null } } | undefined)?.place;
  const lat = start?.lat ?? null;
  const lng = start?.lng ?? null;
  const d = new Date(m.startedAt + (lng == null ? 0 : Math.round(lng / 15) * 3_600_000));
  return {
    lat,
    lng,
    place: place?.name ?? null,
    region: place?.region ?? null,
    country: place?.country ?? null,
    localTime: typeof m.startedAt === "number" ? localTimeLabel(m.startedAt, lng) : null,
    month: typeof m.startedAt === "number" ? d.getUTCMonth() + 1 : null,
    hemisphere: lat == null ? null : lat >= 0 ? "N" : "S",
  };
}

/** Deterministic stand-in used by the fake engine: ordinary claims are easy, numbers and records raise it. */
export function fakeDifficulty(intention: IntentionLike): number {
  const base: Record<string, number> = { fishing: 0.2, fitness: 0.2, outdoors: 0.1, making: 0.1, other: 0.1 };
  let d = base[String(intention.category)] ?? 0.1;
  d += 0.1 * Math.min(3, intention.quantities?.length ?? 0);
  if (/record|trophy|personal best|\bpb\b/i.test(String(intention.text ?? ""))) d += 0.3;
  return round2(Math.min(1, d));
}

/** v3.3 bar agent. Never throws: any failure gives the default bar (0.5, seal v2 behaviour). */
export async function computeBar(m: MomentDoc, engine: AiEngine = getEngine(), now = Date.now()): Promise<Bar> {
  const intention = intentionForModel(m.intention);
  try {
    const { data, model } = await engine.generateJson({
      prompt: "bar",
      vars: { intention: JSON.stringify(intention), context: JSON.stringify(barContext(m)) },
      fake: () => ({
        difficulty: fakeDifficulty(intention),
        rationale: "Emulator bar: set from the category and the claimed numbers.",
        factors: [String(intention.category ?? "other")],
      }),
    });
    const raw = asNumber(data.difficulty, NaN);
    if (!Number.isFinite(raw)) throw new Error("no difficulty");
    const difficulty = round2(clamp01(raw));
    return {
      value: barFromDifficulty(difficulty),
      difficulty,
      rationale: (typeof data.rationale === "string" && data.rationale.trim() ? data.rationale.trim() : "Set from the claim").slice(0, 160),
      factors: asStrings(data.factors, 4, 60),
      source: "ai",
      model,
      ranAt: now,
    };
  } catch {
    return defaultBar(now);
  }
}

// ───────────────────────────────── v4.3 bar + claims + plan (one ONLY_IN_CLOUD call)

export interface BarAndClaims extends ServerClaims {
  bar: Bar;
  /** true when the model answered (bar from the model); false when everything came from the fallbacks. */
  fromModel: boolean;
}

/**
 * v4.3 `barAndClaims`: difficulty → bar (code maps it), the authoritative claims and the evidence plan, in one call.
 * The client's claims/plan are hints (`{{draft}}`). Never throws: any failure gives the v3 default bar, the client's
 * claims (or one outcome claim) and the client's plan with the server's default requirements.
 */
export async function computeBarAndClaims(m: MomentDoc, engine: AiEngine = getEngine(), now = Date.now()): Promise<BarAndClaims> {
  const intention = intentionWithoutDraft(intentionForModel(m.intention));
  const draft = draftOf(m.intention);
  const fallback = fallbackClaims(m.intention, now);
  try {
    const { data, model } = await engine.generateJson({
      prompt: "barAndClaims",
      vars: { intention: JSON.stringify(intention), draft: JSON.stringify(draft), context: JSON.stringify(barContext(m)) },
      fake: () => {
        const fromDraft = draft.claims.length > 0 ? { claims: draft.claims, plan: draft.plan ?? { requirements: [], recordMode: "photo", note: "" } } : fakeClaimsAndPlan(intention);
        const counted = (fromDraft.claims as Array<{ kind?: string }>).filter((c) => c.kind === "count" || c.kind === "measure").length;
        return {
          difficulty: round2(Math.min(1, fakeDifficulty(intention as IntentionLike) + (intention.quantities ? 0 : 0.1 * Math.min(3, counted)))),
          rationale: "Emulator bar: set from the category and the claimed numbers.",
          factors: [String(intention.category ?? "other")],
          ...fromDraft,
        };
      },
    });
    const raw = asNumber(data.difficulty, NaN);
    if (!Number.isFinite(raw)) throw new Error("no difficulty");
    const difficulty = round2(clamp01(raw));
    const bar: Bar = {
      value: barFromDifficulty(difficulty),
      difficulty,
      rationale: (typeof data.rationale === "string" && data.rationale.trim() ? data.rationale.trim() : "Set from the claim").slice(0, 160),
      factors: asStrings(data.factors, 4, 60),
      source: "ai",
      model,
      ranAt: now,
    };
    const fromModel = claimsFromModel(data, model, now) ?? fallback;
    return { bar, ...fromModel, fromModel: true };
  } catch {
    return { bar: defaultBar(now), ...fallback, fromModel: false };
  }
}

// ───────────────────────────────── ladder modules

export interface ModuleContext {
  momentId: string;
  moment: MomentDoc;
  facts: ChainFacts;
  /** full_video only: the uploaded clip, already re-hashed against the chain. */
  clip?: { gsUri: string; mimeType: string; sha256: string; bytes: number; durationMs: number | null };
  /** v4: the server claims this module backs (`{{claims}}`); empty for v3 Moments. */
  claims?: Claim[];
}

export interface ModuleAnswer {
  passed: boolean;
  confidence: number;
  reasons: string[];
  measured?: Measured[];
  /** v4: per-claim verdicts, coerced to the claims the module was given. */
  claims: VerdictForClaim[];
  model: string;
}

const frameParts = (frames: ChainFacts["frames"]): Part[] => frames.map((f) => ({ inlineData: { mimeType: "image/jpeg", data: f.jpegB64 } }));
const offsetS = (facts: ChainFacts, t: number) => Math.round((t - (facts.startT ?? t)) / 1000);

function sensors(ctx: ModuleContext) {
  const reps = countMotionReps(ctx.facts.motion);
  return {
    gpsDistanceM: Math.round(gpsDistanceM(ctx.facts.gps)),
    durationS: ctx.facts.startT != null && ctx.facts.endT != null ? Math.round((ctx.facts.endT - ctx.facts.startT) / 1000) : null,
    gpsFixes: ctx.facts.gps.length,
    motionSamples: ctx.facts.motion.length,
    motionReps: reps.reps,
    cadencePerMin: reps.cadencePerMin,
    frameCount: ctx.facts.frames.length,
  };
}

export function placeTimeFacts(ctx: ModuleContext) {
  const f = ctx.facts;
  const at = (t: number | null) => {
    if (t == null) return null;
    const p = gpsAt(f.gps, t);
    return p ? { ...p, localTime: localTimeLabel(t, p.lng), sunElevationDeg: Math.round(sunElevationDeg(p.lat, p.lng, t) * 10) / 10 } : null;
  };
  return { start: at(f.startT), end: at(f.endT), distanceM: Math.round(gpsDistanceM(f.gps)), gpsFixes: f.gps.length };
}

interface Built {
  vars: Record<string, string>;
  media: Part[];
  fake: () => Record<string, unknown>;
}

/** The fake engine's per-claim verdicts: every claim the module was given gets the module's overall verdict. */
function withClaims(ctx: ModuleContext, fake: () => Record<string, unknown>): () => Record<string, unknown> {
  return () => {
    const a = fake();
    const ok = a.passed === true;
    return { ...a, claims: (ctx.claims ?? []).map((c) => ({ id: c.id, verdict: ok ? "backed" : "not_backed", confidence: 0.8, reasons: [String((a.reasons as string[])[0] ?? "")] })) };
  };
}

function build(module: ModuleId, ctx: ModuleContext): Built {
  const b = buildV3(module, ctx);
  return { vars: { ...b.vars, claims: JSON.stringify(ctx.claims ?? []) }, media: b.media, fake: withClaims(ctx, b.fake) };
}

function buildV3(module: ModuleId, ctx: ModuleContext): Built {
  const { moment: m, facts } = ctx;
  const intention = JSON.stringify(intentionForModel(m.intention));
  const summary = JSON.stringify(m.summary ?? {});
  const frames = pickFrames(facts.frames, MAX_MODULE_FRAMES);
  const offsets = frames.map((fr) => offsetS(facts, fr.t)).join(", ");
  const baseline = typeof m.score?.probability === "number" ? m.score.probability : 0;
  const judgeOk = m.judge?.verdict === "consistent" && m.skeptic?.verdict !== "inconsistent";
  switch (module) {
    case "second_look":
      return {
        vars: {
          intention,
          summary,
          earlier: JSON.stringify({ judge: m.judge?.reasons ?? [], skeptic: m.skeptic?.reasons ?? [], scorer: m.score?.reasons ?? [] }),
          frameOffsets: offsets,
        },
        media: frameParts(frames),
        fake: () => ({
          passed: judgeOk && baseline >= 0.6,
          confidence: 0.8,
          reasons: [judgeOk && baseline >= 0.6 ? "Emulator: frames hold up under a second look" : "Emulator: evidence too thin for a second look"],
        }),
      };
    case "place_time": {
      const pt = placeTimeFacts(ctx);
      const withSun = frames.map((fr) => {
        const p = gpsAt(facts.gps, fr.t);
        return `${offsetS(facts, fr.t)}s (sun ${p ? Math.round(sunElevationDeg(p.lat, p.lng, fr.t)) : "?"}°)`;
      });
      return {
        vars: { intention, facts: JSON.stringify(pt), frameOffsets: withSun.join(", ") },
        media: frameParts(frames),
        fake: () => ({ passed: facts.gps.length > 0, confidence: 0.75, reasons: ["Emulator: GPS and clock are consistent with the frames"] }),
      };
    }
    case "witness_review": {
      const witness = facts.witness.map((w) => ({
        wid: w.wid,
        atS: offsetS(facts, w.t),
        ask: w.ask,
        kind: w.kind,
        by: w.by,
        answer: w.answer ? { via: w.answer.via, afterS: Math.round((w.answer.t - w.t) / 1000), ...(w.answer.text ? { text: w.answer.text } : {}) } : null,
        skipped: w.skip ? (w.skip.reason ?? "skipped") : null,
      }));
      const answerFrames = pickFrames(
        facts.frames.filter((fr) => fr.wid && facts.witness.some((w) => w.wid === fr.wid)),
        MAX_MODULE_FRAMES,
      );
      const answered = facts.witness.filter((w) => w.answer).length;
      return {
        vars: { intention, witness: JSON.stringify(witness), frameOffsets: answerFrames.map((fr) => `${fr.wid} at ${offsetS(facts, fr.t)}s`).join(", ") },
        media: frameParts(answerFrames),
        fake: () => ({
          passed: answered > 0 && answered >= facts.witness.length - 1,
          confidence: 0.8,
          reasons: [`Emulator: ${answered} of ${facts.witness.length} witness requests answered`],
        }),
      };
    }
    case "count_measure": {
      const s = sensors(ctx);
      // v4: the server's count/measure claims are the quantities (a typed "clap 50 times" has no intention.quantities).
      const fromClaims = (ctx.claims ?? []).filter((c) => c.kind === "count" || c.kind === "measure").map((c) => ({ metric: c.metric ?? c.text, value: c.value ?? 0, unit: c.unit ?? "" }));
      const quantities = intentionForModel(m.intention).quantities?.length ? intentionForModel(m.intention).quantities! : fromClaims;
      return {
        vars: { intention, quantities: JSON.stringify(quantities), sensors: JSON.stringify(s), frameOffsets: offsets },
        media: frameParts(frames),
        fake: () => {
          const dist = quantities.find((q) => q.metric === "distance");
          const km = s.gpsDistanceM / 1000;
          const claimKm = dist ? (String(dist.unit).toLowerCase().startsWith("mi") ? Number(dist.value) * 1.609 : String(dist.unit).toLowerCase() === "m" ? Number(dist.value) / 1000 : Number(dist.value)) : null;
          const passed = claimKm == null || km >= claimKm * 0.95;
          return {
            passed,
            confidence: 0.8,
            reasons: [claimKm == null ? "Emulator: claimed numbers are plausible from the frames" : `Emulator: GPS measured ${km.toFixed(2)} km against ${claimKm.toFixed(2)} km claimed`],
            measured: [
              { metric: "distance", value: Math.round(km * 100) / 100, unit: "km" },
              { metric: "reps", value: s.motionReps, unit: "count" },
            ],
          };
        },
      };
    }
    case "full_video": {
      if (!ctx.clip) throw new Error("full_video needs the clip");
      const c = ctx.clip;
      const few = pickFrames(facts.frames, 4);
      return {
        vars: {
          intention,
          summary,
          clip: JSON.stringify({ sha256: c.sha256, bytes: c.bytes, durationMs: c.durationMs, hashMatchesChain: true }),
          frameOffsets: few.map((fr) => offsetS(facts, fr.t)).join(", "),
        },
        media: [{ fileData: { fileUri: c.gsUri, mimeType: c.mimeType } }, ...frameParts(few)],
        fake: () => ({ passed: judgeOk, confidence: 0.8, reasons: ["Emulator: the clip matches the chained hash and shows the activity"] }),
      };
    }
    default:
      throw new Error(`module ${module} has no runner`);
  }
}

const PROMPT_OF: Record<string, string> = {
  second_look: "moduleSecondLook",
  place_time: "modulePlaceTime",
  witness_review: "moduleWitnessReview",
  count_measure: "moduleCountMeasure",
  full_video: "moduleFullVideo",
};

/** Runs one ladder module's model call. Throws on model failure (the caller refunds). */
export async function runModule(module: ModuleId, ctx: ModuleContext, engine: AiEngine = getEngine()): Promise<ModuleAnswer> {
  const prompt = PROMPT_OF[module];
  if (!prompt) throw new Error(`module ${module} has no prompt`);
  const b = build(module, ctx);
  const { data, model } = await engine.generateJson({ prompt, vars: b.vars, media: b.media, fake: b.fake });
  if (typeof data.passed !== "boolean") throw new Error("model answer has no boolean `passed`");
  const out: ModuleAnswer = {
    passed: data.passed,
    confidence: round2(clamp01(asNumber(data.confidence, 0))),
    reasons: asStrings(data.reasons, 4),
    claims: coerceVerdicts(data.claims, (ctx.claims ?? []).map((c) => c.id)),
    model,
  };
  if (module === "count_measure" && Array.isArray(data.measured)) {
    out.measured = (data.measured as unknown[])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({ metric: String(x.metric ?? "").slice(0, 40), value: asNumber(x.value, NaN), unit: String(x.unit ?? "").slice(0, 20) }))
      .filter((x) => x.metric && Number.isFinite(x.value))
      .slice(0, 5);
  }
  return out;
}
