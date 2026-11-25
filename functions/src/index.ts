// Verified Cloud Functions: the AI-set bar, the deterministic seal v3, the verification ladder and free credits.
// AI proposes (judge + skeptic + scorer from the client via Firebase AI Logic; bar + ladder modules from Gemini
// here, ONLY_IN_CLOUD); this code decides. Contract: docs/ARCHITECTURE.md (v3.3 - v3.8).
import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { DocumentReference, FieldValue, Timestamp, getFirestore, Transaction } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger, setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { CallableRequest, onCall } from "firebase-functions/v2/https";
import { ModuleContext, computeBar, runModule } from "./agents";
import { CreditsDoc, creditsRef, debit, entry, ledgerRef, withGrant, writeCredits } from "./credits";
import {
  ChainFacts,
  LadderResult,
  SealV3,
  applyStep,
  chainFacts,
  countsAsPass,
  resealAfterLadder,
  scoreFromResults,
  unmetNeed,
  witnessCounts,
} from "./ladder";
import { ChunkDoc, MomentDoc, SEAL_VERSION, evaluateSeal, isReadyToSeal, needsBar } from "./seal";
import { ModuleDef, ModuleId, getLadder, getModule } from "./shared";
import { Verification, eligibility, fail, isStaleRun, validateRunRequest } from "./callable";

initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });
const db = getFirestore();

export type SealOutcome = "sealed" | "rejected" | "not-ready" | "waiting-for-chunks" | "already-sealed" | "missing";

// ───────────────────────────────── bar (v3.3)

/**
 * A short lease so the burst of writes around submit (status, then judge/skeptic/score) calls the bar model once,
 * not once per trigger. Server-only collection (no rules match, so clients can neither read nor write it).
 * computeBar never throws, so the holder always writes; a lease older than BAR_LEASE_MS (a crashed instance) is
 * taken over by the next trigger.
 */
export const BAR_LEASE_MS = 150_000;

async function takeBarLease(momentId: string): Promise<boolean> {
  const lease = db.collection("barLeases").doc(momentId);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(lease);
    const at = (l.data()?.at as Timestamp | undefined)?.toMillis?.();
    if (l.exists && typeof at === "number" && Date.now() - at < BAR_LEASE_MS) return false;
    tx.set(lease, { at: Timestamp.now() });
    return true;
  });
}

/** Computes the AI-set bar once, at submit. Idempotent: only the first writer wins. */
export async function ensureBar(momentId: string): Promise<"written" | "skipped"> {
  const ref = db.collection("moments").doc(momentId);
  const pre = await ref.get();
  if (!pre.exists || !needsBar(pre.data() as MomentDoc)) return "skipped";
  if (!(await takeBarLease(momentId))) return "skipped";
  const bar = await computeBar(pre.data() as MomentDoc);
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !needsBar(snap.data() as MomentDoc)) return "skipped" as const;
    tx.update(ref, { bar });
    logger.info("bar set", { momentId, value: bar.value, difficulty: bar.difficulty, source: bar.source });
    return "written" as const;
  });
  await db.collection("barLeases").doc(momentId).delete().catch(() => undefined);
  return out;
}

// ───────────────────────────────── seal v3 (v3.5) + feed v3 (v3.8)


function ladderFeed(results: LadderResult[]) {
  return results.map((r) => ({ module: r.module, title: r.title, passed: r.passed, before: r.before, after: r.after, reasons: r.reasons.slice(0, 2) }));
}

