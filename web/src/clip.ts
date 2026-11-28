// Video clips during recording (docs/ARCHITECTURE.md: `video_start` / `video` events). MediaRecorder on the camera
// stream (a low-rate, downscaled copy of it for long clips, v4.14), up to a cap. The clip's bytes go into this browser's vault; the chain commits to their SHA-256 (a `video`
// event, so the server reviews the clip itself, v4.4), and the clip's middle frame is the proof frame of the same
// chunk. v4: every chained clip is uploaded at submit (upload.ts), before the Moment is marked submitted.

import { captureFrame } from "./recorder";

/** Default cap; a plan asking for a longer continuous video raises it (clipCapMs). */
export const MAX_CLIP_MS = 60_000;
/** Hard cap (v4.14): two hours. Long clips record at a low frame rate (clipProfile), so even this stays < 200 MB. */
export const HARD_CLIP_MS = 2 * 3600_000;

/** Cap for this session: room for the longest `video` requirement plus 5 % and 15 s, between 60 s and 2 h. */
export const clipCapMs = (plan: { requirements: { evidence: string; minSeconds?: number }[] } | null | undefined) =>
  Math.min(
    HARD_CLIP_MS,
    Math.max(MAX_CLIP_MS, ...(plan?.requirements ?? []).filter((r) => r.evidence === "video").map((r) => Math.round((r.minSeconds ?? 0) * 1.05 + 15) * 1000)),
  );

/**
 * How a clip is encoded, from how long it may run (v4.14; the same tiers on iOS and Android). The server's reviewer
 * samples footage at <= 1 frame/s (far sparser past 2 min), so a long, still activity (meditating, reading, studying)
 * loses nothing at 1-5 frames/s while the file shrinks ~10-30x. Time is NOT sped up: a 30-minute clip plays for 30
 * minutes and its audio is continuous, so the duration and the sound stay evidence.
 *   live  cap <= 5 min    camera rate, <= 1280 px, 1.2 Mbit/s + 64 kbit/s audio   (5 min ~ 47 MB)
 *   long  cap <= 20 min   5 fps, <= 960 px, 350 kbit/s + 32 kbit/s audio          (20 min ~ 57 MB)
 *   slow  cap <= 2 h      1 fps, <= 720 px, 110 kbit/s + 24 kbit/s audio          (30 min ~ 30 MB, 2 h ~ 120 MB)
 */
export interface ClipProfile {
  tier: "live" | "long" | "slow";
  /** null: the camera's own rate */
  fps: number | null;
  maxEdge: number;
  videoBps: number;
  audioBps: number;
}
export const CLIP_PROFILES: Record<ClipProfile["tier"], ClipProfile> = {
  live: { tier: "live", fps: null, maxEdge: 1280, videoBps: 1_200_000, audioBps: 64_000 },
  long: { tier: "long", fps: 5, maxEdge: 960, videoBps: 350_000, audioBps: 32_000 },
  slow: { tier: "slow", fps: 1, maxEdge: 720, videoBps: 110_000, audioBps: 24_000 },
};
export const clipProfile = (capMs: number): ClipProfile =>
  capMs <= 5 * 60_000 ? CLIP_PROFILES.live : capMs <= 20 * 60_000 ? CLIP_PROFILES.long : CLIP_PROFILES.slow;

/** At most this many candidate middle frames are held while a clip records (thinned as it grows). */
const MAX_HELD_FRAMES = 48;

const CLIP_MIMES_V = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
const CLIP_MIMES_AV = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"];

export const clipSupported = () => typeof MediaRecorder !== "undefined";

