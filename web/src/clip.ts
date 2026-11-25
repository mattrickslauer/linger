// Video clips during recording (docs/ARCHITECTURE.md: `video_start` / `video` events). MediaRecorder on the camera
// stream, up to MAX_MS. The clip's bytes stay in this browser's vault; the chain commits to their SHA-256, and the
// clip's middle frame is the proof frame of the same chunk. The clip is uploaded only if the owner runs `full_video`.

import { captureFrame } from "./recorder";

export const MAX_CLIP_MS = 20_000;

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

  constructor(video: HTMLVideoElement) {
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
    this.cap = setTimeout(() => this.stop(), MAX_CLIP_MS);
  }

  get recording() {
    return this.mr.state === "recording";
  }

  stop(): Promise<Clip> {
    if (this.mr.state !== "inactive") this.mr.stop();
    return this.done;
  }
}
