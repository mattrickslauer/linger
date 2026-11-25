#!/usr/bin/env node
// Emulator e2e for v3 (run after seed.mjs; npm run test:e2e): AI-set bar + seal v3 + feed v3 on the seeded Moments,
// getCredits (free grant, idempotent), runLadderModule (pass lifts, fail drops sealed -> rejected, idempotent replay,
// already_run, needs_*, not_owner, insufficient_credits, model failure refund) and full_video against the Storage
// emulator (clip re-hash; mismatch costs nothing). The functions emulator uses the deterministic fake AI engine.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("emulator only");
  process.exit(1);
}
const PROJECT = process.env.GCLOUD_PROJECT || "verified-99e74";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FN = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const HAS_STORAGE = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST || !!process.env.STORAGE_EMULATOR_HOST;
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const seal = require("../lib/seal.js");
const BUCKET = process.env.STORAGE_BUCKET || `${PROJECT}.appspot.com`;
initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
const db = getFirestore();

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`);
  if (!cond) failures++;
};
const near = (a, b) => Math.abs(a - b) < 1e-9;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signUp() {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error("auth emulator sign-up failed: " + JSON.stringify(j));
  return { uid: j.localId, token: j.idToken };
}

async function call(name, data, token) {
  const r = await fetch(`http://${FN}/${PROJECT}/us-central1/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json();
  if (j.error) return { error: { status: j.error.status, reason: j.error.details?.reason, details: j.error.details, message: j.error.message } };
  return { result: j.result };
}

const FISH = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c01";
const RUN = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c02";
const HIKE = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c03";
const FAKE = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c04";
const rid = () => crypto.randomUUID();

console.log("v3: bar + seal v3 + feed v3 on the seeded Moments");
for (const id of [FISH, RUN, HIKE, FAKE]) {
  const m = (await db.doc(`moments/${id}`).get()).data();
  const f = (await db.doc(`feed/${id}`).get()).data();
  ok(m?.bar?.source === "ai" && m.bar.model === "fake-emulator" && m.bar.value >= 0.5 && m.bar.value <= 0.95, `${id.slice(-2)} bar set server-side`, m?.bar?.value);
  ok(m?.seal?.version === 3 && typeof m.seal.checks?.bar === "boolean" && "ladderEligible" in m.seal, `${id.slice(-2)} seal v3`, m?.seal?.checks);
  ok(m?.verification?.version === 3 && near(m.verification.score, m.verification.baseline) && m.verification.bar === m.bar.value, `${id.slice(-2)} verification written in the seal transaction`);
  ok(f?.sealVersion === 3 && f.bar === m.bar.value && Array.isArray(f.ladder) && f.witness && "recordedAsGuest" in f, `${id.slice(-2)} feed v3 fields`);
}
ok((await db.doc(`feed/${HIKE}`).get()).get("recordedAsGuest") === true, "claimed guest Moment is marked recordedAsGuest on the feed");
ok((await db.doc(`moments/${FAKE}`).get()).get("seal.ladderEligible") === false, "the fake (skeptic veto) is not ladder-eligible");

console.log("v3: credits");
const alice = await signUp();
const bob = await signUp();
let r = await call("getCredits", {});
ok(r.error?.status === "UNAUTHENTICATED" && r.error.reason === "sign_in", "guests get unauthenticated/sign_in", r.error);
r = await call("getCredits", {}, alice.token);
ok(r.result?.balance === 10 && r.result.justGranted === true, "first getCredits grants 10 free credits", r.result);
r = await call("getCredits", {}, alice.token);
ok(r.result?.balance === 10 && r.result.justGranted === false, "second getCredits does not grant again", r.result);
ok((await db.doc(`credits/${alice.uid}/ledger/grant`).get()).get("delta") === 10, "grant ledger entry");

// The seeded Moments belong to seed users; hand two of them to alice (admin) so she is the owner.
for (const id of [FISH, HIKE, RUN]) await db.doc(`moments/${id}`).update({ ownerUid: alice.uid });

