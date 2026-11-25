// Raw vault: this browser's own copy of every Moment's raw data, kept until the server provably has all of it.
// Contract: docs/ARCHITECTURE.md "Raw vault"; reference implementation android/.../data/Vault.kt.
//
// The Firestore cache is not a backup: if the server loses a document, the cache simply records that it is gone.
// So every write goes to IndexedDB first (its own awaited transaction), then to Firestore:
//   moments  keyPath "id"              the moment fields as created, then merged with the submit fields
//   chunks   keyPath ["momentId","seq"] seq, t0, t1, prevHash, payload, hash, frame: the exact hashed bytes
// verifyAll() reads each submitted Moment back FROM THE SERVER (never the cache), re-uploads anything missing (the
// whole Moment if the server lost it), and deletes the local copy only when compareVault() finds no problem.
// Offline, an error, or any mismatch: the local copy stays.
// Deleted Moments (docs/ARCHITECTURE.md "Deleting a Moment"): forgetMoment() drops the journal before the Firestore
// delete, and a Moment missing on the server is re-created only when it has no deleted/{id} tombstone.

import { useSyncExternalStore } from "react";
import {
  collection,
  doc,
  FieldValue,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
  waitForPendingWrites,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Chunk } from "./types";
import { compareVault, type VaultChunk } from "./vaultCheck";

const pad6 = (n: number) => String(n).padStart(6, "0");

export type VaultState = "waiting" | "repairing" | "conflict";
type Fields = Record<string, unknown>;
type StoredMoment = Fields & { id: string };
type StoredChunk = Chunk & { momentId: string };

const SUBMIT_FIELDS = ["status", "endedAt", "chunkCount", "headHash", "summary", "onDevice", "submittedAtServer"];
const enabled = () => typeof indexedDB !== "undefined" && db != null;

// ---------------------------------------------------------------- held state (id -> why it is still here)

let held: Record<string, VaultState> = {};
const listeners = new Set<() => void>();
function setHeld(next: Record<string, VaultState>) {
  held = next;
  listeners.forEach((l) => l());
}
const mark = (id: string, s: VaultState) => setHeld({ ...held, [id]: s });
const unmark = (id: string) => {
  const { [id]: _, ...rest } = held;
  setHeld(rest);
};

export const vaultHeld = () => held;
export function subscribeVault(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Moments still kept in this browser, with why. Empty = everything is safely on the server. */
export const useVaultHeld = () => useSyncExternalStore(subscribeVault, vaultHeld, vaultHeld);

// ---------------------------------------------------------------- IndexedDB

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("verified-vault", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("moments", { keyPath: "id" });
      r.result.createObjectStore("chunks", { keyPath: ["momentId", "seq"] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("vault: could not open IndexedDB"));
    r.onblocked = () => reject(new Error("vault: IndexedDB open blocked"));
  }).catch((e) => {
    dbp = null;
    throw e;
  }));
}

/** One transaction, resolved only when it commits (durability "strict": flushed to disk). */
async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const d = await open();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(stores, mode, { durability: "strict" });
    const req = fn(t);
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error ?? new Error("vault: transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("vault: transaction aborted"));
  });
}

const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

/** Drop serverTimestamp() and other sentinels: the journal stores only real values. */
function plain(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) if (!(v instanceof FieldValue)) out[k] = v;
  return out;
}

let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  // Best effort: ask the browser not to evict the vault under storage pressure.
  navigator.storage?.persist?.().catch(() => false);
}

// ---------------------------------------------------------------- journal (called by recorder.ts before each Firestore write)
// Each throws rather than silently skipping: a Moment that isn't journaled must not be written.

export async function journalMoment(id: string, fields: Fields): Promise<void> {
  if (!enabled()) return;
  askPersist();
  await tx(["moments"], "readwrite", (t) => t.objectStore("moments").put({ ...plain(fields), id }));
  mark(id, "waiting");
}

