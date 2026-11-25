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

/** Firestore can't store nested arrays, so the backend writes feed.track as [{lat,lng}]; the UI uses [lat,lng]. */
export function normalizeTrack(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const out: [number, number][] = [];
  for (const p of raw) {
    const lat = Array.isArray(p) ? p[0] : (p as { lat?: unknown })?.lat;
    const lng = Array.isArray(p) ? p[1] : (p as { lng?: unknown })?.lng;
    if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
  }
  return out;
}

const toFeedEntry = (id: string, data: Record<string, unknown>, sealedAt: unknown): FeedEntry =>
  ({ ...(data as unknown as FeedEntry), momentId: id, sealedAtServer: millis(sealedAt), track: normalizeTrack(data.track) }) as FeedEntry;

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
    (snap) => cb(snap.docs.map((d) => toFeedEntry(d.id, d.data(), d.get("sealedAtServer")))),
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
    ? toFeedEntry(id, feedSnap.data(), feedSnap.get("sealedAtServer"))
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

/**
 * Sample-data builds only (credits.ts `?ladder=demo`): apply a simulated ladder result to the in-memory fixtures the
 * way runLadderModule would on the server (verification, seal.checks.bar, status, feed), so the page can re-read it.
 */
export async function applyFixtureLadder(id: string, r: import("./types").LadderResult & { score: number; verified: boolean; status: "sealed" | "rejected" }) {
  if (!FIXTURES) return;
  const f = await fixtures();
  const m = f.moments[id];
  if (!m?.verification || !m.seal) return;
  const { score, verified, status, ...result } = r;
  const modules = [...m.verification.modules, result];
  m.verification = { ...m.verification, score, verified, modules };
  const checks = { ...m.seal.checks, bar: verified };
  const sealed = Object.values(checks).every(Boolean);
  m.seal = { ...m.seal, checks, sealed, reason: sealed ? "Every check passed; the score now clears the bar." : m.seal.reason };
  m.status = status;
  const e = f.feed.find((x) => x.momentId === id);
  if (e) {
    Object.assign(e, {
      verificationScore: score,
      checks,
      status: sealed ? "sealed" : "rejected",
      sealReason: m.seal.reason,
      ladder: modules.map((x) => ({ module: x.module, title: x.title, passed: x.passed, before: x.before, after: x.after, reasons: x.reasons.slice(0, 2) })),
    });
  }
}

/**
 * Sample-data builds only, v4 Moments: the simulated runLadderModule (v4.6). The module's per-claim verdicts join the
 * Moment's ladder and EVERY claim is recomputed with scoreV4 from the seal, as the function does. Returns the result
 * row, or null when the Moment isn't a v4 sample.
 */
export async function applyFixtureLadderV4(
  id: string,
  mod: { module: import("./types").ModuleId; title: string; cost: number; strength: number; backs: string[]; backsTargetedOnly?: boolean },
  verdicts: { id: string; verdict: "backed" | "not_backed" | "unclear"; confidence: number; reasons: string[] }[],
  meta: { runId: string; confidence: number; reasons: string[] },
) {
  if (!FIXTURES) return null;
  const f = await fixtures();
  const { FIXTURE_V4_INPUTS, applyV4Result } = await import("./fixtures");
  const { scoreV4 } = await import("./v4");
  const m = f.moments[id];
  const input = FIXTURE_V4_INPUTS[id];
  if (!m || !input) return null;
  input.ladder = [...(input.ladder ?? []), { module: mod.module, strength: mod.strength, backs: mod.backs, claims: verdicts, targetedOnly: mod.backsTargetedOnly }];
  const r = scoreV4(input);
  const step = r.ladder[r.ladder.length - 1];
  const modules = [...(m.verification?.modules ?? [])];
  const result: import("./types").LadderResult = {
    runId: meta.runId,
    module: mod.module,
    title: mod.title,
    cost: mod.cost,
    strength: mod.strength,
    passed: step.passed,
    confidence: meta.confidence,
    before: step.before,
    after: step.after,
    reasons: meta.reasons,
    model: "simulated",
    ranAt: Date.now(),
    claims: step.claims.map((c) => {
      const v = verdicts.find((x) => x.id === c.id);
      return { id: c.id, verdict: v?.verdict ?? "missing", confidence: v?.confidence ?? 0, passed: c.passed, before: c.before, after: c.after, reasons: (v?.reasons ?? []).slice(0, 2) };
    }),
  };
  modules.push(result);
  applyV4Result(m, f.feed.find((x) => x.momentId === id), input, modules);
  return { result, score: r.score, verified: r.verified, status: m.status as "sealed" | "rejected", claimScores: r.claims, claimsBacked: r.claimsBacked };
}
