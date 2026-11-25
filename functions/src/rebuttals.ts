// v5 crowd rebuttals (docs/ARCHITECTURE.md v5): the submitRebuttal callable, the once-per-round re-verification and
// its retry. Pure rules live in challenge.ts, model calls in challengeAgents.ts; this file does the Firestore I/O.
// AI proposes (screen, review); challenge.ts decides; only this code writes `challenge`, rebuttals and rebutter records.
import { DocumentReference, FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { fail } from "./callable";
import {
  CHALLENGE_LEASE_MS,
  ChallengeDoc,
  MAX_CHALLENGE_TRIES,
  acceptRebuttal,
  anchorProblem,
  challengeOf,
  challengeOutcome,
  challengeableWhy,
  claimsOf,
  currentRoundUids,
  feedChallenge,
  rateCheck,
  resolveRound,
  storedVerdict,
  validateRebuttalRequest,
  voidRound,
} from "./challenge";
import { ReviewRebuttal, anchorText, runChallengeReview, runScreen } from "./challengeAgents";
import { chainFacts } from "./ladder";
import { ChunkDoc, MomentDoc } from "./seal";
import { ClaimScore, VideoReview } from "./v4";
import { ReviewClip, clipPath, clipsForReview } from "./video";

const MESSAGES: Record<string, string> = {
  not_challengeable: "This Moment can't be rebutted right now.",
  own_moment: "You can't rebut your own Moment.",
  already_rebutted: "You've already rebutted this Moment.",
};

export interface SubmitResponse {
  accepted: boolean;
  reason: string;
  rebuttalId: string | null;
  count: number;
  threshold: number;
  reviewing: boolean;
}

async function lease(db: Firestore, momentId: string): Promise<boolean> {
  const ref = db.collection("challengeLeases").doc(momentId);
  return db.runTransaction(async (tx) => {
    const l = await tx.get(ref);
    const at = (l.data()?.at as Timestamp | undefined)?.toMillis?.();
    if (l.exists && typeof at === "number" && Date.now() - at < CHALLENGE_LEASE_MS) return false;
    tx.set(ref, { at: Timestamp.now() });
    return true;
  });
}
const dropLease = (db: Firestore, momentId: string) => db.collection("challengeLeases").doc(momentId).delete().catch(() => undefined);

/** After a round is voided (error / moot): its still-pending rebuttals become `void`. */
export async function voidPendingRebuttals(db: Firestore, momentId: string, round: number): Promise<void> {
  const snap = await db.collection(`moments/${momentId}/rebuttals`).where("round", "==", round).get();
  const batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    if (d.data().verdict !== "pending") continue;
    batch.update(d.ref, { verdict: "void", confidence: null, reason: null });
    n++;
  }
  if (n) await batch.commit();
}

