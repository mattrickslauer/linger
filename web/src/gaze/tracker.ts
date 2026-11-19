// Webcam → face landmarks → gaze features, entirely in the browser.
//
// The model and WASM runtime are served from our own origin (public/mediapipe), so after the
// first load the tracker works offline and no camera frame ever leaves the device.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { gazeFeatures } from "./features";

export interface Frame {
  t: number;
  features: number[] | null; // null = no face or blink
}

export class GazeTracker {
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  readonly video: HTMLVideoElement;
  frames = 0;

  constructor(private onFrame: (f: Frame) => void) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
  }

  /**
   * Camera and model load in parallel: the permission prompt and the ~4 MB model download
   * overlap instead of queueing. GPU first, CPU if the GPU delegate is unavailable.
   */
  async start(onStage?: (stage: "loading" | "camera" | "ready") => void) {
    onStage?.("loading");
    const base = import.meta.env.BASE_URL + "mediapipe";
    const camera = navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false })
      .then(async (stream) => {
        this.stream = stream;
        this.video.srcObject = stream;
        await this.video.play();
        onStage?.("camera");
      });
    const model = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
      const make = (delegate: "GPU" | "CPU") =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
        });
      try {
        this.landmarker = await make("GPU");
      } catch {
        this.landmarker = await make("CPU");
      }
    })();
    try {
      await Promise.all([camera, model]);
    } catch (e) {
      this.stop();
      throw e;
    }
    onStage?.("ready");
    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.landmarker = null;
    this.stream = null;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const lm = this.landmarker;
    // Browsers pause a <video> when it is removed from the document (e.g. when the setup
    // preview unmounts). A paused video never produces a new frame, so resume it.
    if (this.stream && this.video.paused) this.video.play().catch(() => {});
    if (!lm || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const t = performance.now();
    const r = lm.detectForVideo(this.video, t);
    this.frames++;
    const face = r.faceLandmarks[0];
    const mat = r.facialTransformationMatrixes?.[0]?.data;
    this.onFrame({ t, features: face ? gazeFeatures(face, mat) : null });
  };
}