export async function journalMomentUpdate(id: string, fields: Fields): Promise<void> {
  if (!enabled()) return;
  const d = await open();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction(["moments"], "readwrite", { durability: "strict" });
    const s = t.objectStore("moments");
    const g = s.get(id);
    g.onsuccess = () => s.put({ ...((g.result as Fields | undefined) ?? {}), ...plain(fields), id });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("vault: transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("vault: transaction aborted"));
  });
}

export async function journalChunk(id: string, c: Chunk): Promise<void> {
  if (!enabled()) return;
  const rec: StoredChunk = {
    momentId: id,
    seq: c.seq,
    t0: c.t0,
    t1: c.t1,
    prevHash: c.prevHash,
    payload: c.payload,
    hash: c.hash,
    frame: c.frame ? { jpegB64: c.frame.jpegB64, w: c.frame.w, h: c.frame.h, t: c.frame.t } : null,
  };
  await tx(["chunks"], "readwrite", (t) => t.objectStore("chunks").put(rec));
}

const allMoments = () => tx<StoredMoment[]>(["moments"], "readonly", (t) => t.objectStore("moments").getAll() as IDBRequest<StoredMoment[]>);
const chunksOf = (id: string) =>
  tx<StoredChunk[]>(["chunks"], "readonly", (t) => t.objectStore("chunks").getAll(chunkRange(id)) as IDBRequest<StoredChunk[]>);
const forget = (id: string) =>
  tx(["moments", "chunks"], "readwrite", (t) => {
    t.objectStore("moments").delete(id);
    t.objectStore("chunks").delete(chunkRange(id));
  });

// Moments the owner deleted in this tab. A vault pass that already read the journal before the delete must not
// re-create or upload them (the server's deleted/{id} tombstone may not exist yet).
const deletedHere = new Set<string>();

/**
 * The owner is deleting this Moment: drop this browser's raw copy (IndexedDB moment + chunks) and its held state,
 * so the vault can never re-upload it. Called BEFORE the Firestore delete; throws if the journal can't be cleared.
 */
export async function forgetMoment(id: string): Promise<void> {
  deletedHere.add(id);
  if (enabled()) await forget(id);
  unmark(id);
}

class Deleted extends Error {}
const stopIfDeleted = (id: string) => {
  if (deletedHere.has(id)) throw new Deleted(id);
};

// ---------------------------------------------------------------- verification

let running: Promise<void> | null = null;
let again = false;

/** Checks every held Moment against the server. Safe to call often; one pass at a time. */
export function verifyAll(): Promise<void> {
  if (!enabled()) return Promise.resolve();
  if (running) {
    again = true; // something changed mid-pass (e.g. a submit): run once more afterwards
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await pass().catch((e) => console.warn("vault: pass failed, keeping everything", e));
    } while (again);
  })().finally(() => (running = null));
  return running;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

async function pass() {
  const moments = await allMoments();
  // Reflect the journal in the held state (e.g. on first run after a reload), keeping known states.
  const next: Record<string, VaultState> = {};
  for (const m of moments) if (!deletedHere.has(m.id)) next[m.id] = held[m.id] ?? "waiting";
  setHeld(next);

  const uid = auth?.currentUser?.uid;
  if (!uid || !moments.length || !navigator.onLine) return;
  // Let this tab's own queued writes land first, so we never race them with a "repair" of the same docs.
  await withTimeout(waitForPendingWrites(db!), 15_000);

  for (const m of moments) {
    if (deletedHere.has(m.id)) continue;
    let ok = false;
    try {
      ok = await verify(m, uid);
    } catch (e) {
      if (e instanceof Deleted) continue; // deleted by the owner mid-pass: forgetMoment() already dropped it
      console.warn(`vault: verify ${m.id}`, e); // offline or any error: keep
    }
    if (ok) {
      await forget(m.id);
      unmark(m.id);
      console.info(`vault: verified on server, local copy removed: ${m.id}`);
    }
  }
}

