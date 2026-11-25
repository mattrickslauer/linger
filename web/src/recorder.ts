// The live session engine: sensors -> 5 s hash-chained chunks -> Firestore (offline-first).
// Firestore writes are never awaited: with persistent cache they land in IndexedDB at once and the SDK
// replays them in order when the network returns. Each one is first journaled (awaited) to the raw vault
// (vault.ts), so this browser keeps its own copy until the server provably has every chunk. Order matters for the security rules: the last
// chunk is queued before the moment flips to "submitted".
// Guest mode (docs/ARCHITECTURE.md v3.1): with no signed-in user the session writes ONLY the raw-vault journal
// (ownerUid: null, owner: null, guest: true). Nothing is queued for Firestore; claimMoments() uploads it later.

import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { clipExt, FactsBuilder, type ChainFacts, type Claim } from "./v4";
import type { User } from "firebase/auth";
import { cloudReview, liveCheck } from "./ai";
import { makeChunk, sha256hex } from "./chain";
import { db } from "./firebase";
import { computeSummary, decodeChunks, trackDistanceM } from "./geo";
import type { AppEvent, CheckMode, Chunk, GpsRow, Intention, LiveCheck, Moment, MotionRow } from "./types";
import { answerEvent, frameEvent, nextWid, openRequest, skipEvent, witnessEvent, witnessSummary, type AnswerVia, type WitnessBy, type WitnessKind, type WitnessLog, type WitnessRequest } from "./witness";
import { forgetMoment, journalChunk, journalClip, journalMoment, journalMomentUpdate, journalOk, verifyAll } from "./vault";

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
  witnessOpen: WitnessRequest | null; // the witness's open request, if any (v3.4)
  witnessAsked: number;
  witnessAnswered: number;
  /** v4: what the chain holds so far, for the plan checklist ("captured") and the witness's `{{unmet}}`. */
  facts: ChainFacts;
}

function deviceInfo() {
  const ua = navigator as unknown as { userAgentData?: { brands: { brand: string; version: string }[]; platform?: string } };
  const b = ua.userAgentData?.brands.find((x) => !/Not.?A.?Brand|Chromium/i.test(x.brand));
  const model = b ? `${b.brand} ${b.version}` : (navigator.userAgent.match(/(Firefox|Safari|Chrome)\/\d+/)?.[0] ?? "Browser");
  return { model, os: ua.userAgentData?.platform || navigator.platform || "web", appVersion: "1.0.0" };
}

// The Moment this tab is recording right now (sensors running), if any: it can't be deleted.
let recordingId: string | null = null;
export const recordingMomentId = () => recordingId;

/**
 * Owner-only delete (docs/ARCHITECTURE.md "Deleting a Moment"). The raw-vault journal goes FIRST, so this browser
 * can never re-upload it; then the Firestore delete is queued (offline is fine). onMomentDeleted removes the chunks
 * and feed entry and writes the deleted/{id} tombstone other devices' vaults honour.
 */
