// Verified Cloud Functions: bar + claims + evidence plan (v4.3), the free video review (v4.4), the deterministic
// per-claim seal v4 (v4.5/v4.6), the verification ladder (v3.6 math for v3 seals, per claim for v4) and free credits.
// AI proposes (judge + skeptic + scorer from the client via Firebase AI Logic; barAndClaims, videoReview and the
// ladder modules from Gemini here, ONLY_IN_CLOUD); this code decides. Contract: docs/ARCHITECTURE.md v3 + v4.
import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { DocumentReference, FieldValue, Timestamp, getFirestore, Transaction } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger, setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { CallableRequest, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { ModuleAnswer, ModuleContext, computeBarAndClaims, runModule } from "./agents";
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
import { ChunkDoc, MomentDoc } from "./seal";
import {
  ServerClaimsDoc,
  ServerPlanDoc,
  TERMINAL_REVIEW,
  evaluateSealV4,
  feedV4Fields,
  isReadyToSealV4,
  needsBarAndClaims,
  needsVideoReview,
  sealDocV4,
  verificationDocV4,
  videoWaitExpired,
} from "./seal4";
import { ChecksV4, applyLadderV4, claimsBackedByModule, moduleOutcomes, reasonV4, recheck } from "./score4";
import { ModuleDef, ModuleId, getLadder, getModule } from "./shared";
import { Verification, eligibility, fail, isStaleRun, unmetNeedV4, validateRunRequest } from "./callable";
import {
  CLIP_EXTS,
  CLIP_TYPES,
  MAX_REVIEW_ATTEMPTS,
  ReviewClip,
  clipList,
  clipPath,
  clipsForReview,
  emptyReview,
  nextReviewStep,
  parseClipPath,
  runVideoReview,
} from "./video";
import { Claim, ClaimScore, ModuleClaimOutcome, VIDEO_LEASE_MS, VideoReview } from "./v4";

initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });
const db = getFirestore();

export type SealOutcome = "sealed" | "rejected" | "not-ready" | "waiting-for-chunks" | "already-sealed" | "missing";

const millis = (t: unknown): number | null => {
  const ms = (t as Timestamp | undefined)?.toMillis?.();
  return typeof ms === "number" ? ms : null;
};

/**
 * Server-only leases (no rules match, so clients can neither read nor write them): `barLeases` keeps the burst of
 * writes around submit to one barAndClaims call, `videoLeases` keeps the video review to one model call at a time.
 * A lease older than its TTL (a crashed instance) is taken over by the next trigger.
 */
async function takeLease(collection: "barLeases" | "videoLeases", momentId: string, ttlMs: number): Promise<boolean> {
  const lease = db.collection(collection).doc(momentId);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(lease);
    const at = millis(l.data()?.at);
    if (l.exists && typeof at === "number" && Date.now() - at < ttlMs) return false;
    tx.set(lease, { at: Timestamp.now() });
    return true;
  });
}
const dropLease = (collection: "barLeases" | "videoLeases", momentId: string) => db.collection(collection).doc(momentId).delete().catch(() => undefined);

// ───────────────────────────────── bar + claims + plan (v4.3)

export const BAR_LEASE_MS = 150_000;

/**
 * Computes the bar, the server claims and the evidence plan once, at submit (one ONLY_IN_CLOUD call). A bar already
 * written (by v3 functions) is kept: first bar wins. Idempotent.
 */
export async function ensureBarAndClaims(momentId: string): Promise<"written" | "skipped"> {
  const ref = db.collection("moments").doc(momentId);
  const pre = await ref.get();
  if (!pre.exists || !needsBarAndClaims(pre.data() as MomentDoc)) return "skipped";
  if (!(await takeLease("barLeases", momentId, BAR_LEASE_MS))) return "skipped";
  try {
    const res = await computeBarAndClaims(pre.data() as MomentDoc);
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const m = snap.data() as MomentDoc | undefined;
      if (!snap.exists || !needsBarAndClaims(m)) return "skipped" as const;
      const update: Record<string, unknown> = {};
      if (m!.bar == null) update.bar = res.bar;
      if (m!.claims == null) {
        update.claims = res.claims;
        update.plan = res.plan;
      }
      tx.update(ref, update);
      logger.info("bar and claims set", {
        momentId,
        bar: (update.bar as { value?: number } | undefined)?.value ?? "kept",
        claims: res.claims.items.map((c) => `${c.id} ${c.kind} ${c.text}`),
        source: res.claims.source,
        requirements: res.plan.requirements.length,
      });
      return "written" as const;
    });
  } finally {
    await dropLease("barLeases", momentId);
  }
}

