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

  async start() {
    const base = import.meta.env.BASE_URL + "mediapipe";
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
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
