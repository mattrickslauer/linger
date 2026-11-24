#!/usr/bin/env node
// Prints the public feed (emulator by default, --prod for the real project). Handy for checking the seal.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PROD = process.argv.includes("--prod");
if (!PROD) process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp({ projectId: process.env.GCLOUD_PROJECT || "linger-reader" });

const s = await getFirestore().collection("feed").orderBy("sealedAtServer", "desc").get();
for (const d of s.docs) {
  const f = d.data();
  const km = (f.summary.distanceM / 1000).toFixed(2);
  const min = Math.round(f.summary.durationMs / 60000);
  console.log(
    `${f.status === "sealed" ? "Verified ✓  " : "Not verified"} ${f.intention.text}\n` +
      `   ${f.owner.name} · ${f.platform} · ${min} min · ${km} km · ${f.summary.frameCount} frames · track ${f.track.length} pts · hero ${f.heroJpegB64 ? Math.round(f.heroJpegB64.length / 1024) + " KB" : "none"}\n` +
      `   ${f.sealReason}`,
  );
}
if (s.empty) console.log("(feed is empty)");
else console.log("feed keys:", Object.keys(s.docs[0].data()).sort().join(","));