// ───────────────────────────────── free video review (v4.4)

const WAITING_REASON = "waiting for video upload";

/** Streams a Storage object through SHA-256 (lowercase hex). */
async function hashObject(path: string): Promise<{ sha: string; bytes: number }> {
  const file = getStorage().bucket().file(path);
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
  return { sha: hash.digest("hex"), bytes };
}

/** Which chained clips are in Storage (sha → ext), checking every allowed extension. */
async function findClips(uid: string, momentId: string, facts: ChainFacts): Promise<Map<string, string>> {
  const bucket = getStorage().bucket();
  const found = new Map<string, string>();
  for (const v of facts.videos) {
    if (found.has(v.sha256)) continue;
    for (const ext of CLIP_EXTS) {
      const [exists] = await bucket.file(clipPath(uid, momentId, v.sha256, ext)).exists();
      if (exists) {
        found.set(v.sha256, ext);
        break;
      }
    }
  }
  return found;
}

const sameClips = (a: ReviewClip[] | undefined, b: ReviewClip[]) =>
  !!a && a.length === b.length && a.every((c, i) => c.sha256 === b[i].sha256 && c.uploaded === b[i].uploaded && c.ext === b[i].ext);

/** Writes videoReview when the Moment still needs it (transaction re-check), so racing triggers never regress it. */
async function writeReview(ref: DocumentReference, review: Omit<VideoReview, "updatedAtServer">, onlyIf?: (vr: Partial<VideoReview> | undefined) => boolean): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const m = snap.data() as MomentDoc | undefined;
    if (!snap.exists || !needsVideoReview(m)) return false;
    const vr = m!.videoReview as Partial<VideoReview> | undefined;
    if (onlyIf && !onlyIf(vr)) return false;
    tx.update(ref, { videoReview: { ...review, updatedAtServer: FieldValue.serverTimestamp() } });
    return true;
  });
}

export type ReviewOutcome = "none" | "waiting" | "expired" | "busy" | "done" | "retry" | "failed" | "waiting-for-chunks" | "skipped";

/**
 * v4.4 steps 1-5. Every write re-triggers onMomentWritten, which comes back here (no-op unless something changed)
 * and finally seals. Never deletes a clip: a hash mismatch is the evidence of cheating.
 */
