// Credits and ladder runs (docs/ARCHITECTURE.md v3.6/v3.7). Everything here goes through the `getCredits` and
// `runLadderModule` callables: the ledger, the score and the seal are written only by Cloud Functions. A video clip
// for `full_video` is uploaded to Cloud Storage first (clips/{uid}/{momentId}/{sha256}.{ext}); the function re-hashes it.
//
// Sample-data builds (VITE_FIXTURES) have no backend; `?ladder=demo` simulates the server with the same math so the
// sheet can be seen and tested. It is labelled as a simulation in the UI and never runs in a configured build.

import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { getMetadata, ref, uploadBytes } from "firebase/storage";
import { bucket, clipPath } from "./upload";
import { applyFixtureLadder, applyFixtureLadderV4 } from "./data";
import { app, FIXTURES, USE_EMULATORS } from "./firebase";
import { applyStep, countsAsPass, FREE_CREDITS, moduleSpec } from "./ladder";
import type { ModuleId } from "./types";
import type { ClaimScore, ModuleClaimOutcome } from "./v4";
import { clipsOf } from "./vault";

export interface Credits {
  balance: number;
  granted: number;
  spent: number;
  justGranted: boolean;
}
export interface RunResult {
  runId: string;
  module: ModuleId;
  passed: boolean;
  confidence: number;
  before: number;
  after: number;
  score: number;
  bar: number;
  verified: boolean;
  status: "sealed" | "rejected";
  cost: number;
  balance: number;
  reasons: string[];
  measured?: { metric: string; value: number; unit: string }[];
  // v4 Moments (v4.7)
  claims?: ModuleClaimOutcome[];
  claimScores?: ClaimScore[];
  claimsBacked?: number;
}

/** A callable failed with `details.reason` from the v3.7 error table. */
export class LadderError extends Error {
  constructor(
    public reason: string,
    message: string,
    public details: { balance?: number; cost?: number } = {},
  ) {
    super(message);
  }
}

export const LADDER_DEMO = FIXTURES && typeof location !== "undefined" && new URLSearchParams(location.search).get("ladder") === "demo";

const emuHost = import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1";
let fns: Functions | null = null;
function functions(): Functions {
  if (!app) throw new LadderError("unconfigured", "Firebase is not configured");
  if (!fns) {
    fns = getFunctions(app, "us-central1");
    if (USE_EMULATORS) connectFunctionsEmulator(fns, emuHost, Number(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || 5001));
  }
  return fns;
}

function wrap(e: unknown): LadderError {
  if (e instanceof LadderError) return e;
  const err = e as { code?: string; message?: string; details?: { reason?: string; balance?: number; cost?: number } };
  const reason = err?.details?.reason ?? (err?.code === "functions/unauthenticated" ? "sign_in" : "unknown");
  return new LadderError(reason, err?.message ?? String(e), err?.details ?? {});
}

// ---------------------------------------------------------------- demo (sample data only)

const demo = { balance: FREE_CREDITS, granted: 0, spent: 0 };
const DEMO_REASONS: Record<ModuleId, string> = {
  second_look: "A stricter model re-read every frame: the same place, hands and gear appear throughout.",
  place_time: "The light in the frames matches the sun's elevation at this GPS fix and time.",
  witness_review: "Each answer frame shows what the witness asked for, taken right after the ask.",
  count_measure: "GPS distance and motion agree with the claimed numbers.",
  full_video: "The clip hash matches the chain and the whole clip shows the claim unbroken.",
  human_review: "",
};

// ---------------------------------------------------------------- API

/** Balance; the first call grants the free demo credits server-side. */
export async function getCredits(): Promise<Credits> {
  if (LADDER_DEMO) {
    const justGranted = demo.granted === 0;
    if (justGranted) demo.granted = FREE_CREDITS;
    return { ...demo, justGranted };
  }
  try {
    const r = await httpsCallable<object, Credits>(functions(), "getCredits")({});
    return r.data;
  } catch (e) {
    throw wrap(e);
  }
}

