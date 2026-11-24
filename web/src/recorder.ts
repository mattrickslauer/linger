// The live session engine: sensors -> 5 s hash-chained chunks -> Firestore (offline-first).
// Firestore writes are never awaited: with persistent cache they land in IndexedDB at once and the SDK
// replays them in order when the network returns. Each one is first journaled (awaited) to the raw vault
// (vault.ts), so this browser keeps its own copy until the server provably has every chunk. Order matters for the security rules: the last
// chunk is queued before the moment flips to "submitted".

import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { judgeAndSkeptic, liveCheck } from "./ai";
import { makeChunk } from "./chain";
import { db } from "./firebase";
import { computeSummary, decodeChunks, trackDistanceM } from "./geo";
import type { AppEvent, Category, CheckMode, Chunk, GpsRow, LiveCheck, MotionRow } from "./types";
import { journalChunk, journalMoment, journalMomentUpdate, verifyAll } from "./vault";

export const CHUNK_MS = 5000;
export const pad6 = (n: number) => String(n).padStart(6, "0");

export interface LiveState {
  elapsedMs: number;
  distanceM: number;
  gps: GpsRow | null;
  gpsError: string | null;
  motionOn: boolean;
  motionTail: number[]; // last ~6 s of |a|
  chunks: number;
  frames: number;
  coach: (LiveCheck & { pending?: boolean }) | null;
  checks: number;
  retakes: number;
  modes: Record<CheckMode, number>;
  queued: number;
  online: boolean;
  vaultError: string | null; // a raw-vault journal write failed: nothing more is written
}

function deviceInfo() {
  const ua = navigator as unknown as { userAgentData?: { brands: { brand: string; version: string }[]; platform?: string } };
  const b = ua.userAgentData?.brands.find((x) => !/Not.?A.?Brand|Chromium/i.test(x.brand));
  const model = b ? `${b.brand} ${b.version}` : (navigator.userAgent.match(/(Firefox|Safari|Chrome)\/\d+/)?.[0] ?? "Browser");
  return { model, os: ua.userAgentData?.platform || navigator.platform || "web", appVersion: "1.0.0" };
}

