#!/usr/bin/env node
// v4.12: fills feed/{id}.video.clips for posts sealed before shared video, from moments/{id}.videoReview.clips.
// Emulator by default; --prod for the real project; --dry to only print. Needs `npm run build` (reads lib/seal4.js).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PROD = process.argv.includes("--prod");
const DRY = process.argv.includes("--dry");
if (!PROD) process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { feedVideoClips } = require("../lib/seal4.js");
initializeApp({ projectId: process.env.GCLOUD_PROJECT || "verified-99e74" });
const db = getFirestore();

const feed = await db.collection("feed").get();
let filled = 0;
for (const f of feed.docs) {
  if (Array.isArray(f.get("video.clips"))) continue;
  const m = await db.doc(`moments/${f.id}`).get();
  if (!m.exists) continue;
  const clips = feedVideoClips(m.get("ownerUid"), f.id, m.get("videoReview"));
  console.log(`${f.id}: ${clips.length} clip(s)${DRY ? " (dry run)" : ""}`);
  if (!DRY) await f.ref.set({ video: { clips } }, { merge: true });
  filled++;
}
console.log(`feed ${feed.size} · backfilled ${filled}`);