export async function submitRebuttal(db: Firestore, uid: string, authName: string | null, data: unknown): Promise<SubmitResponse> {
  const r = validateRebuttalRequest(data);
  const ref = db.collection("moments").doc(r.momentId);
  const m = (await ref.get()).data() as MomentDoc | undefined;
  const why = challengeableWhy(m, uid);
  if (why) throw fail("failed-precondition", why, MESSAGES[why]);

  const rateRef = db.collection("rebuttalRate").doc(uid);
  const now = Date.now();
  const rate = rateCheck((await rateRef.get()).data()?.times, now);
  if (!rate.ok) throw fail("resource-exhausted", "rate_limited", "You've sent 10 rebuttals today. Try again tomorrow.");

  const chunks = (await ref.collection("chunks").orderBy("seq").get()).docs.map((d) => d.data() as ChunkDoc);
  const facts = chainFacts(chunks);
  const clips = ((m!.videoReview as Partial<VideoReview> | undefined)?.clips ?? []).map((c) => ({ sha256: c.sha256, durationMs: c.durationMs, uploaded: c.uploaded }));
  const track = ((await db.collection("feed").doc(r.momentId).get()).data()?.track ?? []) as unknown[];
  const claims = claimsOf(m!);
  const problem = anchorProblem(r.anchor, claims.map((c) => c.id), facts, clips, track.length);
  if (problem) throw fail("invalid-argument", "bad_anchor", `That doesn't point at this Moment: ${problem}.`);

  let screen: Awaited<ReturnType<typeof runScreen>>;
  try {
    screen = await runScreen({ claim: claims.find((c) => c.id === r.anchor.claimId)!, anchor: anchorText(r.anchor, facts), text: r.text, category: r.category });
  } catch (e) {
    logger.error("rebuttal screen failed", { momentId: r.momentId, error: String(e) });
    throw fail("unavailable", "screen_failed", "Couldn't check the rebuttal right now. Try again in a minute.");
  }
  await rateRef.set({ times: [...rate.kept, now] });
  const c0 = challengeOf(m!);
  if (!screen.accepted) {
    logger.info("rebuttal screened out", { momentId: r.momentId, reason: screen.reason });
    return { accepted: false, reason: screen.reason, rebuttalId: null, count: c0?.status === "open" ? c0.accepted : 0, threshold: c0?.threshold ?? 3, reviewing: false };
  }

  const prof = (await db.collection("users").doc(uid).get()).data() ?? {};
  const by = { name: String(prof.displayName || authName || "Someone").slice(0, 80), photoURL: typeof prof.photoURL === "string" ? prof.photoURL : null };
  const rebRef = ref.collection("rebuttals").doc();
  return db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as MomentDoc | undefined;
    const again = challengeableWhy(cur, uid);
    if (again) throw fail("failed-precondition", again, MESSAGES[again]);
    const { next, reviewing } = acceptRebuttal(challengeOf(cur!), uid);
    tx.set(rebRef, {
      id: rebRef.id,
      round: next.round,
      uid,
      by,
      anchor: r.anchor,
      category: screen.category,
      text: r.text,
      draftedOnDevice: r.draftedOnDevice,
      screen: { accepted: true, reason: screen.reason },
      createdAtServer: FieldValue.serverTimestamp(),
      verdict: "pending",
      confidence: null,
      reason: null,
    });
    tx.update(ref, { challenge: next });
    tx.set(db.collection("feed").doc(r.momentId), { challenge: feedChallenge(next) }, { merge: true });
    logger.info("rebuttal accepted", { momentId: r.momentId, round: next.round, accepted: next.accepted, threshold: next.threshold, reviewing });
    return { accepted: true, reason: screen.reason, rebuttalId: rebRef.id, count: next.accepted, threshold: next.threshold, reviewing };
  });
}

export type ChallengeRun = "idle" | "busy" | "stale" | "retry" | "error" | "survived" | "overturned";

/** One re-verification of the round in review. Idempotent under the lease; failures keep the lease (the scheduler
 * retries after it expires) and count a try; the 3rd failure voids the round. */
