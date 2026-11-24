// Read side. Every reader goes through here so fixture mode (VITE_FIXTURES=true) can swap in sample data.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db, FIXTURES } from "./firebase";
import type { Chunk, FeedEntry, Moment } from "./types";

const millis = (v: unknown): number | null =>
  v && typeof (v as Timestamp).toMillis === "function" ? (v as Timestamp).toMillis() : typeof v === "number" ? v : null;

let fixturePromise: Promise<import("./fixtures").FixtureSet> | null = null;
const fixtures = () => (fixturePromise ??= import("./fixtures").then((m) => m.buildFixtures()));

export function subscribeFeed(cb: (entries: FeedEntry[]) => void, onError: (e: Error) => void): () => void {
  if (FIXTURES) {
    let live = true;
    fixtures().then((f) => live && cb(f.feed), onError);
    return () => {
      live = false;
    };
  }
  if (!db) {
    onError(new Error("Firebase is not configured. Set web/.env.local or run with VITE_FIXTURES=true."));
    return () => {};
  }
  const q = query(collection(db, "feed"), orderBy("sealedAtServer", "desc"), limit(60));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as FeedEntry), momentId: d.id, sealedAtServer: millis(d.get("sealedAtServer")) }))),
    onError,
  );
}

export interface MomentBundle {
  feed: FeedEntry | null;
  moment: Moment | null;
}

export async function getMomentBundle(id: string): Promise<MomentBundle> {
  if (FIXTURES) {
    const f = await fixtures();
    return { feed: f.feed.find((e) => e.momentId === id) ?? null, moment: f.moments[id] ?? null };
  }
  if (!db) throw new Error("Firebase is not configured");
  const [feedSnap, momentSnap] = await Promise.all([
    getDoc(doc(db, "feed", id)).catch(() => null),
    getDoc(doc(db, "moments", id)).catch(() => null), // unreadable until sealed unless you own it
  ]);
  const feed = feedSnap?.exists()
    ? ({ ...(feedSnap.data() as FeedEntry), momentId: id, sealedAtServer: millis(feedSnap.get("sealedAtServer")) } as FeedEntry)
    : null;
  const moment = momentSnap?.exists() ? ({ ...(momentSnap.data() as Moment), id } as Moment) : null;
  return { feed, moment };
}

/** All chunks of a Moment, ordered by seq. `fresh` bypasses the local cache (used by re-verify). */
export async function getChunks(id: string, fresh = false): Promise<Chunk[]> {
  if (FIXTURES) return (await fixtures()).chunks[id] ?? [];
  if (!db) throw new Error("Firebase is not configured");
  const col = collection(db, "moments", id, "chunks");
  const snap = fresh ? await getDocsFromServer(col).catch(() => getDocs(col)) : await getDocs(col);
  return snap.docs.map((d) => d.data() as Chunk).sort((a, b) => a.seq - b.seq);
}

export function subscribeMyMoments(uid: string, cb: (m: Moment[]) => void, onError: (e: Error) => void): () => void {
  if (!db) return () => {};
  // No orderBy: avoids a composite index; a person has few Moments, so sort locally.
  const q = query(collection(db, "moments"), where("ownerUid", "==", uid), limit(100));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) =>
      cb(
        snap.docs
          .map((d) => ({ ...(d.data() as Moment), id: d.id, pending: d.metadata.hasPendingWrites }) as Moment)
          .sort((a, b) => b.startedAt - a.startedAt),
      ),
    onError,
  );
}
