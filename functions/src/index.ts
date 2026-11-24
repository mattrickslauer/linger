// Verified Cloud Functions: the deterministic seal.
// AI proposes (judge + skeptic written by the client via Firebase AI Logic); this code decides.
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Transaction } from "firebase-admin/firestore";
import { logger, setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { ChunkDoc, MomentDoc, SEAL_VERSION, evaluateSeal, isReadyToSeal } from "./seal";

initializeApp();
setGlobalOptions({ maxInstances: 10 });
const db = getFirestore();

export type SealOutcome = "sealed" | "rejected" | "not-ready" | "waiting-for-chunks" | "already-sealed" | "missing";

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
    const status = r.sealed ? "sealed" : "rejected";
    const hero = r.heroFrameSeq == null ? null : chunks.find((c) => c.seq === r.heroFrameSeq)?.frame?.jpegB64 ?? null;
    const now = FieldValue.serverTimestamp();

    tx.update(ref, {
      status,
      seal: { sealed: r.sealed, at: now, checks: r.checks, reason: r.reason, version: SEAL_VERSION },
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
      heroJpegB64: hero,
      track: r.track.map(([lat, lng]) => ({ lat, lng })),
      sealedAtServer: now,
    });
    logger.info(`moment ${status}`, { momentId, checks: r.checks, failures: r.failures });
    return status;
  });
}

export const onMomentWritten = onDocumentWritten("moments/{momentId}", async (event) => {
  const after = event.data?.after?.data() as MomentDoc | undefined;
  if (!isReadyToSeal(after)) return;
  await trySeal(event.params.momentId);
});

export const onChunkWritten = onDocumentCreated("moments/{momentId}/chunks/{seq}", async (event) => {
  // Late (offline-tail) chunks: once the last one arrives the moment may become sealable.
  await trySeal(event.params.momentId);
});