export async function sha256Bytes(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Clip {
  blob: Blob;
  mime: string;
  startedAt: number;
  durationMs: number;
  /** The frame closest to the middle of the clip: the proof frame chained next to the `video` event. */
  middle: { jpegB64: string; w: number; h: number };
}

/**
 * A low-rate, downscaled copy of the camera for long clips: a canvas redrawn `fps` times a second and captured at that
 * rate, plus the camera's own audio. Null when the profile keeps the camera rate or the browser can't capture a
 * canvas (then the camera is recorded as is, at the profile's bitrate).
 */
function lowRateStream(video: HTMLVideoElement, camera: MediaStream, p: ClipProfile): { stream: MediaStream; stop: () => void } | null {
  if (!p.fps) return null;
  const c = document.createElement("canvas");
  if (typeof c.captureStream !== "function") return null;
  const ctx = c.getContext("2d", { alpha: false });
  if (!ctx) return null;
  const size = (): [number, number] => {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const s = Math.min(1, p.maxEdge / Math.max(vw, vh));
    // Even dimensions: some encoders refuse odd ones.
    return [Math.round((vw * s) / 2) * 2, Math.round((vh * s) / 2) * 2];
  };
  [c.width, c.height] = size();
  const draw = () => {
    const [w, h] = size();
    if (w !== c.width || h !== c.height) [c.width, c.height] = [w, h];
    try {
      ctx.drawImage(video, 0, 0, c.width, c.height);
    } catch {
      /* the camera can be mid-flip */
    }
  };
  draw();
  const stream = c.captureStream(p.fps);
  camera.getAudioTracks().forEach((t) => stream.addTrack(t));
  const timer = setInterval(draw, 1000 / p.fps);
  return {
    stream,
    // Only the canvas track: the audio tracks belong to the camera stream, which the record screen keeps using.
    stop: () => {
      clearInterval(timer);
      stream.getVideoTracks().forEach((t) => t.stop());
    },
  };
}

export class ClipRecorder {
  private mr: MediaRecorder;
  private parts: Blob[] = [];
  private frames: { t: number; f: ReturnType<typeof captureFrame> }[] = [];
  private grab: ReturnType<typeof setInterval>;
  private cap: ReturnType<typeof setTimeout>;
  private lowRate: ReturnType<typeof lowRateStream>;
  readonly profile: ClipProfile;
  readonly startedAt = Date.now();
  readonly done: Promise<Clip>;

  constructor(
    video: HTMLVideoElement,
    readonly capMs = MAX_CLIP_MS,
  ) {
    const camera = video.srcObject as MediaStream | null;
    if (!camera) throw new Error("Camera unavailable");
    this.profile = clipProfile(capMs);
    // Sound matters: singing, counting aloud or speaking is only provable from the audio track, and the server's video
    // reviewer (Gemini) hears it. A codec list without an audio codec makes some browsers drop the mic track.
    const hasAudio = camera.getAudioTracks().some((t) => t.readyState === "live");
    const mime = (hasAudio ? CLIP_MIMES_AV : CLIP_MIMES_V).find((m) => MediaRecorder.isTypeSupported(m));
    this.lowRate = lowRateStream(video, camera, this.profile);
    const rates = { videoBitsPerSecond: this.profile.videoBps, ...(hasAudio ? { audioBitsPerSecond: this.profile.audioBps } : {}) };
    this.mr = new MediaRecorder(this.lowRate?.stream ?? camera, mime ? { mimeType: mime, ...rates } : rates);
    this.mr.ondataavailable = (e) => e.data.size && this.parts.push(e.data);
    // Candidate middle frames, one every `every` seconds; past MAX_HELD_FRAMES every other one is dropped and the
    // spacing doubles, so a 2-hour clip holds ~48 JPEGs in memory, not 7,200.
    let every = 1;
    let tick = 0;
    const take = () => {
      if (tick++ % every) return;
      try {
        this.frames.push({ t: Date.now(), f: captureFrame(video) });
        if (this.frames.length > MAX_HELD_FRAMES) {
          this.frames = this.frames.filter((_, i) => i % 2 === 0);
          every *= 2;
        }
      } catch {
        /* a frame grab can fail while the camera flips */
      }
    };
    this.done = new Promise<Clip>((resolve, reject) => {
      this.mr.onstop = () => {
        clearInterval(this.grab);
        clearTimeout(this.cap);
        this.lowRate?.stop();
        const end = Date.now();
        const type = this.mr.mimeType || mime || "video/webm";
        const blob = new Blob(this.parts, { type });
        if (!blob.size) return reject(new Error("The clip is empty"));
        const mid = (this.startedAt + end) / 2;
        const best = this.frames.reduce<(typeof this.frames)[number] | null>((a, b) => (!a || Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a), null);
        let middle = best?.f;
        if (!middle) middle = captureFrame(video);
        resolve({ blob, mime: type, startedAt: this.startedAt, durationMs: end - this.startedAt, middle });
      };
      this.mr.onerror = () => {
        this.lowRate?.stop();
        reject(new Error("Clip recording failed"));
      };
    });
    this.mr.start(1000);
    take();
    this.grab = setInterval(take, 1000);
    this.cap = setTimeout(() => this.stop(), capMs);
  }

  get recording() {
    return this.mr.state === "recording";
  }

  stop(): Promise<Clip> {
    if (this.mr.state !== "inactive") this.mr.stop();
    return this.done;
  }
}