/** Idempotent: safe to call any number of times, from any trigger. */
export async function trySeal(momentId: string): Promise<SealOutcome> {
  const ref = db.collection("moments").doc(momentId);
  const chunksRef = ref.collection("chunks");

  // Cheap pre-checks outside the transaction.
  const pre = await ref.get();
  if (!pre.exists) return "missing";
  const m0 = pre.data() as MomentDoc;
  if (m0.seal) return "already-sealed";
  if (!isReadyToSeal(m0)) return "not-ready";
  const count = (await chunksRef.count().get()).data().count;
  if (count < m0.chunkCount) {
    logger.info("waiting for chunks", { momentId, have: count, want: m0.chunkCount });
    return "waiting-for-chunks";
  }

  return db.runTransaction(async (tx: Transaction): Promise<SealOutcome> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "missing";
    const m = snap.data() as MomentDoc;
    if (m.seal) return "already-sealed";
    if (!isReadyToSeal(m)) return "not-ready";
    const cs = await tx.get(chunksRef.orderBy("seq"));
    const chunks = cs.docs.map((d) => d.data() as ChunkDoc);
    if (chunks.length < m.chunkCount) return "waiting-for-chunks";

    const r = evaluateSeal(momentId, m, chunks);
    const facts = chainFacts(chunks);
    const status = r.sealed ? "sealed" : "rejected";
    const hero = r.heroFrameSeq == null ? null : chunks.find((c) => c.seq === r.heroFrameSeq)?.frame?.jpegB64 ?? null;
    const now = FieldValue.serverTimestamp();
    const verification = {
      version: SEAL_VERSION,
      baseline: r.baseline,
      score: r.baseline,
      bar: r.barValue,
      verified: r.baseline != null ? r.baseline >= r.barValue : r.sealed,
      modules: [] as LadderResult[],
      updatedAtServer: now,
    };

    tx.update(ref, {
      status,
      seal: { sealed: r.sealed, at: now, updatedAt: now, checks: r.checks, reason: r.reason, version: SEAL_VERSION, ladderEligible: r.ladderEligible },
      verification,
    });
    tx.set(db.collection("feed").doc(momentId), {
      momentId,
      owner: m.owner ?? { name: "Someone", photoURL: null },
      intention: m.intention ?? null,
      platform: m.platform ?? null,
      summary: r.summary,
      onDeviceMode: (m.onDevice as { mode?: string } | undefined)?.mode ?? "none",
      status,
      sealReason: r.reason,
      checks: r.checks,
      judgeReasons: m.judge?.reasons ?? [],
      skepticReasons: m.skeptic?.reasons ?? [],
      verificationScore: r.baseline,
      scoreReasons: m.score?.reasons ?? [],
      heroJpegB64: hero,
      track: r.track.map(([lat, lng]) => ({ lat, lng })),
      sealedAtServer: now,
      // v3
      bar: r.barValue,
      barRationale: m.bar?.rationale ?? null,
      difficulty: typeof m.bar?.difficulty === "number" ? m.bar.difficulty : null,
      baselineScore: r.baseline,
      ladder: [],
      witness: witnessCounts(facts),
      recordedAsGuest: m.recordedAsGuest === true,
      sealVersion: SEAL_VERSION,
    });
    logger.info(`moment ${status}`, { momentId, checks: r.checks, failures: r.failures, bar: r.barValue, score: r.baseline });
    return status;
  });
}

export const onMomentWritten = onDocumentWritten({ document: "moments/{momentId}", timeoutSeconds: 120 }, async (event) => {
  const after = event.data?.after?.data() as MomentDoc | undefined;
  const momentId = event.params.momentId;
  // 1. Submitted without a bar: the bar agent runs first. Writing the bar re-triggers this function, which seals.
  if (needsBar(after)) {
    await ensureBar(momentId);
    return;
  }
  if (!isReadyToSeal(after)) return;
  await trySeal(momentId);
});

export const onChunkWritten = onDocumentCreated({ document: "moments/{momentId}/chunks/{seq}", timeoutSeconds: 120 }, async (event) => {
  // Late (offline-tail) chunks: once the last one arrives the moment may become sealable. If the bar trigger died
  // before writing the bar (no further Moment writes would re-run it), a late chunk retries it; the bar write then
  // re-triggers onMomentWritten, which seals.
  const momentId = event.params.momentId;
  const m = (await db.collection("moments").doc(momentId).get()).data() as MomentDoc | undefined;
  if (needsBar(m)) {
    await ensureBar(momentId);
    return;
  }
  await trySeal(momentId);
});

/**
 * The owner deleted a Moment from "my Moments" (firestore.rules allow only that). Clean up what clients can't:
 * the append-only chunks and the public feed entry. Then leave a tombstone so no device's raw vault re-creates it
 * (docs/ARCHITECTURE.md "Raw vault" + "Deleting a Moment"). Idempotent.
 */
export const onMomentDeleted = onDocumentDeleted("moments/{momentId}", async (event) => {
  const momentId = event.params.momentId;
  const before = event.data?.data() as MomentDoc | undefined;
  await db.doc(`deleted/${momentId}`).set({ ownerUid: before?.ownerUid ?? null, deletedAt: FieldValue.serverTimestamp() });
  await db.recursiveDelete(db.collection(`moments/${momentId}/chunks`));
  await db.doc(`feed/${momentId}`).delete();
  await db.doc(`barLeases/${momentId}`).delete().catch(() => undefined);
  // The owner's uploaded full_video clips go too (best effort: Storage may not be enabled in every project).
  if (before?.ownerUid) {
    await getStorage()
      .bucket()
      .deleteFiles({ prefix: `clips/${before.ownerUid}/${momentId}/` })
      .catch((e) => logger.warn("clip cleanup failed", { momentId, error: String(e) }));
  }
  logger.info("moment deleted by owner", { momentId, ownerUid: before?.ownerUid });
});