/** Uploads the chained clip from this browser's vault, if it holds it (create-only: an existing upload is fine). */
async function uploadClip(uid: string, momentId: string, sha: string, onStep: (s: string) => void): Promise<"uploaded" | "refused" | "absent"> {
  const clip = (await clipsOf(momentId)).find((c) => c.sha256 === sha);
  if (!clip) return "absent"; // maybe uploaded earlier, or recorded elsewhere: the function says clip_missing if not
  const r = ref(bucket(), clipPath(uid, momentId, sha, clip.mime));
  try {
    // v4: the clip normally went up at submit; the owner may `get` it, and a second create is refused.
    await getMetadata(r);
    return "uploaded";
  } catch {
    /* not there (or not readable): upload below */
  }
  onStep(`Uploading clip (${(clip.bytes / 1e6).toFixed(1)} MB)…`);
  try {
    await uploadBytes(r, clip.blob, { contentType: clip.mime.split(";")[0] || "video/webm" });
    return "uploaded";
  } catch (e) {
    // Rules allow create only; a second upload of the same clip is refused and the first one stands. If the server
    // then says clip_missing, the refusal was a real permissions problem (runLadderModule reports it as such).
    if ((e as { code?: string })?.code !== "storage/unauthorized") throw new LadderError("upload_failed", `Clip upload failed: ${(e as Error)?.message ?? e}`);
    return "refused";
  }
}

export async function runLadderModule(
  a: { uid: string; momentId: string; module: ModuleId; requestId: string; clipSha?: string; score: number; bar: number; /** v4: claims this module backs (demo only; the server decides) */ claimIds?: string[] },
  onStep: (s: string) => void = () => {},
): Promise<RunResult> {
  if (LADDER_DEMO) return demoRun(a, onStep);
  const upload = a.module === "full_video" && a.clipSha ? await uploadClip(a.uid, a.momentId, a.clipSha, onStep) : null;
  onStep("Running in a Cloud Function…");
  try {
    const r = await httpsCallable<object, RunResult>(functions(), "runLadderModule", { timeout: 180_000 })({
      momentId: a.momentId,
      module: a.module,
      requestId: a.requestId,
      ...(a.clipSha ? { clipSha: a.clipSha } : {}),
    });
    return r.data;
  } catch (e) {
    const le = wrap(e);
    if (le.reason === "clip_missing" && upload === "refused") throw new LadderError("clip_refused", le.message, le.details);
    throw le;
  }
}

async function demoRun(a: { momentId: string; module: ModuleId; requestId: string; score: number; bar: number; claimIds?: string[] }, onStep: (s: string) => void): Promise<RunResult> {
  const m = moduleSpec(a.module)!;
  if (demo.balance < m.cost) throw new LadderError("insufficient_credits", "insufficient credits", { balance: demo.balance, cost: m.cost });
  demo.balance -= m.cost;
  demo.spent += m.cost;
  onStep("Simulating the Cloud Function…");
  await new Promise((r) => setTimeout(r, 900));
  const confidence = 0.78;
  // v4 sample Moment: per-claim verdicts (the simulation backs every claim the module backs) and the v4.5 recompute.
  const backed = a.claimIds ?? [];
  if (backed.length) {
    const v4 = await applyFixtureLadderV4(
      a.momentId,
      { ...m, module: m.id },
      backed.map((id) => ({ id, verdict: "backed" as const, confidence, reasons: [DEMO_REASONS[a.module]] })),
      { runId: a.requestId, confidence, reasons: [DEMO_REASONS[a.module]] },
    );
    if (v4)
      return {
        runId: a.requestId,
        module: a.module,
        passed: v4.result.passed,
        confidence,
        before: v4.result.before,
        after: v4.result.after,
        score: v4.score,
        bar: a.bar,
        verified: v4.verified,
        status: v4.status,
        cost: m.cost,
        balance: demo.balance,
        reasons: v4.result.reasons,
        claims: v4.result.claims,
        claimScores: v4.claimScores,
        claimsBacked: v4.claimsBacked,
      };
  }
  const passed = countsAsPass(true, confidence);
  const after = applyStep(a.score, m.strength, passed);
  const res: RunResult = {
    runId: a.requestId,
    module: a.module,
    passed,
    confidence,
    before: a.score,
    after,
    score: after,
    bar: a.bar,
    verified: after >= a.bar,
    status: after >= a.bar ? "sealed" : "rejected",
    cost: m.cost,
    balance: demo.balance,
    reasons: [DEMO_REASONS[a.module]],
  };
  await applyFixtureLadder(a.momentId, { ...res, title: m.title, strength: m.strength, model: "simulated", ranAt: Date.now() });
  return res;
}

export const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ (Math.random() * 16) >> (+c / 4)).toString(16));