console.log("v3: runLadderModule");
const fish0 = (await db.doc(`moments/${FISH}`).get()).data();
const req1 = rid();
r = await call("runLadderModule", { momentId: FISH, module: "second_look", requestId: req1 }, alice.token);
const want1 = fish0.verification.score + 0.2 * (1 - fish0.verification.score);
ok(r.result?.passed === true && near(r.result.after, want1) && near(r.result.score, want1) && r.result.status === "sealed" && r.result.balance === 9 && r.result.cost === 1, "second_look passes: p + s(1-p), 1 credit", r.result);
const fish1 = (await db.doc(`moments/${FISH}`).get()).data();
ok(fish1.verification.modules.length === 1 && near(fish1.verification.score, want1) && !fish1.verification.pending?.second_look, "result recorded, score recomputed server-side");
const feed1 = (await db.doc(`feed/${FISH}`).get()).data();
ok(feed1.ladder.length === 1 && near(feed1.verificationScore, want1), "feed shows the ladder result and final score", feed1.ladder);
r = await call("runLadderModule", { momentId: FISH, module: "second_look", requestId: req1 }, alice.token);
ok(r.result?.runId === req1 && r.result.balance === 9, "same requestId replays the stored result, no second charge", r.result);
r = await call("runLadderModule", { momentId: FISH, module: "second_look", requestId: rid() }, alice.token);
ok(r.error?.reason === "already_run", "each module runs once per Moment", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "count_measure", requestId: rid() }, alice.token);
ok(r.error?.reason === "needs_quantities", "count_measure needs claimed quantities", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "full_video", requestId: rid() }, alice.token);
ok(r.error?.reason === "needs_video", "full_video needs a chained video", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "human_review", requestId: rid() }, alice.token);
ok(r.error?.reason === "unavailable_module", "human_review is coming soon", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "buy_score", requestId: rid() }, alice.token);
ok(r.error?.reason === "bad_module", "unknown module", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "place_time", requestId: "abcdefgh-refund" }, alice.token);
ok(r.error?.reason === "bad_request", "requestId must be a UUID (cannot collide with ledger ids)", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "place_time", requestId: rid() }, bob.token);
ok(r.error?.reason === "not_owner", "only the owner can run modules", r.error);
r = await call("runLadderModule", { momentId: FAKE, module: "second_look", requestId: rid() }, alice.token);
ok(r.error?.reason === "not_owner" || r.error?.reason === "not_eligible", "fake Moment cannot be laddered", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "place_time", requestId: rid() }, alice.token);
ok(r.result?.passed === true && r.result.balance === 8, "place_time (sun elevation from GPS + clock) passes", r.result);

// A fail drops a sealed Moment below its bar: hike baseline 0.56, bar 0.55; the fake second look fails under 0.6.
const hike0 = (await db.doc(`moments/${HIKE}`).get()).data();
ok(hike0.status === "sealed", "hike starts sealed", { score: hike0.verification.score, bar: hike0.bar.value });
r = await call("runLadderModule", { momentId: HIKE, module: "second_look", requestId: rid() }, alice.token);
ok(r.result?.passed === false && near(r.result.after, hike0.verification.score * 0.8) && r.result.status === "rejected" && r.result.verified === false, "a failed module lowers the score: p(1-s), sealed -> rejected", r.result);
const hike1 = (await db.doc(`moments/${HIKE}`).get()).data();
ok(hike1.status === "rejected" && hike1.seal.checks.bar === false && hike1.seal.checks.chain === true && /after the verification ladder/.test(hike1.seal.reason), "re-seal touches only the bar check", hike1.seal);
ok((await db.doc(`feed/${HIKE}`).get()).get("status") === "rejected", "feed reflects the new status");

// Model failure after the spend: refund, nothing recorded.
await db.doc(`moments/${RUN}`).update({ "intention.text": "Run a 5k on the Oso Creek trail #ai-fail" });
const before = (await db.doc(`credits/${alice.uid}`).get()).get("balance");
const failReq = rid();
r = await call("runLadderModule", { momentId: RUN, module: "second_look", requestId: failReq }, alice.token);
const after = (await db.doc(`credits/${alice.uid}`).get()).data();
ok(r.error?.status === "UNAVAILABLE" && r.error.reason === "model_failed", "model failure -> unavailable/model_failed", r.error);
ok(after.balance === before, "credits refunded", { before, after: after.balance });
ok((await db.doc(`credits/${alice.uid}/ledger/${failReq}-refund`).get()).get("delta") === 1, "refund ledger entry");
const run1 = (await db.doc(`moments/${RUN}`).get()).data();
ok(run1.verification.modules.length === 0 && !run1.verification.pending?.second_look, "nothing recorded, module not locked");