// ───────────────────────────────── callables (v3.7)

function requireUid(req: CallableRequest<unknown>): string {
  const uid = req.auth?.uid;
  if (!uid) throw fail("unauthenticated", "sign_in", "Sign in to continue.");
  return uid;
}

export const getCredits = onCall(async (req) => {
  const uid = requireUid(req);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(creditsRef(db, uid));
    const { credits, justGranted } = withGrant(snap.exists ? (snap.data() as CreditsDoc) : undefined);
    if (justGranted) writeCredits(tx, db, uid, credits, true);
    return { ...credits, justGranted };
  });
});

type RunResponse = {
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
  measured?: LadderResult["measured"];
};

function responseFor(r: LadderResult, v: Verification, status: string, balance: number): RunResponse {
  return {
    runId: r.runId,
    module: r.module,
    passed: r.passed,
    confidence: r.confidence,
    before: r.before,
    after: r.after,
    score: v.score ?? r.after,
    bar: v.bar,
    verified: v.verified,
    status: status === "sealed" ? "sealed" : "rejected",
    cost: r.cost,
    balance,
    reasons: r.reasons,
    ...(r.measured ? { measured: r.measured } : {}),
  };
}

const CLIP_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

/** full_video: find the uploaded clip and re-hash its bytes against the chain. Throws HttpsError; no charge yet. */
async function loadClip(uid: string, momentId: string, facts: ChainFacts, clipSha?: string): Promise<NonNullable<ModuleContext["clip"]>> {
  const chained = clipSha ? facts.videos.find((v) => v.sha256 === clipSha) : facts.videos[facts.videos.length - 1];
  if (!chained) throw fail("failed-precondition", clipSha ? "clip_missing" : "needs_video", "That video is not in this Moment's chain.");
  const bucket = getStorage().bucket();
  for (const [ext, mimeType] of Object.entries(CLIP_TYPES)) {
    const file = bucket.file(`clips/${uid}/${momentId}/${chained.sha256}.${ext}`);
    const [exists] = await file.exists();
    if (!exists) continue;
    const hash = createHash("sha256");
    let bytes = 0;
    await new Promise<void>((resolve, reject) => {
      file
        .createReadStream()
        .on("data", (b: Buffer) => {
          bytes += b.length;
          hash.update(b);
        })
        .on("error", reject)
        .on("end", () => resolve());
    });
    const sha = hash.digest("hex");
    if (sha !== chained.sha256) {
      // Storage rules make clips create-only, so remove the bad upload or the owner could never upload the right one.
      await file.delete().catch((e) => logger.warn("could not remove mismatched clip", { path: file.name, error: String(e) }));
      throw fail("failed-precondition", "clip_hash_mismatch", "The uploaded clip does not match the hash in the chain. Upload it again.");
    }
    return { gsUri: `gs://${bucket.name}/${file.name}`, mimeType, sha256: sha, bytes, durationMs: chained.durationMs };
  }
  throw fail("failed-precondition", "clip_missing", "Upload the clip first.", {
    bucket: bucket.name,
    path: `clips/${uid}/${momentId}/${chained.sha256}.mp4`,
    extensions: Object.keys(CLIP_TYPES),
  });
}

/**
 * Refunds one run's spend (idempotent: the `<requestId>-refund` entry is written once) and clears its in-flight
 * marker when the Moment still carries it. Safe when the Moment was deleted meanwhile.
 */
async function refundRun(uid: string, momentRef: DocumentReference, module: ModuleId, requestId: string, cost: number, reason: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const refundRef = ledgerRef(db, uid, `${requestId}-refund`);
    const [cs, rs, ms] = await Promise.all([tx.get(creditsRef(db, uid)), tx.get(refundRef), tx.get(momentRef)]);
    const pending = (ms.data()?.verification as Verification | undefined)?.pending?.[module];
    if (!rs.exists) {
      const next = debit(withGrant(cs.data() as CreditsDoc).credits, -cost);
      writeCredits(tx, db, uid, next, false);
      tx.set(refundRef, entry({ delta: cost, kind: "refund", reason, momentId: momentRef.id, module, runId: requestId, balanceAfter: next.balance }));
    }
    if (ms.exists && pending === requestId) tx.update(momentRef, { [`verification.pending.${module}`]: FieldValue.delete() });
  });
}