const toVaultChunk = (c: Partial<Chunk> | undefined): VaultChunk => ({
  seq: typeof c?.seq === "number" ? c.seq : -1,
  hash: c?.hash ?? "",
  payload: c?.payload ?? "",
  frameB64: c?.frame?.jpegB64 ?? null,
});

/** True only when the server provably has everything. Throws when the server can't be reached. */
async function verify(local: StoredMoment, uid: string): Promise<boolean> {
  const id = local.id;
  if (local.ownerUid !== uid) return false; // another account's Moment: keep, don't touch
  if (local.status !== "submitted") return false; // still recording
  const localChunks = (await chunksOf(id)).sort((a, b) => a.seq - b.seq);
  const chunkCount = local.chunkCount as number;
  if (localChunks.length !== chunkCount) {
    console.error(`vault: ${id}: journal has ${localChunks.length} chunks, moment says ${chunkCount}; keeping`);
    mark(id, "conflict");
    return false;
  }

  const ref = doc(db!, "moments", id);
  const chunksCol = collection(ref, "chunks");
  let server = await getDocFromServer(ref);
  if (!server.exists()) {
    // Deleted by the owner (maybe on another device)? onMomentDeleted leaves deleted/{id}: drop, never re-create.
    const tomb = await getDocFromServer(doc(db!, "deleted", id));
    stopIfDeleted(id);
    if (tomb.exists()) {
      console.info(`vault: ${id}: deleted by its owner, dropping the local copy`);
      await forgetMoment(id);
      throw new Deleted(id);
    }
    mark(id, "repairing");
    console.warn(`vault: ${id}: missing on server, re-creating from the journal`);
    const { id: _id, ...create } = local as Fields;
    for (const k of SUBMIT_FIELDS) delete create[k];
    Object.assign(create, { status: "recording", seal: null, judge: null, skeptic: null, score: null, createdAtServer: serverTimestamp() });
    stopIfDeleted(id);
    await setDoc(ref, create);
    server = await getDocFromServer(ref);
  }

  const onServer = new Set((await getDocsFromServer(chunksCol)).docs.map((d) => d.get("seq") as number));
  const missing = localChunks.filter((c) => !onServer.has(c.seq));
  if (missing.length) {
    mark(id, "repairing");
    console.warn(`vault: ${id}: uploading ${missing.length} missing chunk(s)`);
    // Chunks may be added while recording, or after submit when seq < chunkCount (firestore.rules).
    // Only missing ones: chunks are append-only, an existing one is never overwritten.
    for (const { momentId: _m, ...c } of missing) {
      stopIfDeleted(id);
      await setDoc(doc(chunksCol, pad6(c.seq)), c);
    }
  }
  if (server.get("status") === "recording") {
    const submit: Fields = {};
    for (const k of SUBMIT_FIELDS) submit[k] = k === "submittedAtServer" ? serverTimestamp() : (local[k] ?? null);
    stopIfDeleted(id);
    await updateDoc(ref, submit);
  }

  // Read everything back from the server and compare with the journal, byte for byte where it matters.
  const m = await getDocFromServer(ref);
  const back = await getDocsFromServer(chunksCol);
  const problems = compareVault(
    (local.headHash as string | null) ?? null,
    chunkCount,
    m.get("headHash") as string | null | undefined,
    m.get("chunkCount") as number | null | undefined,
    m.get("status") as string | null | undefined,
    localChunks.map(toVaultChunk),
    back.docs.map((d) => toVaultChunk(d.data() as Partial<Chunk>)),
  );
  stopIfDeleted(id);
  if (problems.length) {
    console.error(`vault: ${id}: server copy differs from the journal, keeping local copy:`, problems.slice(0, 5));
    mark(id, "conflict");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- schedule: start, sign-in, every ~30 s

let started = false;
/** Called once by the app: verify on start, on every sign-in, and every 30 s while the page is open. */
export function startVault() {
  if (started || !enabled() || !auth) return;
  started = true;
  const run = () => void verifyAll();
  run();
  auth.onAuthStateChanged((u) => u && run());
  setInterval(run, 30_000);
  window.addEventListener("online", run);
}
