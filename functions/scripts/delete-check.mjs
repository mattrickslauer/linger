// Emulator e2e for onMomentDeleted: run after seed.mjs (npm run test:e2e).
// Deletes one sealed demo Moment and checks the function removed its chunks and feed entry and left a tombstone.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error("emulator only"); process.exit(1); }
initializeApp({ projectId: process.env.GCLOUD_PROJECT || "verified-99e74" });
const db = getFirestore();

const sealed = (await db.collection("moments").where("status", "==", "sealed").limit(1).get()).docs[0];
if (!sealed) { console.error("no sealed moment to delete (run seed first)"); process.exit(1); }
const id = sealed.id, owner = sealed.get("ownerUid");
const before = (await db.collection(`moments/${id}/chunks`).get()).size;
const feedBefore = (await db.doc(`feed/${id}`).get()).exists;
await db.doc(`moments/${id}`).delete();

let chunks = before, feed = feedBefore, tomb = null;
for (let i = 0; i < 40 && (chunks || feed || !tomb); i++) {
  await new Promise((r) => setTimeout(r, 250));
  chunks = (await db.collection(`moments/${id}/chunks`).get()).size;
  feed = (await db.doc(`feed/${id}`).get()).exists;
  tomb = (await db.doc(`deleted/${id}`).get()).data() ?? null;
}
const ok = chunks === 0 && !feed && tomb?.ownerUid === owner;
console.log(`delete-check ${id}: chunks ${before}→${chunks}, feed ${feedBefore}→${feed}, tombstone ${tomb ? "owner " + tomb.ownerUid : "missing"} → ${ok ? "OK" : "FAIL"}`);
process.exit(ok ? 0 : 1);