export async function ensureVideoReview(momentId: string, now = Date.now()): Promise<ReviewOutcome> {
  const ref = db.collection("moments").doc(momentId);
  const pre = await ref.get();
  const m = pre.data() as MomentDoc | undefined;
  if (!pre.exists || !needsVideoReview(m)) return "skipped";
  const count = (await ref.collection("chunks").count().get()).data().count;
  if (count < m!.chunkCount) return "waiting-for-chunks";
  const chunks = (await ref.collection("chunks").orderBy("seq").get()).docs.map((d) => d.data() as ChunkDoc);
  const facts = chainFacts(chunks);
  const attemptsOf = (x: MomentDoc | undefined) => Number((x?.videoReview as Partial<VideoReview> | undefined)?.attempts) || 0;
  const found = facts.videos.length > 0 ? await findClips(m!.ownerUid, momentId, facts) : new Map<string, string>();
  const clips = clipList(facts.videos, found);
  const submittedMs = millis(m!.submittedAtServer) ?? (typeof m!.endedAt === "number" ? m!.endedAt : null);
  const pre1 = nextReviewStep(facts.videos, clips, attemptsOf(m), videoWaitExpired(submittedMs, now));

  // 1. No video in the chain.
  if (pre1.kind === "none") {
    await writeReview(ref, emptyReview("none", null));
    return "none";
  }
  // 2. A chained clip is not in Storage: wait (24 h), then seal without it. Clips over the upload limit are never
  //    uploaded (v4.4), so they do not hold the seal.
  if (pre1.kind === "expired") {
    await writeReview(ref, emptyReview("expired", pre1.reason, clips, attemptsOf(m)));
    logger.info("sealing without the video", { momentId, reason: pre1.reason });
    return "expired";
  }
  if (pre1.kind === "waiting") {
    await writeReview(ref, emptyReview("waiting", WAITING_REASON, clips, attemptsOf(m)), (cur) => !(cur?.status === "waiting" && cur.reason === WAITING_REASON && sameClips(cur.clips as ReviewClip[], clips)));
    return "waiting";
  }
  // 3. All clips that can arrive are present: one reviewer at a time.
  if (!(await takeLease("videoLeases", momentId, VIDEO_LEASE_MS))) return "busy";
  let released = false;
  const release = async () => {
    if (!released) await dropLease("videoLeases", momentId);
    released = true;
  };
  try {
    // Re-read under the lease: another instance may have spent an attempt (or finished) since our first read.
    const fresh = (await ref.get()).data() as MomentDoc | undefined;
    if (!needsVideoReview(fresh)) return "skipped";
    const step = nextReviewStep(facts.videos, clips, attemptsOf(fresh), false);
    if (step.kind === "failed") {
      // The attempts were spent by runs that died mid-way (instance crash / timeout): stop retrying, not cheating.
      await writeReview(ref, emptyReview("failed", "video review failed", clips, attemptsOf(fresh)));
      return "failed";
    }
    if (step.kind !== "run") return "skipped";
    // The attempt is counted before any work, so a run that keeps dying (OOM, timeout) cannot retry forever.
    const n = step.attempt;
    await writeReview(ref, emptyReview("running", n > 1 ? "retrying video review" : null, clips, n));
    const hashOk = new Map<string, boolean>();
    for (const c of clips) {
      if (!c.uploaded) continue;
      const { sha } = await hashObject(clipPath(m!.ownerUid, momentId, c.sha256, c.ext!));
      hashOk.set(c.sha256, sha === c.sha256);
      if (sha !== c.sha256) logger.warn("clip does not match the chain (kept as evidence)", { momentId, chained: c.sha256, actual: sha });
    }
    const checked = clipList(facts.videos, found, hashOk);
    const watch = clipsForReview(checked);
    const claims = ((fresh!.claims as ServerClaimsDoc).items ?? []) as Claim[];
    const plan = fresh!.plan as ServerPlanDoc;
    if (watch.length === 0) {
      // Every clip failed its hash: nothing honest to watch; the mismatch itself is the cheating signal.
      await writeReview(ref, { ...emptyReview("done", null, checked, n), ranAt: now });
      return "done";
    }
    const bucket = getStorage().bucket().name;
    try {
      const a = await runVideoReview({
        moment: fresh!,
        facts,
        claims,
        plan,
        clips: watch.map((c) => ({ ...c, gsUri: `gs://${bucket}/${clipPath(m!.ownerUid, momentId, c.sha256, c.ext!)}` })),
      });
      await writeReview(ref, { status: "done", clips: checked, claims: a.claims, cheating: a.cheating, summary: a.summary, attempts: n, reason: null, model: a.model, ranAt: now });
      logger.info("video reviewed", { momentId, claims: a.claims.map((c) => `${c.id} ${c.verdict} ${c.confidence}`), cheating: a.cheating });
      return "done";
    } catch (e) {
      // 4. Model/infra failure: retried on the next trigger, failed after MAX_REVIEW_ATTEMPTS (not cheating).
      logger.error("video review failed", { momentId, attempt: n, error: String(e) });
      await release(); // before the write, so the re-trigger it causes can take the lease and retry
      if (n >= MAX_REVIEW_ATTEMPTS) {
        await writeReview(ref, { ...emptyReview("failed", "video review failed", checked, n) });
        return "failed";
      }
      // Only if no other instance has started the next attempt in the meantime (never move attempts backwards).
      await writeReview(ref, { ...emptyReview("running", "retrying video review", checked, n) }, (cur) => (Number(cur?.attempts) || 0) <= n);
      return "retry";
    }
  } finally {
    await release();
  }
}