export async function runChallenge(db: Firestore, momentId: string): Promise<ChallengeRun> {
  const ref = db.collection("moments").doc(momentId);
  const m = (await ref.get()).data() as MomentDoc | undefined;
  const c0 = m ? challengeOf(m) : null;
  if (!m || !c0 || c0.status !== "reviewing") return "idle";
  if (!(await lease(db, momentId))) return "busy";
  const round = c0.round;

  const rs = (await ref.collection("rebuttals").where("round", "==", round).get()).docs
    .map((d) => d.data() as { id: string; anchor: ReviewRebuttal["anchor"]; category: string; text: string; uid: string; by: { name: string; photoURL: string | null }; verdict: string; createdAtServer?: Timestamp })
    .filter((x) => x.verdict === "pending")
    .sort((a, b) => (a.createdAtServer?.toMillis?.() ?? 0) - (b.createdAtServer?.toMillis?.() ?? 0));
  const chunks = (await ref.collection("chunks").orderBy("seq").get()).docs.map((d) => d.data() as ChunkDoc);
  const facts = chainFacts(chunks);
  const scores = ((m.verification as { claims?: ClaimScore[] } | undefined)?.claims ?? []) as ClaimScore[];
  const claims = claimsOf(m).map((c) => ({ ...c, p: scores.find((s) => s.id === c.id)?.p ?? null }));
  const watch = clipsForReview(((m.videoReview as Partial<VideoReview> | undefined)?.clips ?? []) as ReviewClip[]);
  const bucket = watch.length ? getStorage().bucket().name : "";
  const rebuttals: ReviewRebuttal[] = rs.map((x) => ({ id: x.id, claimId: x.anchor.claimId, anchor: x.anchor, category: x.category, text: x.text }));

  let answer: Awaited<ReturnType<typeof runChallengeReview>>;
  try {
    if (rebuttals.length === 0) throw new Error("no pending rebuttals in the round");
    answer = await runChallengeReview({
      moment: m,
      facts,
      claims,
      rebuttals,
      clips: watch.map((c) => ({ ...c, gsUri: `gs://${bucket}/${clipPath(m.ownerUid, momentId, c.sha256, c.ext!)}` })),
    });
  } catch (e) {
    logger.error("challenge review failed", { momentId, round, error: String(e) });
    const voided = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as MomentDoc | undefined;
      const c = cur ? challengeOf(cur) : null;
      if (!c || c.status !== "reviewing" || c.round !== round) return false;
      const tries = (c.tries ?? 0) + 1;
      if (tries < MAX_CHALLENGE_TRIES) {
        tx.update(ref, { "challenge.tries": tries });
        return false;
      }
      const next = voidRound(c, "error", currentRoundUids(c), Date.now(), "Re-verification couldn't run");
      tx.update(ref, { challenge: next });
      tx.set(db.collection("feed").doc(momentId), { challenge: feedChallenge(next) }, { merge: true });
      return true;
    });
    if (voided) {
      await voidPendingRebuttals(db, momentId, round);
      await dropLease(db, momentId);
      return "error";
    }
    return "retry"; // lease kept: retryChallenges re-runs it after the lease expires
  }

  const o = challengeOutcome({ rebuttals: rebuttals.map((x) => ({ id: x.id, claimId: x.claimId })), claims, review: answer });
  const result = await db.runTransaction(async (tx): Promise<ChallengeRun> => {
    const cur = (await tx.get(ref)).data() as MomentDoc | undefined;
    const c = cur ? challengeOf(cur) : null;
    if (!cur || !c || c.status !== "reviewing" || c.round !== round) return "stale";
    const next: ChallengeDoc = resolveRound(c, o, answer.summary, rebuttals.length, Date.now());
    const now = FieldValue.serverTimestamp();
    const upd: Record<string, unknown> = { challenge: next };
    if (o.outcome === "overturned") {
      upd.status = "rejected";
      upd["seal.sealed"] = false;
      upd["seal.revoked"] = { at: Date.now(), round, reason: o.reason };
      upd["seal.reason"] = o.reason;
      upd["seal.updatedAt"] = now;
      if (cur.verification) {
        upd["verification.verified"] = false;
        upd["verification.updatedAtServer"] = now;
      }
    }
    tx.update(ref, upd);
    for (const x of rs) {
      const v = answer.rebuttals.find((y) => y.id === x.id);
      const verdict = storedVerdict(v);
      tx.update(ref.collection("rebuttals").doc(x.id), { verdict, confidence: v?.confidence ?? null, reason: v?.reason || null });
      tx.set(
        db.collection("rebutters").doc(x.uid),
        {
          name: x.by?.name ?? "Someone",
          photoURL: x.by?.photoURL ?? null,
          submitted: FieldValue.increment(1),
          [verdict]: FieldValue.increment(1),
          ...(o.outcome === "overturned" && verdict === "upheld" ? { overturnedMoments: FieldValue.increment(1) } : {}),
        },
        { merge: true },
      );
    }
    tx.set(
      db.collection("feed").doc(momentId),
      { challenge: feedChallenge(next), ...(o.outcome === "overturned" ? { status: "rejected", sealReason: o.reason } : {}) },
      { merge: true },
    );
    logger.info(`challenge ${o.outcome}`, { momentId, round, holding: o.holding, fallen: o.fallen, model: answer.model });
    return o.outcome;
  });
  await dropLease(db, momentId);
  return result;
}

/** Every 30 min: re-run rounds still in review whose lease expired (a failed or crashed review). */
export async function retryChallenges(db: Firestore): Promise<number> {
  const snap = await db.collection("moments").where("challenge.status", "==", "reviewing").get();
  let n = 0;
  for (const d of snap.docs) {
    const out = await runChallenge(db, d.id).catch((e) => {
      logger.error("scheduled challenge failed", { momentId: d.id, error: String(e) });
      return "error";
    });
    if (out !== "busy" && out !== "idle") n++;
  }
  logger.info("challenges retried", { reviewing: snap.size, ran: n });
  return n;
}

export type { DocumentReference };