// A run that died mid-flight (spend written, marker set, no result, no refund) blocks nothing once it is stale:
// the next request refunds it and runs. Simulated by hand: spend 11 minutes ago + marker.
const runText = run1.intention.text.replace(" #ai-fail", "");
await db.doc(`moments/${RUN}`).update({ "intention.text": runText });
const lost = rid();
const bal0 = (await db.doc(`credits/${alice.uid}`).get()).get("balance");
await db.doc(`credits/${alice.uid}/ledger/${lost}`).set({ delta: -1, kind: "spend", reason: "Place & time check", momentId: RUN, module: "place_time", runId: lost, balanceAfter: bal0 - 1, atServer: Timestamp.fromMillis(Date.now() - 11 * 60_000) });
await db.doc(`credits/${alice.uid}`).update({ balance: bal0 - 1, spent: FieldValue.increment(1) });
await db.doc(`moments/${RUN}`).update({ "verification.pending.place_time": lost });
r = await call("runLadderModule", { momentId: RUN, module: "place_time", requestId: lost }, alice.token);
ok(r.error?.reason === "model_failed", "the lost run's own requestId settles as model_failed (refunded)", r.error);
ok((await db.doc(`credits/${alice.uid}/ledger/${lost}-refund`).get()).get("delta") === 1, "stale run refunded");
ok((await db.doc(`credits/${alice.uid}`).get()).get("balance") === bal0, "balance restored after the stale refund");
// And a fresh in-flight marker from another request still blocks (not stale).
const live = rid();
await db.doc(`credits/${alice.uid}/ledger/${live}`).set({ delta: -1, kind: "spend", reason: "Place & time check", momentId: RUN, module: "place_time", runId: live, balanceAfter: bal0, atServer: FieldValue.serverTimestamp() });
await db.doc(`moments/${RUN}`).update({ "verification.pending.place_time": live });
r = await call("runLadderModule", { momentId: RUN, module: "place_time", requestId: rid() }, alice.token);
ok(r.error?.reason === "already_run", "a live run of the same module still blocks a second spend", r.error);
await db.doc(`moments/${RUN}`).update({ "verification.pending.place_time": FieldValue.delete() });
await db.doc(`credits/${alice.uid}/ledger/${live}`).delete();

// Insufficient credits.
await db.doc(`credits/${alice.uid}`).update({ balance: 0 });
r = await call("runLadderModule", { momentId: RUN, module: "place_time", requestId: rid() }, alice.token);
ok(r.error?.status === "RESOURCE_EXHAUSTED" && r.error.reason === "insufficient_credits" && r.error.details?.cost === 1, "insufficient_credits", r.error);
await db.doc(`credits/${alice.uid}`).update({ balance: 7 });