// ───────────────────────────────── seal v4 (v4.5/v4.6) + feed v4 (v4.8)

function ladderFeed(results: LadderResult[]) {
  return results.map((r) => ({ module: r.module, title: r.title, passed: r.passed, before: r.before, after: r.after, reasons: r.reasons.slice(0, 2) }));
}

/** Idempotent: safe to call any number of times, from any trigger. Every seal written here is v4. */
export async function trySeal(momentId: string): Promise<SealOutcome> {
  const ref = db.collection("moments").doc(momentId);
  const chunksRef = ref.collection("chunks");

  const pre = await ref.get();
  if (!pre.exists) return "missing";
  const m0 = pre.data() as MomentDoc;
  if (m0.seal) return "already-sealed";
  if (!isReadyToSealV4(m0)) return "not-ready";
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
    if (!isReadyToSealV4(m)) return "not-ready";
    const cs = await tx.get(chunksRef.orderBy("seq"));
    const chunks = cs.docs.map((d) => d.data() as ChunkDoc);
    if (chunks.length < m.chunkCount) return "waiting-for-chunks";

    const e = evaluateSealV4(momentId, m, chunks);
    const r = e.base;
    const status = e.score.sealed ? "sealed" : "rejected";
    const hero = r.heroFrameSeq == null ? null : chunks.find((c) => c.seq === r.heroFrameSeq)?.frame?.jpegB64 ?? null;
    const now = FieldValue.serverTimestamp();
    const vr = m.videoReview as Partial<VideoReview> | undefined;

    tx.update(ref, { status, seal: sealDocV4(e, now), verification: verificationDocV4(e, now) });
    tx.set(db.collection("feed").doc(momentId), {
      momentId,
      owner: m.owner ?? { name: "Someone", photoURL: null },
      intention: m.intention ?? null,
      platform: m.platform ?? null,
      summary: r.summary,
      onDeviceMode: (m.onDevice as { mode?: string } | undefined)?.mode ?? "none",
      status,
      sealReason: e.reason,
      checks: e.score.checks,
      judgeReasons: m.judge?.reasons ?? [],
      skepticReasons: m.skeptic?.reasons ?? [],
      verificationScore: e.score.score,
      scoreReasons: m.score?.reasons ?? [],
      heroJpegB64: hero,
      track: r.track.map(([lat, lng]) => ({ lat, lng })),
      sealedAtServer: now,
      // v3
      bar: e.bar,
      barRationale: m.bar?.rationale ?? null,
      difficulty: typeof m.bar?.difficulty === "number" ? m.bar.difficulty : null,
      baselineScore: e.score.baselineUsed,
      ladder: [],
      witness: witnessCounts(e.facts),
      recordedAsGuest: m.recordedAsGuest === true,
      // v4
      ...feedV4Fields(e.claims, e.score.claims, e.plan, e.bar, e.score.checks, e.score.cheating.signals, vr),
    });
    logger.info(`moment ${status}`, { momentId, checks: e.score.checks, bar: e.bar, score: e.score.score, claims: e.score.claims, cheating: e.score.cheating });
    return status;
  });
}

/** One step of the submit pipeline: bar + claims + plan → video review → seal. Each write re-triggers the next. */
export async function advance(momentId: string): Promise<string> {
  const m = (await db.collection("moments").doc(momentId).get()).data() as MomentDoc | undefined;
  if (!m || m.status !== "submitted" || m.seal) return "idle";
  if (needsBarAndClaims(m)) return ensureBarAndClaims(momentId);
  if (needsVideoReview(m)) return ensureVideoReview(momentId);
  if (isReadyToSealV4(m)) return trySeal(momentId);
  return "not-ready";
}

