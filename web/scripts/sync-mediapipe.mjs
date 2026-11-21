// Serve MediaPipe from our own origin: copy the WASM runtime out of node_modules and fetch the
// Face Landmarker model once. Runs before dev and build. Both outputs are git-ignored.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "mediapipe");
mkdirSync(out, { recursive: true });

cpSync(join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm"), join(out, "wasm"), { recursive: true });

const model = join(out, "face_landmarker.task");
if (!existsSync(model)) {
  const url =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url}: ${res.status}`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
  console.log("Downloaded face_landmarker.task");
}
console.log("MediaPipe assets ready in public/mediapipe");