export async function deleteMoment(id: string): Promise<void> {
  if (!db) throw new Error("Firebase is not configured");
  if (id === recordingId) throw new Error("This Moment is still being recorded.");
  await forgetMoment(id); // throws if the journal can't be cleared: then nothing is deleted
  // Not awaited: the SDK resolves only once the server acknowledges; the local cache drops the doc at once.
  deleteDoc(doc(db, "moments", id)).catch((e) => console.error("moment delete failed", id, e));
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
  readonly witness: WitnessLog = { requests: [] };
  /** Coach labels of the proof frames so far, for the witness's `{{session}}`. */
  readonly labels: string[] = [];
  private factsB = new FactsBuilder();
  gpsCount = 0;
  state: LiveState;
  onChange: (s: LiveState) => void = () => {};

  readonly guest: boolean;
  constructor(
    private user: User | null,
    public intentionObj: Intention,
    /** The interview transcript: journal-only, never sent to Firestore (contract v3.2). */
    private transcript?: string[],
  ) {
    this.guest = !user;
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
      witnessOpen: null,
      witnessAsked: 0,
      witnessAnswered: 0,
      facts: this.factsB.facts,
    };
  }

  private emit(patch: Partial<LiveState> = {}) {
    this.state = { ...this.state, ...patch, elapsedMs: Date.now() - this.startedAt, online: navigator.onLine, facts: this.factsB.facts };
    this.onChange(this.state);
  }

  /** Every chain event goes through here so the checklist sees it at once (it rides the next chunk). */
  private pushEvent(e: AppEvent) {
    this.events.push(e);
    this.factsB.event(e);
  }

  /** v4 client draft plan (the server plan is authoritative; this drives the record screen). */
  get plan() {
    return this.intentionObj.plan ?? null;
  }

  get intention(): string {
    return this.intentionObj.text;
  }
  get category() {
    return this.intentionObj.category;
  }

  /** Journals and queues the moment create; rejects if the raw vault can't be written. */
  async start() {
    if (this.guest ? !journalOk() : !db) throw new Error(this.guest ? "This browser can't store Moments (IndexedDB is unavailable)." : "Firebase is not configured");
    const u = this.user;
    const fields = {
      ownerUid: u ? u.uid : null,
      owner: u ? { name: u.displayName || "Anonymous", photoURL: u.photoURL ?? null } : null,
      ...(u ? {} : { guest: true }),
      intention: { ...this.intentionObj, text: this.intentionObj.text.slice(0, 200) },
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
      score: null,
      seal: null,
      createdAtServer: serverTimestamp(),
      submittedAtServer: null,
    };
    recordingId = this.id;
    // Journal first, inside the write queue so the create still precedes every chunk.
    const create = this.queue.then(async () => {
      await journalMoment(this.id, this.transcript?.length ? { ...fields, transcript: this.transcript } : fields);
      if (!this.guest) setDoc(doc(db!, "moments", this.id), fields).catch((e) => console.error("moment create failed", e));
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
          this.factsB.gps([row]);
          this.gpsCount++;
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
    this.factsB.motion([row]);
    const tail = [...this.state.motionTail, Math.hypot(row[1], row[2], row[3])].slice(-60);
    this.state = { ...this.state, motionOn: true, motionTail: tail };
  };

  /** Close the open chunk. Serialised so every chunk sees its predecessor's hash. */
  private close(extra: { frame?: Chunk["frame"]; frameSha?: string | null; check?: LiveCheck | null; events?: AppEvent[] } = {}) {
    const t1 = Math.max(Date.now(), this.lastT);
    const t0 = this.lastT;
    this.lastT = t1;
    for (const e of extra.events ?? []) this.factsB.event(e);
    if (extra.frameSha) this.factsB.frame();
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
      if (this.guest) {
        this.emit({ chunks: this.chunks.length });
        return;
      }
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

  // ---------------------------------------------------------------- witness (v3.4): events ride the next chunk

  private emitWitness() {
    const sum = witnessSummary(this.witness);
    this.emit({ witnessOpen: openRequest(this.witness), witnessAsked: sum.asked, witnessAnswered: sum.answered });
  }

  /** Record a witness request in the chain and open it. */
  witnessAsk(ask: string, kind: WitnessKind, why: string, by: WitnessBy, rid?: string): WitnessRequest {
    const r: WitnessRequest = { wid: nextWid(this.witness), ask, kind, why, by, at: Date.now(), ...(rid ? { rid } : {}) };
    this.witness.requests.push(r);
    this.pushEvent(witnessEvent(r.at, r.wid, ask, kind, by, rid));
    this.emitWitness();
    return r;
  }

  /** Answer the open request by voice, text or "done" (a frame answer goes through proofShot). */
  witnessAnswer(via: Exclude<AnswerVia, "frame">, text?: string) {
    const r = openRequest(this.witness);
    if (!r) return;
    const t = Date.now();
    Object.assign(r, { outcome: "answered", via, text: text?.slice(0, 200), closedAt: t });
    this.pushEvent(answerEvent(t, r.wid, via, text));
    this.emitWitness();
  }

  witnessSkip(reason?: string) {
    const r = openRequest(this.witness);
    if (!r) return;
    const t = Date.now();
    Object.assign(r, { outcome: "skipped", closedAt: t });
    this.pushEvent(skipEvent(t, r.wid, reason));
    this.emitWitness();
  }

  // ---------------------------------------------------------------- video clips (`video_start` / `video`)

  videoStart() {
    this.pushEvent({ t: Date.now(), type: "video_start" });
  }

  /**
   * A finished clip: its bytes go into the vault (never the chain), the `video` event commits to their SHA-256, and
   * the clip's middle frame is coached and chained as the proof frame of the same chunk.
   */
  async videoClip(c: { blob: Blob; mime: string; startedAt: number; durationMs: number; sha256: string; middle: { jpegB64: string; w: number; h: number } }) {
    const ext = clipExt(c.mime);
    const name = `verified-${this.id.slice(0, 8)}-${c.startedAt}.${ext}`;
    await journalClip({ sha256: c.sha256, momentId: this.id, blob: c.blob, mime: c.mime, bytes: c.blob.size, durationMs: c.durationMs, name });
    const ev: AppEvent = { t: Date.now(), type: "video", sha256: c.sha256, bytes: c.blob.size, durationMs: c.durationMs, startedAt: c.startedAt, name };
    return this.proofShot(c.middle.jpegB64, await sha256hex(c.middle.jpegB64), c.middle.w, c.middle.h, undefined, [ev]);
  }

  /** Proof shot: on-device coach first, then the frame and its verdict close a chunk together. `wid` answers a witness "show". */
  async proofShot(jpegB64: string, frameSha: string, w: number, h: number, wid?: string, extraEvents: AppEvent[] = []): Promise<LiveCheck> {
    const t = Date.now();
    const req = wid ? this.witness.requests.find((r) => r.wid === wid && !r.outcome) : undefined;
    this.checking = true;
    this.emit({ coach: { ok: true, reason: "Checking…", label: "", mode: "none", pending: true } });
    // The coach checks a witness answer against what the witness asked for.
    const res = await liveCheck(req ? `${this.intention} — witness asked: ${req.ask}` : this.intention, jpegB64);
    const check: LiveCheck = { ok: res.ok, reason: res.reason, mode: res.mode, label: res.label };
    if (req) Object.assign(req, { outcome: "answered", via: "frame", closedAt: Date.now() });
    const events: AppEvent[] = [
      ...extraEvents,
      frameEvent(t, req?.wid),
      ...(req ? [answerEvent(t, req.wid, "frame")] : []),
      { t: Date.now(), type: "check", ok: check.ok, mode: check.mode },
    ];
    if (!check.ok) events.push({ t: Date.now(), type: "retake", reason: check.reason });
    this.checking = false;
    const seqOfFrame = this.seq;
    await this.close({ frame: { jpegB64, w, h, t }, frameSha, check, events });
    if (check.ok) this.heroSeq = seqOfFrame;
    this.labels.push(check.label);
    if (req) this.emitWitness();
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
    if (recordingId === this.id) recordingId = null;
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
    if (openRequest(this.witness)) this.witnessSkip("stopped"); // open requests close with reason "stopped"
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
      witness: witnessSummary(this.witness),
      // Edits made on the claim card while recording ride the submit; frozen after (rules).
      intention: this.intentionObj,
      submittedAtServer: serverTimestamp(),
    };
    await journalMomentUpdate(this.id, submit);
    if (this.guest) return;
    if (this.factsB.facts.clips.length) {
      // v4.4: chained clips go to Storage BEFORE status = submitted. The vault's submit path does exactly that
      // (chunks → clips → submit fields) and retries every 30 s while offline or failing; the screen shows progress.
      void verifyAll();
      return;
    }
    updateDoc(doc(db!, "moments", this.id), submit).catch((e) => console.error("submit failed", e));
    void verifyAll();
  }

  /** v4: this Moment has chained video clips (they upload before the submit). */
  get hasClips() {
    return this.factsB.facts.clips.length > 0;
  }

  framesForJudge() {
    return decodeChunks(this.chunks).frames;
  }
}

export const CLAIMS_WAIT_MS = 30_000;

/** Resolves with `moments/{id}.claims.items` once the barAndClaims function wrote them, or [] after `ms`. */
export function waitForServerClaims(momentId: string, ms: number): Promise<Claim[]> {
  return new Promise((resolve) => {
    let done = false;
    let unsub: () => void = () => {};
    const finish = (c: Claim[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(c);
    };
    const timer = setTimeout(() => finish([]), ms);
    unsub = onSnapshot(
      doc(db!, "moments", momentId),
      (snap) => {
        const items = (snap.get("claims") as Moment["claims"])?.items;
        if (Array.isArray(items) && items.length) finish(items);
      },
      () => finish([]),
    );
    if (done) unsub();
  });
}

const reviews = new Map<string, Promise<unknown>>();
/**
 * Judge, skeptic + scorer (cloud, via AI Logic) for a submitted Moment, then write all three in one update.
 * One run per Moment at a time: the Done screen and the guest-claim flow may both ask for the same one.
 */
export function runCloudReview(momentId: string, moment: Parameters<typeof cloudReview>[0], frames: { seq: number; t: number; jpegB64: string }[]) {
  const inFlight = reviews.get(momentId);
  if (inFlight) return inFlight as ReturnType<typeof run>;
  const run = async () => {
    // v4.10: the judge rules on the server's claims; wait for them up to 30 s, else judge with [].
    const claims = moment.claims?.items?.length ? moment.claims.items : await waitForServerClaims(momentId, CLAIMS_WAIT_MS);
    const review = await cloudReview(moment, frames, claims);
    await updateDoc(doc(db!, "moments", momentId), review);
    return review;
  };
  const p = run().finally(() => reviews.delete(momentId));
  reviews.set(momentId, p);
  return p;
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