export const onMomentWritten = onDocumentWritten({ document: "moments/{momentId}", timeoutSeconds: 540, memory: "1GiB" }, async (event) => {
  const after = event.data?.after?.data() as MomentDoc | undefined;
  if (!after || after.status !== "submitted" || after.seal) return;
  await advance(event.params.momentId);
});

export const onChunkWritten = onDocumentCreated({ document: "moments/{momentId}/chunks/{seq}", timeoutSeconds: 540, memory: "1GiB" }, async (event) => {
  // Late (offline-tail) chunks: once the last one arrives the Moment may become reviewable / sealable. Also retries a
  // bar agent that died before writing (no further Moment writes would re-run it).
  await advance(event.params.momentId);
});

/**
 * v4.4: a clip landed in Storage. Touch the Moment (videoReview.updatedAtServer) so onMomentWritten re-runs the video
 * review, but only while it is submitted, unsealed, owned by the uploader and its review is not settled.
 */
export const onClipUploaded = onObjectFinalized({ timeoutSeconds: 60 }, async (event) => {
  const p = parseClipPath(event.data.name);
  if (!p) return;
  const ref = db.collection("moments").doc(p.momentId);
  const touched = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const m = snap.data() as MomentDoc | undefined;
    if (!m || m.ownerUid !== p.uid || m.status !== "submitted" || m.seal) return false;
    const vr = m.videoReview as Partial<VideoReview> | undefined;
    // No review yet: the pipeline (claims write / last chunk) will run it and find the clip. Touching now would
    // leave a videoReview without a status, which clients cannot render.
    if (!vr || TERMINAL_REVIEW.includes(String(vr.status))) return false;
    tx.update(ref, { "videoReview.updatedAtServer": FieldValue.serverTimestamp() });
    return true;
  });
  logger.info("clip uploaded", { momentId: p.momentId, sha256: p.sha256, touched });
});

/**
 * v4.4: every 30 min, settle video reviews nothing else will move: clips that never arrived within 24 h (→ expired,
 * the Moment seals without them) and reviews whose instance died mid-run (lease expired → re-run). Also retries a
 * barAndClaims call whose instance died (its lease expired), since no further Moment write may come.
 */
export const expireVideoWaits = onSchedule({ schedule: "every 30 minutes", timeoutSeconds: 540, memory: "1GiB" }, async () => {
  const snap = await db.collection("moments").where("status", "==", "submitted").get();
  let n = 0;
  for (const d of snap.docs) {
    const m = d.data() as MomentDoc;
    // A barAndClaims run whose instance died leaves an expired lease and nothing to re-trigger it: retry it here.
    if (needsBarAndClaims(m)) {
      await advance(d.id).catch((e) => logger.error("scheduled bar and claims failed", { momentId: d.id, error: String(e) }));
      continue;
    }
    if (!needsVideoReview(m)) continue;
    const out = await ensureVideoReview(d.id).catch((e) => {
      logger.error("scheduled video review failed", { momentId: d.id, error: String(e) });
      return "error";
    });
    if (out !== "waiting" && out !== "busy") n++;
    if (out === "expired" || out === "done" || out === "failed") await advance(d.id);
  }
  logger.info("video waits checked", { submitted: snap.size, moved: n });
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
  await dropLease("barLeases", momentId);
  await dropLease("videoLeases", momentId);
  // The owner's uploaded clips go too (best effort: Storage may not be enabled in every project).
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
  // v4 Moments
  claims?: ModuleClaimOutcome[];
  claimScores?: ClaimScore[];
  claimsBacked?: number;
};

/** v4 verification on the Moment (v4.6). */
type VerificationV4Doc = Verification & { version: 4; claims: ClaimScore[]; claimsBacked: number; cheating: { detected: boolean; signals: string[] }; baselineUsed: number };
type LadderResultV4 = LadderResult & { claims?: ModuleClaimOutcome[] };

function responseFor(r: LadderResultV4, v: Verification, status: string, balance: number): RunResponse {
  const v4 = v.version === 4 ? (v as VerificationV4Doc) : null;
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
    ...(v4 ? { claims: r.claims ?? [], claimScores: v4.claims, claimsBacked: v4.claimsBacked } : {}),
  };
}

