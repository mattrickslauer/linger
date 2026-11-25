// v4.4 clip upload at submit: every chained `video` clip goes to clips/{uid}/{momentId}/{sha256}.{ext} BEFORE the
// Moment is marked submitted, so the server's free video review judges the clip itself, not one frame of it.
// Idempotent: getMetadata first (the owner may `get`), an existing object is skipped (storage.rules: create once).
// Callers: the raw vault's submit path (vault.ts verify(): after the chunks, before the submit fields; also the guest
// claim and the re-create path) and the full_video ladder module. Offline or failing: it throws, submit waits, the
// vault retries every 30 s. A clip >= 200 MB is not uploaded (its requirements stay unmet) and submit proceeds.

import { useSyncExternalStore } from "react";
import { connectStorageEmulator, getMetadata, getStorage, ref, uploadBytesResumable, type FirebaseStorage } from "firebase/storage";
import { app, USE_EMULATORS } from "./firebase";
import type { Chunk } from "./types";
import { clipExt, factsOf, MAX_CLIP_BYTES } from "./v4";
import { clipsOf } from "./vault";

let storage: FirebaseStorage | null = null;
export function bucket(): FirebaseStorage {
  if (!app) throw new Error("Firebase is not configured");
  if (!storage) {
    storage = getStorage(app);
    if (USE_EMULATORS) connectStorageEmulator(storage, import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1", Number(import.meta.env.VITE_STORAGE_EMULATOR_PORT || 9199));
  }
  return storage;
}

export const clipPath = (uid: string, momentId: string, sha: string, mime: string) => `clips/${uid}/${momentId}/${sha}.${clipExt(mime)}`;

// ---------------------------------------------------------------- progress, per Moment (finish screen, detail, Me)

export interface UploadState {
  phase: "uploading" | "done" | "failed";
  /** bytes already on the server (uploaded now or found there) / bytes to upload */
  sent: number;
  total: number;
  clips: number;
  /** chained clips this browser doesn't hold (recorded elsewhere, or the vault lost them) */
  missing: number;
  /** clips too large to upload (>= 200 MB) */
  tooLarge: number;
  error?: string;
}
let states: Record<string, UploadState> = {};
const listeners = new Set<() => void>();
function set(id: string, s: UploadState) {
  states = { ...states, [id]: s };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => states;
export function useClipUpload(momentId: string | null | undefined): UploadState | null {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return momentId ? (all[momentId] ?? null) : null;
}

/** "Uploading video · 34 MB" (v4.11 words). */
export function uploadText(u: UploadState | null): string | null {
  if (!u) return null;
  const mb = (b: number) => (b / 1e6 >= 10 ? Math.round(b / 1e6) : Math.round(b / 1e5) / 10);
  if (u.phase === "uploading") return `Uploading video · ${mb(u.total)} MB${u.sent > 0 && u.total > 0 ? ` · ${Math.round((u.sent / u.total) * 100)}%` : ""}`;
  if (u.phase === "failed") return `Video upload paused · retrying when online`;
  return u.clips > 0 ? "Video uploaded" : null;
}

// ---------------------------------------------------------------- the upload

const inFlight = new Map<string, Promise<UploadState>>();

/**
 * Uploads every chained clip of this Moment that this browser holds and the server doesn't. Resolves when all of them
 * are in Storage (or can't be: too large / not on this device). Throws if an upload fails: the caller must not submit.
 * Concurrent calls for the same Moment share one run.
 */
export function uploadMomentClips(uid: string, momentId: string, chunks: Pick<Chunk, "payload">[]): Promise<UploadState> {
  const running = inFlight.get(momentId);
  if (running) return running;
  const p = run(uid, momentId, chunks).finally(() => inFlight.delete(momentId));
  inFlight.set(momentId, p);
  return p;
}

async function run(uid: string, momentId: string, chunks: Pick<Chunk, "payload">[]): Promise<UploadState> {
  const chained = factsOf(chunks).clips;
  if (!chained.length) return { phase: "done", sent: 0, total: 0, clips: 0, missing: 0, tooLarge: 0 };
  const stored = await clipsOf(momentId);
  const jobs = chained.map((c) => stored.find((s) => s.sha256 === c.sha256) ?? null);
  const ok = jobs.filter((j): j is NonNullable<typeof j> => !!j && j.bytes < MAX_CLIP_BYTES);
  const st: UploadState = {
    phase: "uploading",
    sent: 0,
    total: ok.reduce((a, j) => a + j.bytes, 0),
    clips: chained.length,
    missing: jobs.filter((j) => !j).length,
    tooLarge: jobs.filter((j) => j && j.bytes >= MAX_CLIP_BYTES).length,
  };
  set(momentId, { ...st });
  try {
    for (const clip of ok) {
      const r = ref(bucket(), clipPath(uid, momentId, clip.sha256, clip.mime));
      if (await exists(r)) {
        st.sent += clip.bytes;
        set(momentId, { ...st });
        continue;
      }
      const base = st.sent;
      // Sequential, resumable (v4.4): one clip at a time keeps a phone's uplink usable.
      const task = uploadBytesResumable(r, clip.blob, { contentType: clip.mime.split(";")[0] || "video/webm" });
      await new Promise<void>((resolve, reject) =>
        task.on(
          "state_changed",
          (s) => set(momentId, { ...st, sent: base + s.bytesTransferred }),
          reject,
          () => resolve(),
        ),
      );
      st.sent = base + clip.bytes;
      set(momentId, { ...st });
    }
    const done: UploadState = { ...st, phase: "done" };
    set(momentId, done);
    return done;
  } catch (e) {
    set(momentId, { ...st, phase: "failed", error: String((e as Error)?.message ?? e) });
    throw e;
  }
}

async function exists(r: ReturnType<typeof ref>): Promise<boolean> {
  try {
    await getMetadata(r);
    return true;
  } catch (e) {
    if ((e as { code?: string })?.code === "storage/object-not-found") return false;
    throw e;
  }
}