/**
 * A run that never finished (instance died after the spend): neither a recorded result nor a refund, and the
 * spend is older than STALE_RUN_MS. Refunds it and clears its marker, so the module is not blocked forever and
 * the credits come back. Returns true when `requestId` is now settled as refunded.
 */
async function recoverStaleRun(uid: string, momentRef: DocumentReference, module: ModuleId, requestId: string): Promise<boolean> {
  const [spend, refund, ms] = await Promise.all([ledgerRef(db, uid, requestId).get(), ledgerRef(db, uid, `${requestId}-refund`).get(), momentRef.get()]);
  if (!spend.exists || spend.get("kind") !== "spend") return false;
  if (refund.exists) return true;
  const recorded = (ms.data()?.verification as Verification | undefined)?.modules?.some((r) => r.runId === requestId);
  if (recorded) return false;
  const at = (spend.get("atServer") as Timestamp | undefined)?.toMillis?.();
  if (!isStaleRun(at, Date.now())) return false;
  logger.warn("refunding a ladder run that never finished", { momentId: momentRef.id, module, requestId });
  await refundRun(uid, momentRef, module, requestId, Math.abs(Number(spend.get("delta")) || 0), "Refund: run did not finish");
  return true;
}

class MomentGone extends Error {}

export const runLadderModule = onCall({ timeoutSeconds: 300, memory: "1GiB" }, async (req): Promise<RunResponse> => {
  const uid = requireUid(req);
  const { momentId, module, requestId, clipSha } = validateRunRequest(req.data);
  const mod = getModule(module) as ModuleDef;
  if (!mod.available) throw fail("failed-precondition", "unavailable_module", `${mod.title} is not available yet.`);
  const momentRef = db.collection("moments").doc(momentId);
  const spendRef = ledgerRef(db, uid, requestId);

  // Idempotency: the same requestId returns the stored result, never a second charge.
  const prior = await spendRef.get();
  if (prior.exists) {
    const p = prior.data()!;
    if (p.momentId !== momentId || p.module !== module) throw fail("invalid-argument", "bad_request", "requestId was used for another run.");
    const ms = await momentRef.get();
    const v = ms.data()?.verification as Verification | undefined;
    const done = v?.modules?.find((r) => r.runId === requestId);
    const bal = Number((await creditsRef(db, uid).get()).data()?.balance ?? 0);
    if (done && v) return responseFor(done, v, ms.data()!.status, bal);
    if (await recoverStaleRun(uid, momentRef, module, requestId)) throw fail("unavailable", "model_failed", "The module could not run; credits were refunded.");
    throw fail("aborted", "in_progress", "This run is still in progress.");
  }

  // Load + eligibility (outside the spend; cheap, and the spend transaction re-checks).
  let snap = await momentRef.get();
  if (!snap.exists) throw fail("not-found", "moment_missing", "Moment not found.");
  if ((snap.data() as MomentDoc).ownerUid !== uid) throw fail("permission-denied", "not_owner", "Only the owner can run verification modules.");
  // Another run of this module holds the marker: if it died mid-run long ago, settle it (refund) and go on.
  const holder = ((snap.data() as MomentDoc).verification as Verification | undefined)?.pending?.[module];
  if (holder && holder !== requestId && (await recoverStaleRun(uid, momentRef, module, holder))) snap = await momentRef.get();
  const m = snap.data() as MomentDoc;
  const why = eligibility(m, module, requestId);
  if (why) throw fail("failed-precondition", why, `Not eligible: ${why}.`);
  const chunks = (await momentRef.collection("chunks").orderBy("seq").get()).docs.map((d) => d.data() as ChunkDoc);
  const facts = chainFacts(chunks);
  const need = unmetNeed(mod, facts, m.intention as never);
  if (need) throw fail("failed-precondition", need, `This module needs: ${need.replace("needs_", "")}.`);
  const clip = module === "full_video" ? await loadClip(uid, momentId, facts, clipSha) : undefined;

  // Spend (grant first if this is the user's first use). Marks the module as in flight on the Moment.
  const cost = mod.cost;
  await db.runTransaction(async (tx) => {
    const [ms, cs, ls] = await Promise.all([tx.get(momentRef), tx.get(creditsRef(db, uid)), tx.get(spendRef)]);
    if (ls.exists) throw fail("aborted", "in_progress", "This run is already in progress.");
    if (!ms.exists) throw fail("not-found", "moment_missing", "Moment not found.");
    const again = eligibility(ms.data() as MomentDoc, module, requestId);
    if (again) throw fail("failed-precondition", again, `Not eligible: ${again}.`);
    const { credits, justGranted } = withGrant(cs.exists ? (cs.data() as CreditsDoc) : undefined);
    if (credits.balance < cost) {
      throw fail("resource-exhausted", "insufficient_credits", `${mod.title} costs ${cost} credits; you have ${credits.balance}.`, { balance: credits.balance, cost });
    }
    const next = debit(credits, cost);
    writeCredits(tx, db, uid, next, justGranted);
    tx.set(spendRef, entry({ delta: -cost, kind: "spend", reason: mod.title, momentId, module, runId: requestId, balanceAfter: next.balance }));
    tx.update(momentRef, { [`verification.pending.${module}`]: requestId });
  });

  // Run the module (server Gemini). Any failure refunds and records nothing.
  let answer;
  try {
    answer = await runModule(module, { momentId, moment: m, facts, clip });
  } catch (e) {
    logger.error("ladder module failed; refunding", { momentId, module, requestId, error: String(e) });
    await refundRun(uid, momentRef, module, requestId, cost, "Refund: model failed");
    throw fail("unavailable", "model_failed", "The module could not run right now; your credits were refunded.");
  }

  // Record: append the result, recompute the score from the baseline, re-seal (bar check only), update the feed.
  const passConfidence = getLadder().passConfidence;
  try {
    return await db.runTransaction(async (tx) => {
      const [ms, cs] = await Promise.all([tx.get(momentRef), tx.get(creditsRef(db, uid))]);
      const cur = ms.data() as MomentDoc | undefined;
      const v = cur?.verification as Verification | undefined;
      const seal = cur?.seal as SealV3 | undefined;
      // Deleted (or otherwise gone) while the model ran: nothing to record on, so the spend is refunded below.
      if (!cur || !v || !seal || typeof v.baseline !== "number") throw new MomentGone();
      const done = v.modules?.find((r) => r.runId === requestId);
      if (done) return responseFor(done, v, String(cur.status), Number(cs.data()?.balance ?? 0));
      const baseline = v.baseline as number;
      const before = scoreFromResults(baseline, v.modules ?? []);
      const passed = countsAsPass(answer.passed, answer.confidence, passConfidence);
      const result: LadderResult = {
        runId: requestId,
        module,
        title: mod.title,
        cost,
        strength: mod.strength,
        passed,
        confidence: answer.confidence,
        before,
        after: applyStep(before, mod.strength, passed),
        reasons: answer.reasons,
        ...(answer.measured ? { measured: answer.measured } : {}),
        model: answer.model,
        ranAt: Date.now(),
      };
      const modules = [...(v.modules ?? []), result];
      const score = scoreFromResults(baseline, modules);
      const verified = score >= v.bar;
      const re = resealAfterLadder(seal, score, v.bar);
      const now = FieldValue.serverTimestamp();
      tx.update(momentRef, {
        status: re.status,
        "seal.checks": re.checks,
        "seal.sealed": re.sealed,
        "seal.reason": re.reason,
        "seal.updatedAt": now,
        "verification.modules": modules,
        "verification.score": score,
        "verification.verified": verified,
        "verification.updatedAtServer": now,
        [`verification.pending.${module}`]: FieldValue.delete(),
      });
      tx.set(
        db.collection("feed").doc(momentId),
        { status: re.status, sealReason: re.reason, checks: re.checks, verificationScore: score, ladder: ladderFeed(modules), ladderUpdatedAtServer: now },
        { merge: true },
      );
      logger.info("ladder module recorded", { momentId, module, passed, before, after: result.after, score, bar: v.bar, status: re.status });
      const balance = Number(cs.data()?.balance ?? 0);
      return responseFor(result, { ...v, score, verified, modules }, re.status, balance);
    });
  } catch (e) {
    if (!(e instanceof MomentGone)) throw e;
    await refundRun(uid, momentRef, module, requestId, cost, "Refund: Moment was deleted");
    throw fail("not-found", "moment_missing", "The Moment was deleted while the module ran; your credits were refunded.");
  }
});