// full_video against the Storage emulator: a small Moment whose chain commits to a clip's SHA-256.
if (HAS_STORAGE) {
  console.log("v3: full_video (Storage emulator)");
  const id = "e2e00000-0000-4000-8000-00000000f1d0";
  const clip = Buffer.from("not really an mp4, but the bytes are what the chain commits to");
  const clipSha = createHash("sha256").update(clip).digest("hex");
  const JPEG = "/9j/e2eframe";
  const T0 = Date.now() - 3_600_000;
  const chunks = [];
  let prev = seal.genesis(id);
  for (let seq = 0; seq < 6; seq++) {
    const t0 = T0 + seq * 5000, t1 = t0 + 5000, frame = seq === 3;
    const events = seq === 0 ? [{ t: t0, type: "start" }] : [];
    if (frame) events.push({ t: t0, type: "video_start" }, { t: t1, type: "frame" }, { t: t1, type: "video", sha256: clipSha, bytes: clip.length, durationMs: 5000, startedAt: t0, name: "clip.mp4" });
    const payload = JSON.stringify({
      gps: [0, 1, 2, 3, 4].map((k) => [t0 + k * 1000, 33.6 + (seq * 5 + k) * 0.00002, -117.6, 5, null, 1]),
      motion: [0, 1, 2].map((k) => [t0 + k * 100, 0.1, 9.8, 0.2, 0.01, 0, 0]),
      events,
      frameSha: frame ? seal.sha256hex(JPEG) : null,
      check: frame ? { ok: true, reason: "keep going", mode: "cloud", label: "lake" } : null,
    });
    const c = { seq, t0, t1, prevHash: prev, payload, hash: "", frame: frame ? { jpegB64: JPEG, w: 1, h: 1, t: t1 } : null };
    c.hash = seal.chunkHash(c);
    prev = c.hash;
    chunks.push(c);
  }
  const ref = db.doc(`moments/${id}`);
  await db.recursiveDelete(ref);
  await ref.set({ ownerUid: alice.uid, owner: { name: "E2E", photoURL: null }, intention: { text: "Film the lake", category: "outdoors" }, platform: "android", status: "recording", startedAt: T0, endedAt: null, chunkCount: 0, headHash: null, seal: null, bar: null, verification: null });
  for (const c of chunks) await ref.collection("chunks").doc(seal.chunkId(c.seq)).set(c);
  await ref.update({ status: "submitted", endedAt: chunks.at(-1).t1, chunkCount: chunks.length, headHash: prev });
  const op = { verdict: "consistent", confidence: 0.9, reasons: ["e2e"], model: "e2e", ranAt: Date.now() };
  await ref.update({ judge: op, skeptic: op, score: { probability: 0.62, reasons: ["e2e"], model: "e2e", ranAt: Date.now() } });
  let m;
  for (let i = 0; i < 60 && !(m = (await ref.get()).data())?.seal; i++) await sleep(500);
  ok(m?.seal?.ladderEligible === true, "video Moment sealed and ladder-eligible", m?.seal?.checks);
  r = await call("runLadderModule", { momentId: id, module: "full_video", requestId: rid() }, alice.token);
  ok(r.error?.reason === "clip_missing", "clip not uploaded yet -> clip_missing, no charge", r.error);
  const bucket = getStorage().bucket(r.error?.details?.bucket || BUCKET); // the bucket the function reads
  ok(r.error?.details?.path === `clips/${alice.uid}/${id}/${clipSha}.mp4`, "clip_missing tells the client where to upload", r.error?.details);
  await bucket.file(`clips/${alice.uid}/${id}/${clipSha}.mp4`).save(Buffer.from("tampered bytes"), { contentType: "video/mp4" });
  r = await call("runLadderModule", { momentId: id, module: "full_video", requestId: rid() }, alice.token);
  ok(r.error?.reason === "clip_hash_mismatch", "re-hash catches a different clip", r.error);
  ok(!(await bucket.file(`clips/${alice.uid}/${id}/${clipSha}.mp4`).exists())[0], "the mismatched upload is removed so the owner can upload again");
  await bucket.file(`clips/${alice.uid}/${id}/${clipSha}.mp4`).save(clip, { contentType: "video/mp4" });
  r = await call("runLadderModule", { momentId: id, module: "full_video", requestId: rid(), clipSha }, alice.token);
  ok(r.result?.passed === true && near(r.result.after, 0.62 + 0.45 * 0.38) && r.result.cost === 3 && r.result.balance === 4, "full_video: hash matches the chain, 3 credits, p + 0.45(1-p)", r.result);
} else {
  console.log("  (storage emulator not running: full_video skipped)");
}

const ledger = await db.collection(`credits/${alice.uid}/ledger`).get();
console.log(`  ledger: ${ledger.docs.map((d) => `${d.get("kind")}${d.get("delta") > 0 ? "+" : ""}${d.get("delta")}`).join(" ")}`);
console.log(failures ? `ladder-check: ${failures} FAILED` : "ladder-check: all ok");
process.exit(failures ? 1 : 0);