/**
 * full_video: find the uploaded clip and re-hash its bytes against the chain. Throws HttpsError; no charge yet.
 * A mismatched upload is deleted so the owner can upload the right bytes (clips are create-only), unless
 * `keepOnMismatch(sha)`: on v4 Moments a clip the seal's video review saw is cheating evidence and stays. A v4 clip
 * that arrived after the 24 h expiry was never part of the seal, so it is treated like a v3 upload.
 */
async function loadClip(uid: string, momentId: string, facts: ChainFacts, clipSha: string | undefined, keepOnMismatch: (sha: string) => boolean): Promise<NonNullable<ModuleContext["clip"]>> {
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
      const keep = keepOnMismatch(chained.sha256);
      if (!keep) await file.delete().catch((e) => logger.warn("could not remove mismatched clip", { path: file.name, error: String(e) }));
      throw fail("failed-precondition", "clip_hash_mismatch", keep ? "The uploaded clip does not match the hash in the chain." : "The uploaded clip does not match the hash in the chain. Upload it again.");
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

const MODULE_IDS = new Set(getLadder().modules.map((x) => x.id as string));

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
  const isV4 = Number((m.seal as SealV3).version) >= 4;
  const serverClaims = isV4 ? (((m.claims as ServerClaimsDoc | undefined)?.items ?? []) as Claim[]) : [];
  const need = isV4 ? unmetNeedV4(mod, facts, serverClaims) : unmetNeed(mod, facts, m.intention as never);
  if (need) throw fail("failed-precondition", need, `This module needs: ${need.replace("needs_", "")}.`);
  // v4: the module moves only the claims it backs (kind in backs; witness_review only the targeted ones).
  const backedIds = isV4
    ? claimsBackedByModule(
        serverClaims,
        (m.plan as ServerPlanDoc | undefined)?.requirements ?? [],
        facts.witness.map((w) => ({ wid: w.wid, rid: w.rid, answered: !!w.answer })),
        { backs: mod.backs, targetedOnly: mod.backsTargetedOnly === true },
      )
    : [];
  if (isV4 && backedIds.length === 0) throw fail("failed-precondition", "no_claims_backed", `${mod.title} backs none of this Moment's claims.`);
  const sealedClips = new Set(
    ((m.videoReview as Partial<VideoReview> | undefined)?.clips ?? []).filter((c) => c.uploaded).map((c) => c.sha256),
  );
  const clip = module === "full_video" ? await loadClip(uid, momentId, facts, clipSha, (sha) => isV4 && sealedClips.has(sha)) : undefined;

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
  let answer: ModuleAnswer;
  try {
    answer = await runModule(module, { momentId, moment: m, facts, clip, claims: serverClaims.filter((c) => backedIds.includes(c.id)) });
  } catch (e) {
    logger.error("ladder module failed; refunding", { momentId, module, requestId, error: String(e) });
    await refundRun(uid, momentRef, module, requestId, cost, "Refund: model failed");
    throw fail("unavailable", "model_failed", "The module could not run right now; your credits were refunded.");
  }

  /**
   * v4 record (v4.6): append the result with its per-claim outcomes, recompute every claim from sealP with every
   * module in run order (v4.5 step 4-5), then checks.bar, sealed, reason, status and the feed.
   */
  const recordV4 = (tx: Transaction, cur: MomentDoc, v: VerificationV4Doc, seal: SealV3, balanceRaw: unknown): RunResponse => {
    const verdicts = answer.claims ?? [];
    const pending: LadderResultV4 = {
      runId: requestId,
      module,
      title: mod.title,
      cost,
      strength: mod.strength,
      passed: false,
      confidence: answer.confidence,
      before: 0,
      after: 0,
      reasons: answer.reasons,
      ...(answer.measured ? { measured: answer.measured } : {}),
      model: answer.model,
      ranAt: Date.now(),
      claims: backedIds.map((id) => {
        const x = verdicts.find((y) => y.id === id);
        return { id, verdict: x ? x.verdict : "missing", confidence: x ? x.confidence : 0, passed: false, before: 0, after: 0, reasons: [] };
      }),
    };
    const modules = [...((v.modules ?? []) as LadderResultV4[]), pending];
    const base = (v.claims ?? []).map((c) => ({ ...c, backedBy: c.backedBy.filter((b) => !MODULE_IDS.has(b)) }));
    const res = applyLadderV4(
      base,
      v.cheating?.detected === true,
      modules.map((r) => ({
        module: r.module,
        strength: r.strength,
        backedIds: (r.claims ?? []).map((c) => c.id),
        claims: (r.claims ?? []).filter((c) => c.verdict !== "missing"),
      })),
    );
    const step = res.ladder[res.ladder.length - 1];
    const result: LadderResultV4 = { ...pending, passed: step.passed, before: step.before, after: step.after, claims: moduleOutcomes(step, verdicts) };
    modules[modules.length - 1] = result;
    const bar = v.bar;
    const re = recheck(seal.checks as unknown as ChecksV4, res.claims, bar);
    const claimsDoc = ((cur.claims as ServerClaimsDoc | undefined)?.items ?? []) as Claim[];
    const signals = (seal.cheatingSignals as string[] | undefined) ?? v.cheating?.signals ?? [];
    const reason = reasonV4(re.checks, signals, seal.reason, res.claims, new Map(claimsDoc.map((c) => [c.id, c.text])), bar, res.score);
    const status = re.sealed ? "sealed" : "rejected";
    const now = FieldValue.serverTimestamp();
    tx.update(momentRef, {
      status,
      "seal.checks": re.checks,
      "seal.sealed": re.sealed,
      "seal.reason": reason,
      "seal.updatedAt": now,
      "verification.modules": modules,
      "verification.score": res.score,
      "verification.verified": re.sealed,
      "verification.claims": res.claims,
      "verification.claimsBacked": re.claimsBacked,
      "verification.updatedAtServer": now,
      [`verification.pending.${module}`]: FieldValue.delete(),
    });
    const fv4 = feedV4Fields(claimsDoc, res.claims, cur.plan as ServerPlanDoc, bar, re.checks, signals, cur.videoReview as Partial<VideoReview> | undefined);
    tx.set(
      db.collection("feed").doc(momentId),
      {
        status,
        sealReason: reason,
        checks: re.checks,
        verificationScore: res.score,
        ladder: ladderFeed(modules),
        claims: fv4.claims,
        claimsBacked: fv4.claimsBacked,
        plan: fv4.plan,
        ladderUpdatedAtServer: now,
      },
      { merge: true },
    );
    logger.info("ladder module recorded (v4)", { momentId, module, claims: result.claims, score: res.score, bar, status });
    const nextV: VerificationV4Doc = { ...v, modules, score: res.score, verified: re.sealed, claims: res.claims, claimsBacked: re.claimsBacked };
    return responseFor(result, nextV, status, Number(balanceRaw ?? 0));
  };

  // Record: append the result, recompute the score from the baseline, re-seal (bar check only), update the feed.
  const passConfidence = getLadder().passConfidence;
  try {
    return await db.runTransaction(async (tx) => {
      const [ms, cs] = await Promise.all([tx.get(momentRef), tx.get(creditsRef(db, uid))]);
      const cur = ms.data() as MomentDoc | undefined;
      const v = cur?.verification as Verification | undefined;
      const seal = cur?.seal as SealV3 | undefined;
      // Deleted (or otherwise gone) while the model ran: nothing to record on, so the spend is refunded below.
      if (!cur || !v || !seal || (isV4 ? typeof v.score !== "number" : typeof v.baseline !== "number")) throw new MomentGone();
      const done = v.modules?.find((r) => r.runId === requestId);
      if (done) return responseFor(done, v, String(cur.status), Number(cs.data()?.balance ?? 0));
      if (isV4) return recordV4(tx, cur, v as VerificationV4Doc, seal, cs.data()?.balance);
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