export class Session {
  readonly id = crypto.randomUUID();
  readonly startedAt = Date.now();
  private seq = 0;
  private lastT = this.startedAt;
  private prevHash: string | null = null;
  private gps: GpsRow[] = [];
  private motion: MotionRow[] = [];
  private events: AppEvent[] = [{ t: this.startedAt, type: "start" }];
  private allGps: GpsRow[] = [];
  readonly chunks: Chunk[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private checking = false;
  private watchId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMotionT = 0;
  private pending = new Set<number>();
  private heroSeq: number | null = null;
  state: LiveState;
  onChange: (s: LiveState) => void = () => {};

  constructor(
    private user: User,
    readonly intention: string,
    readonly category: Category,
  ) {
    this.state = {
      elapsedMs: 0,
      distanceM: 0,
      gps: null,
      gpsError: null,
      motionOn: false,
      motionTail: [],
      chunks: 0,
      frames: 0,
      coach: null,
      checks: 0,
      retakes: 0,
      modes: { on_device: 0, cloud: 0, none: 0 },
      queued: 0,
      online: navigator.onLine,
      vaultError: null,
    };
  }

  private emit(patch: Partial<LiveState> = {}) {
    this.state = { ...this.state, ...patch, elapsedMs: Date.now() - this.startedAt, online: navigator.onLine };
    this.onChange(this.state);
  }

  /** Journals and queues the moment create; rejects if the raw vault can't be written. */
  async start() {
    if (!db) throw new Error("Firebase is not configured");
    const ref = doc(db, "moments", this.id);
    const fields = {
      ownerUid: this.user.uid,
      owner: { name: this.user.displayName || "Anonymous", photoURL: this.user.photoURL ?? null },
      intention: { text: this.intention.slice(0, 200), category: this.category },
      platform: "web",
      device: deviceInfo(),
      status: "recording",
      startedAt: this.startedAt,
      endedAt: null,
      chunkCount: 0,
      headHash: null,
      summary: null,
      onDevice: { mode: "none", checks: 0, retakes: 0 },
      judge: null,
      skeptic: null,
      seal: null,
      createdAtServer: serverTimestamp(),
      submittedAtServer: null,
    };
    // Journal first, inside the write queue so the create still precedes every chunk.
    const create = this.queue.then(async () => {
      await journalMoment(this.id, fields);
      setDoc(ref, fields).catch((e) => console.error("moment create failed", e));
    });
    this.queue = create;
    await create;

    // Sync badge: a write's promise resolves only once the server acknowledges it, so chunks
    // written but not yet acknowledged are the ones still queued on this device.

    if ("geolocation" in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (p) => {
          const c = p.coords;
          const row: GpsRow = [p.timestamp || Date.now(), c.latitude, c.longitude, c.accuracy, c.altitude ?? null, c.speed ?? null];
          this.gps.push(row);
          this.allGps.push(row);
          this.emit({ gps: row, gpsError: null, distanceM: trackDistanceM(this.allGps) });
        },
        (e) => this.emit({ gpsError: e.message || "Location unavailable" }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
    } else this.state.gpsError = "No location on this device";

    window.addEventListener("devicemotion", this.onMotion);
    window.addEventListener("online", this.onNet);
    window.addEventListener("offline", this.onNet);
    this.timer = setInterval(() => {
      if (!this.checking && Date.now() - this.lastT >= CHUNK_MS) this.close();
      else this.emit();
    }, 1000);
    this.emit();
  }

  private onNet = () => this.emit();

  private onMotion = (e: DeviceMotionEvent) => {
    const t = Date.now();
    if (t - this.lastMotionT < 100) return; // 10 Hz
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    this.lastMotionT = t;
    const r = e.rotationRate;
    const d2r = Math.PI / 180;
    const row: MotionRow = [t, a.x ?? 0, a.y ?? 0, a.z ?? 0, (r?.alpha ?? 0) * d2r, (r?.beta ?? 0) * d2r, (r?.gamma ?? 0) * d2r].map((v, i) =>
      i === 0 ? v : Math.round(v * 1000) / 1000,
    ) as MotionRow;
    this.motion.push(row);
    const tail = [...this.state.motionTail, Math.hypot(row[1], row[2], row[3])].slice(-60);
    this.state = { ...this.state, motionOn: true, motionTail: tail };
  };

  /** Close the open chunk. Serialised so every chunk sees its predecessor's hash. */
  private close(extra: { frame?: Chunk["frame"]; frameSha?: string | null; check?: LiveCheck | null; events?: AppEvent[] } = {}) {
    const t1 = Math.max(Date.now(), this.lastT);
    const t0 = this.lastT;
    this.lastT = t1;
    const payload = {
      gps: this.gps.splice(0),
      motion: this.motion.splice(0),
      events: [...this.events.splice(0), ...(extra.events ?? [])],
      frameSha: extra.frameSha ?? null,
      check: extra.check ?? null,
    };
    const seq = this.seq++;
    const job = this.queue.then(async () => {
      const c = await makeChunk(this.id, seq, t0, t1, this.prevHash, payload, extra.frame ?? null);
      this.prevHash = c.hash;
      await journalChunk(this.id, c); // raw vault first; throws (and stops the queue) rather than skip
      this.chunks.push(c);
      this.pending.add(seq);
      setDoc(doc(db!, "moments", this.id, "chunks", pad6(seq)), c).then(
        () => {
          this.pending.delete(seq);
          this.emit({ queued: this.pending.size });
        },
        (e) => console.error("chunk write failed", seq, e),
      );
      this.state = { ...this.state, queued: this.pending.size };
      this.emit({ chunks: this.chunks.length });
    });
    this.queue = job;
    job.catch((e) => {
      console.error("raw vault journal write failed", seq, e);
      this.emit({ vaultError: String((e as Error)?.message ?? e) });
    });
    return job;
  }

  /** Proof shot: on-device coach first, then the frame and its verdict close a chunk together. */
  async proofShot(jpegB64: string, frameSha: string, w: number, h: number): Promise<LiveCheck> {
    const t = Date.now();
    this.checking = true;
    this.emit({ coach: { ok: true, reason: "Checking…", label: "", mode: "none", pending: true } });
    const res = await liveCheck(this.intention, jpegB64);
    const check: LiveCheck = { ok: res.ok, reason: res.reason, mode: res.mode, label: res.label };
    const events: AppEvent[] = [
      { t, type: "frame" },
      { t: Date.now(), type: "check", ok: check.ok, mode: check.mode },
    ];
    if (!check.ok) events.push({ t: Date.now(), type: "retake", reason: check.reason });
    this.checking = false;
    const seqOfFrame = this.seq;
    await this.close({ frame: { jpegB64, w, h, t }, frameSha, check, events });
    if (check.ok) this.heroSeq = seqOfFrame;
    this.emit({
      coach: check,
      frames: this.state.frames + 1,
      checks: this.state.checks + (check.mode === "none" ? 0 : 1),
      retakes: this.state.retakes + (check.ok ? 0 : 1),
      modes: { ...this.state.modes, [check.mode]: this.state.modes[check.mode] + 1 },
    });
    return check;
  }

  private stopSensors() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener("devicemotion", this.onMotion);
    window.removeEventListener("online", this.onNet);
    window.removeEventListener("offline", this.onNet);
  }

  dispose() {
    this.stopSensors();
  }

  /** Stop, write the final chunk, then submit. Resolves once queued locally (works offline). */
  async finish(): Promise<void> {
    this.stopSensors();
    const end = Date.now();
    await this.close({ events: [{ t: end, type: "stop" }] });
    await this.queue;
    const endedAt = Math.max(end, this.lastT);
    const m = this.state.modes;
    const mode: CheckMode = m.on_device > 0 ? "on_device" : m.cloud > 0 ? "cloud" : "none";
    const submit = {
      status: "submitted",
      endedAt,
      chunkCount: this.chunks.length,
      headHash: this.prevHash,
      summary: computeSummary(this.startedAt, endedAt, this.chunks, this.heroSeq),
      onDevice: { mode, checks: this.state.checks, retakes: this.state.retakes },
      submittedAtServer: serverTimestamp(),
    };
    await journalMomentUpdate(this.id, submit);
    updateDoc(doc(db!, "moments", this.id), submit).catch((e) => console.error("submit failed", e));
    void verifyAll();
  }

  framesForJudge() {
    return decodeChunks(this.chunks).frames;
  }
}

/** Judge + skeptic (cloud, via AI Logic) for a submitted Moment, then write both opinions. */
export async function runCloudReview(momentId: string, moment: Parameters<typeof judgeAndSkeptic>[0], frames: { seq: number; t: number; jpegB64: string }[]) {
  const { judge, skeptic } = await judgeAndSkeptic(moment, frames);
  await updateDoc(doc(db!, "moments", momentId), { judge, skeptic });
  return { judge, skeptic };
}

/** Grab a proof frame from a playing <video>: longest side 640 px, JPEG q0.6, under ~120 KB base64. */
export function captureFrame(video: HTMLVideoElement): { jpegB64: string; w: number; h: number } {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const s = 640 / Math.max(vw, vh);
  const w = Math.round(vw * Math.min(1, s));
  const h = Math.round(vh * Math.min(1, s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(video, 0, 0, w, h);
  let q = 0.6;
  let b64 = c.toDataURL("image/jpeg", q).split(",")[1];
  while (b64.length > 120_000 && q > 0.3) {
    q -= 0.1;
    b64 = c.toDataURL("image/jpeg", q).split(",")[1];
  }
  return { jpegB64: b64, w, h };
}
