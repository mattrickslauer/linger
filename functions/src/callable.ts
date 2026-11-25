// Pure helpers for the v3.7 callables: request validation, eligibility and typed errors. No Firebase app needed,
// so unit tests import this without initializing anything.
import { HttpsError } from "firebase-functions/v2/https";
import type { LadderResult, SealV3 } from "./ladder";
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

export interface RunRequest {
  momentId: string;
  module: ModuleId;
  requestId: string;
  clipSha?: string;
}

export function validateRunRequest(data: unknown): RunRequest {
  const d = (data ?? {}) as Record<string, unknown>;
  const okId = (s: unknown, re: RegExp) => typeof s === "string" && re.test(s);
  if (!okId(d.momentId, /^[A-Za-z0-9_-]{1,128}$/) || !okId(d.requestId, /^[A-Za-z0-9_-]{8,128}$/)) {
    throw fail("invalid-argument", "bad_request", "momentId and requestId are required.");
  }
  if (d.clipSha != null && !okId(d.clipSha, /^[0-9a-f]{64}$/)) throw fail("invalid-argument", "bad_request", "clipSha must be a lowercase sha256 hex.");
  if (typeof d.module !== "string" || !getModule(d.module)) throw fail("invalid-argument", "bad_module", "Unknown module.");
  return { momentId: d.momentId as string, module: d.module as ModuleId, requestId: d.requestId as string, ...(d.clipSha ? { clipSha: d.clipSha as string } : {}) };
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

