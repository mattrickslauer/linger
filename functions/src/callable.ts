// Pure helpers for the v3.7 callables: request validation, eligibility and typed errors. No Firebase app needed,
// so unit tests import this without initializing anything.
import { HttpsError } from "firebase-functions/v2/https";
import type { ChainFacts, LadderResult, SealV3 } from "./ladder";
import type { Claim } from "./v4";
import type { MomentDoc } from "./seal";
import { ModuleId, getModule } from "./shared";

export interface Verification {
  version: number;
  baseline: number | null;
  score: number | null;
  bar: number;
  verified: boolean;
  modules: LadderResult[];
  pending?: Record<string, string>;
}

/** HttpsError with `details.reason`, which clients switch on (docs/ARCHITECTURE.md v3.7). */
export const fail = (code: ConstructorParameters<typeof HttpsError>[0], reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpsError(code, message, { reason, ...extra });

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * A run whose spend is older than this and still has neither a result nor a refund was lost (the function
 * instance died mid-run: runLadderModule times out at 300 s). Its marker is cleared and its credits refunded,
 * so a crash never blocks a module or keeps the credits.
 */
export const STALE_RUN_MS = 10 * 60_000;

export function isStaleRun(spentAtMs: number | null | undefined, nowMs: number, staleMs = STALE_RUN_MS): boolean {
  return typeof spentAtMs === "number" && Number.isFinite(spentAtMs) && nowMs - spentAtMs >= staleMs;
}

export interface RunRequest {
  momentId: string;
  module: ModuleId;
  requestId: string;
  clipSha?: string;
}

export function validateRunRequest(data: unknown): RunRequest {
  const d = (data ?? {}) as Record<string, unknown>;
  const okId = (s: unknown, re: RegExp) => typeof s === "string" && re.test(s);
  // requestId must be a UUID (contract: client UUID v4; any case, iOS prints upper case). A free-form id could
  // collide with the ledger's own entry ids ("grant", "<requestId>-refund") and overwrite a spend or a refund.
  if (!okId(d.momentId, /^[A-Za-z0-9_-]{1,128}$/) || !okId(d.requestId, UUID_RE)) {
    throw fail("invalid-argument", "bad_request", "momentId and requestId are required.");
  }
  if (d.clipSha != null && !okId(d.clipSha, /^[0-9a-f]{64}$/)) throw fail("invalid-argument", "bad_request", "clipSha must be a lowercase sha256 hex.");
  if (typeof d.module !== "string" || !getModule(d.module)) throw fail("invalid-argument", "bad_module", "Unknown module.");
  return { momentId: d.momentId as string, module: d.module as ModuleId, requestId: d.requestId as string, ...(d.clipSha ? { clipSha: d.clipSha as string } : {}) };
}

/**
 * v4 needs (v4.6): as v3, except `quantities` means a server claim of kind count/measure (so a typed "clap 50 times"
 * is countable). Returns `needs_<need>` for the first unmet need, or null.
 */
export function unmetNeedV4(mod: { needs: string[] }, facts: ChainFacts, claims: Claim[]): string | null {
  for (const n of mod.needs) {
    const ok =
      n === "frames" ? facts.frames.length > 0
      : n === "gps" ? facts.gps.length > 0
      : n === "witness_answered" ? facts.witness.some((w) => w.answer)
      : n === "quantities" ? claims.some((c) => c.kind === "count" || c.kind === "measure")
      : n === "video" ? facts.videos.length > 0
      : false;
    if (!ok) return `needs_${n}`;
  }
  return null;
}

/** Eligibility from the Moment alone (status, seal version, ladderEligible, already run / in flight). */
export function eligibility(m: MomentDoc, module: ModuleId, requestId: string): string | null {
  const seal = m.seal as SealV3 | null | undefined;
  if (!(m.status === "sealed" || m.status === "rejected") || !seal || !(Number(seal.version) >= 3)) return "not_sealed_yet";
  if (!seal.ladderEligible) return "not_eligible";
  const v = m.verification as Verification | undefined;
  if (v?.modules?.some((r) => r.module === module)) return "already_run";
  const pending = v?.pending?.[module];
  if (pending && pending !== requestId) return "already_run";
  return null;
}

