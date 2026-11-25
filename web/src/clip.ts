// Video clips during recording (docs/ARCHITECTURE.md: `video_start` / `video` events). MediaRecorder on the camera
// stream, up to a cap. The clip's bytes go into this browser's vault; the chain commits to their SHA-256 (a `video`
// event, so the server reviews the clip itself, v4.4), and the clip's middle frame is the proof frame of the same
// chunk. v4: every chained clip is uploaded at submit (upload.ts), before the Moment is marked submitted.

import { captureFrame } from "./recorder";

/** Default cap; a plan asking for a longer continuous video raises it (clipCapMs). */
export const MAX_CLIP_MS = 60_000;
/** Hard cap: ~1.5 Mbit/s × 5 min ≈ 56 MB, well under the 200 MB upload limit. */
export const HARD_CLIP_MS = 300_000;

/** Cap for this session: room for the longest `video` requirement plus 15 s, between 60 s and 5 min. */
export const clipCapMs = (plan: { requirements: { evidence: string; minSeconds?: number }[] } | null | undefined) =>
  Math.min(HARD_CLIP_MS, Math.max(MAX_CLIP_MS, ...(plan?.requirements ?? []).filter((r) => r.evidence === "video").map((r) => ((r.minSeconds ?? 0) + 15) * 1000)));

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

export class ClipRecorder {
  private mr: MediaRecorder;
  private parts: Blob[] = [];
  private frames: { t: number; f: ReturnType<typeof captureFrame> }[] = [];
  private grab: ReturnType<typeof setInterval>;
  private cap: ReturnType<typeof setTimeout>;
  readonly startedAt = Date.now();
  readonly done: Promise<Clip>;

  constructor(
    video: HTMLVideoElement,
    readonly capMs = MAX_CLIP_MS,
  ) {
    const stream = video.srcObject as MediaStream | null;
    if (!stream) throw new Error("Camera unavailable");
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    this.mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1_500_000 } : undefined);
    this.mr.ondataavailable = (e) => e.data.size && this.parts.push(e.data);
    const take = () => {
      try {
        this.frames.push({ t: Date.now(), f: captureFrame(video) });
      } catch {
        /* a frame grab can fail while the camera flips */
      }
    };
    this.done = new Promise<Clip>((resolve, reject) => {
      this.mr.onstop = () => {
        clearInterval(this.grab);
        clearTimeout(this.cap);
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
      this.mr.onerror = () => reject(new Error("Clip recording failed"));
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
