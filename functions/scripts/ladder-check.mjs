#!/usr/bin/env node
// Emulator e2e (run after seed.mjs; npm run test:e2e). The functions emulator uses the deterministic fake AI engine.
//   v4: barAndClaims + seal v4 + feed v4 on the seeded Moments; runLadderModule per claim (pass lifts only the claims
//       a module backs, fail drops sealed -> rejected, idempotent replay, already_run, needs_*, no_claims_backed,
//       not_owner, insufficient_credits, model failure refund, stale run recovery);
//       "clap 50 times" (the production failure): typed intention -> server claims (action + count) -> clip uploaded
//       -> free video review backs both -> Verified with no paid module; a tampered clip is cheating; a clip that never
//       arrives expires after 24 h and count_measure can still back the typed count.
//   v3: Moments sealed by v3 functions keep v3 ladder math, and full_video against the Storage emulator (clip re-hash;
//       mismatch costs nothing and is deleted).
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

/** Polls a Moment until `pred` holds (or ~40 s pass); returns the last data. */
async function waitFor(ref, pred, tries = 80) {
  let m;
  for (let i = 0; i < tries; i++) {
    m = (await ref.get()).data();
    if (m && pred(m)) return m;
    await sleep(500);
  }
  return m;
}

const FISH = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c01";
const RUN = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c02";
const HIKE = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c03";
const FAKE = "5b0c8e7a-1d2f-4a3b-9c4d-0e1f2a3b4c04";
const rid = () => crypto.randomUUID();

console.log("v4: barAndClaims + seal v4 + feed v4 on the seeded Moments");
for (const id of [FISH, RUN, HIKE, FAKE]) {
  const m = (await db.doc(`moments/${id}`).get()).data();
  const f = (await db.doc(`feed/${id}`).get()).data();
  const tag = id.slice(-2);
  ok(m?.bar?.source === "ai" && m.bar.model === "fake-emulator" && m.bar.value >= 0.5 && m.bar.value <= 0.95, `${tag} bar set server-side`, m?.bar?.value);
  ok(m?.claims?.source === "ai" && m.claims.items.length >= 1 && m.claims.items[0].id === "c1" && m.plan?.requirements?.length >= m.claims.items.length, `${tag} server claims + plan`, m?.claims?.items?.map((c) => `${c.kind}:${c.text}`));
  ok(m?.videoReview?.status === "none", `${tag} no chained video -> videoReview none`);
  ok(m?.seal?.version === 4 && typeof m.seal.checks?.cheating === "boolean" && Array.isArray(m.seal.cheatingSignals) && "ladderEligible" in m.seal, `${tag} seal v4`, m?.seal?.checks);
  ok(
    m?.verification?.version === 4 && m.verification.claims.length === m.claims.items.length && m.verification.bar === m.bar.value && m.verification.modules.length === 0,
    `${tag} verification v4 written in the seal transaction`,
    m?.verification?.claims?.map((c) => [c.id, c.p, c.backedBy]),
  );
  ok(f?.sealVersion === 4 && f.claimsTotal === m.claims.items.length && Array.isArray(f.claims) && f.plan && f.video?.status === "none" && "recordedAsGuest" in f, `${tag} feed v4 fields`);
}
const fish0 = (await db.doc(`moments/${FISH}`).get()).data();
ok(fish0.status === "sealed" && fish0.claims.items.some((c) => c.kind === "place") && fish0.seal.reason.startsWith("All "), "fish: every claim backed (frames judge + GPS) -> sealed", fish0.seal.reason);
ok((await db.doc(`feed/${HIKE}`).get()).get("recordedAsGuest") === true, "claimed guest Moment is marked recordedAsGuest on the feed");
const fake0 = (await db.doc(`moments/${FAKE}`).get()).data();
ok(
  fake0.status === "rejected" && fake0.seal.checks.cheating === false && fake0.seal.ladderEligible === false && /^Cheating detected: skeptic: /.test(fake0.seal.reason) && fake0.verification.claims.every((c) => c.p <= 0.1),
  "the fake (skeptic veto) is cheating: capped at 0.1, rejected, not ladder-eligible",
  fake0.seal.reason,
);
ok((await db.doc(`feed/${FAKE}`).get()).get("cheating") === true, "feed marks the cheat");

console.log("credits");
const alice = await signUp();
const bob = await signUp();
let r = await call("getCredits", {});
ok(r.error?.status === "UNAUTHENTICATED" && r.error.reason === "sign_in", "guests get unauthenticated/sign_in", r.error);
r = await call("getCredits", {}, alice.token);
ok(r.result?.balance === 10 && r.result.justGranted === true, "first getCredits grants 10 free credits", r.result);
r = await call("getCredits", {}, alice.token);
ok(r.result?.balance === 10 && r.result.justGranted === false, "second getCredits does not grant again", r.result);
ok((await db.doc(`credits/${alice.uid}/ledger/grant`).get()).get("delta") === 10, "grant ledger entry");

// The seeded Moments belong to seed users; hand them to alice (admin) so she is the owner.
for (const id of [FISH, HIKE, RUN]) await db.doc(`moments/${id}`).update({ ownerUid: alice.uid });

console.log("v4: runLadderModule per claim");
const fishBefore = Object.fromEntries(fish0.verification.claims.map((c) => [c.id, c.p]));
const outcome = fish0.claims.items.find((c) => c.kind === "outcome").id;
const place = fish0.claims.items.find((c) => c.kind === "place").id;
const req1 = rid();
r = await call("runLadderModule", { momentId: FISH, module: "second_look", requestId: req1 }, alice.token);
const want1 = fishBefore[outcome] + 0.2 * (1 - fishBefore[outcome]);
ok(
  r.result?.passed === true && r.result.claims?.length === 1 && r.result.claims[0].id === outcome && near(r.result.claims[0].after, want1) && r.result.balance === 9 && r.result.cost === 1,
  "second_look backs only the outcome claim: p + s(1-p) on that claim, 1 credit",
  r.result?.claims,
);
ok(
  r.result?.claimScores?.find((c) => c.id === place)?.p === fishBefore[place] && near(r.result.score, Math.min(...r.result.claimScores.map((c) => c.p))) && r.result.claimsBacked === fish0.claims.items.length,
  "the place claim is untouched; score = min over claims",
  r.result?.claimScores,
);
const fish1 = (await db.doc(`moments/${FISH}`).get()).data();
ok(
  fish1.verification.modules.length === 1 && fish1.verification.modules[0].claims[0].verdict === "backed" && fish1.verification.claims.find((c) => c.id === outcome).backedBy.includes("second_look") && !fish1.verification.pending?.second_look,
  "result recorded per claim, claims recomputed server-side",
);
const feed1 = (await db.doc(`feed/${FISH}`).get()).data();
ok(feed1.ladder.length === 1 && near(feed1.claims.find((c) => c.id === outcome).p, want1), "feed shows the ladder result and the per-claim p", feed1.ladder);
r = await call("runLadderModule", { momentId: FISH, module: "second_look", requestId: req1 }, alice.token);
ok(r.result?.runId === req1 && r.result.balance === 9 && r.result.claims?.length === 1, "same requestId replays the stored result, no second charge", r.result);
r = await call("runLadderModule", { momentId: FISH, module: "second_look", requestId: rid() }, alice.token);
ok(r.error?.reason === "already_run", "each module runs once per Moment", r.error);
r = await call("runLadderModule", { momentId: FISH, module: "count_measure", requestId: rid() }, alice.token);
ok(r.error?.reason === "needs_quantities", "count_measure needs a count/measure claim", r.error);
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
ok(
  r.result?.passed === true && r.result.balance === 8 && r.result.claims?.map((c) => c.id).join() === place && near(r.result.score, Math.min(want1, fishBefore[place] + 0.2 * (1 - fishBefore[place]))),
  "place_time backs the place claim and lifts the score",
  r.result,
);

// A fail drops a sealed Moment below its bar: hike baseline 0.56, bar 0.55; the fake second look fails under 0.6.
const hike0 = (await db.doc(`moments/${HIKE}`).get()).data();
ok(hike0.status === "sealed", "hike starts sealed", { score: hike0.verification.score, bar: hike0.bar.value });
r = await call("runLadderModule", { momentId: HIKE, module: "place_time", requestId: rid() }, alice.token);
ok(r.error?.reason === "no_claims_backed", "a module that backs none of the claims is refused before any charge", r.error);
r = await call("runLadderModule", { momentId: HIKE, module: "second_look", requestId: rid() }, alice.token);
ok(r.result?.passed === false && near(r.result.after, hike0.verification.score * 0.8) && r.result.status === "rejected" && r.result.verified === false, "a failed module lowers its claims: p(1-s), sealed -> rejected", r.result);
const hike1 = (await db.doc(`moments/${HIKE}`).get()).data();
ok(
  hike1.status === "rejected" && hike1.seal.checks.bar === false && hike1.seal.checks.chain === true && hike1.seal.checks.cheating === true && /^0 of 1 claims backed · /.test(hike1.seal.reason),
  "re-seal touches only the bar check",
  hike1.seal.reason,
);
ok((await db.doc(`feed/${HIKE}`).get()).get("status") === "rejected", "feed reflects the new status");

// Model failure after the spend: refund, nothing recorded.
const run0 = (await db.doc(`moments/${RUN}`).get()).data();
await db.doc(`moments/${RUN}`).update({ "intention.text": run0.intention.text + " #ai-fail" });
const before = (await db.doc(`credits/${alice.uid}`).get()).get("balance");
const failReq = rid();
r = await call("runLadderModule", { momentId: RUN, module: "second_look", requestId: failReq }, alice.token);
const after = (await db.doc(`credits/${alice.uid}`).get()).data();
ok(r.error?.status === "UNAVAILABLE" && r.error.reason === "model_failed", "model failure -> unavailable/model_failed", r.error);
ok(after.balance === before, "credits refunded", { before, after: after.balance });
ok((await db.doc(`credits/${alice.uid}/ledger/${failReq}-refund`).get()).get("delta") === 1, "refund ledger entry");
const run1 = (await db.doc(`moments/${RUN}`).get()).data();
ok(run1.verification.modules.length === 0 && !run1.verification.pending?.second_look, "nothing recorded, module not locked");

// A run that died mid-flight (spend written, marker set, no result, no refund) blocks nothing once it is stale.
await db.doc(`moments/${RUN}`).update({ "intention.text": run0.intention.text });
const lost = rid();
const bal0 = (await db.doc(`credits/${alice.uid}`).get()).get("balance");
await db.doc(`credits/${alice.uid}/ledger/${lost}`).set({ delta: -1, kind: "spend", reason: "Place & time check", momentId: RUN, module: "place_time", runId: lost, balanceAfter: bal0 - 1, atServer: Timestamp.fromMillis(Date.now() - 11 * 60_000) });
await db.doc(`credits/${alice.uid}`).update({ balance: bal0 - 1, spent: FieldValue.increment(1) });
await db.doc(`moments/${RUN}`).update({ "verification.pending.place_time": lost });
r = await call("runLadderModule", { momentId: RUN, module: "place_time", requestId: lost }, alice.token);
ok(r.error?.reason === "model_failed", "the lost run's own requestId settles as model_failed (refunded)", r.error);
ok((await db.doc(`credits/${alice.uid}/ledger/${lost}-refund`).get()).get("delta") === 1, "stale run refunded");
ok((await db.doc(`credits/${alice.uid}`).get()).get("balance") === bal0, "balance restored after the stale refund");
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
await db.doc(`credits/${alice.uid}`).update({ balance: 10 });

// ───────────────────────── v3 Moments keep v3 behaviour (sealed by v3 functions before this deploy)
console.log("v3: a Moment sealed by v3 functions keeps v3 ladder math");
const V3 = "e2e00000-0000-4000-8000-0000000000a3";
{
  const ref = db.doc(`moments/${V3}`);
  await db.recursiveDelete(ref);
  const src = (await db.doc(`moments/${FISH}`).get()).data();
  const chunks = (await db.collection(`moments/${FISH}/chunks`).orderBy("seq").get()).docs.map((d) => d.data());
  const { claims: _c, plan: _p, videoReview: _v, ...rest } = src;
  await ref.set({ ...rest, ownerUid: alice.uid, status: "recording", seal: null, bar: null, verification: null });
  for (const c of chunks) await ref.collection("chunks").doc(seal.chunkId(c.seq)).set(c);
  await ref.update({
    status: "sealed",
    bar: { value: 0.59, difficulty: 0.2, rationale: "v3", factors: [], source: "ai", model: "v3", ranAt: 1 },
    seal: { sealed: true, at: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), checks: { chain: true, timing: true, physics: true, frames: true, ai: true, bar: true }, reason: "v3 seal", version: 3, ladderEligible: true },
    verification: { version: 3, baseline: 0.83, score: 0.83, bar: 0.59, verified: true, modules: [], updatedAtServer: FieldValue.serverTimestamp() },
  });
  await sleep(1500);
  const m = (await ref.get()).data();
  ok(m.seal.version === 3 && !m.claims, "a v3 seal is never re-sealed as v4");
  r = await call("runLadderModule", { momentId: V3, module: "second_look", requestId: rid() }, alice.token);
  ok(r.result?.passed === true && near(r.result.after, 0.83 + 0.2 * 0.17) && near(r.result.score, r.result.after) && r.result.claims === undefined, "v3 ladder math on the overall score, no claims", r.result);
  r = await call("runLadderModule", { momentId: V3, module: "count_measure", requestId: rid() }, alice.token);
  ok(r.error?.reason === "needs_quantities", "v3: count_measure still needs intention.quantities", r.error);
}

// ───────────────────────── Storage: v3 full_video, then the v4 free video review
let bucketName = null;
function videoChunks(id, clipSha, { T0 = Date.now() - 3_600_000, durationMs = 35_000, gps = true, bytes = 64 } = {}) {
  const JPEG = "/9j/e2eframe-" + id.slice(-4);
  const chunks = [];
  let prev = seal.genesis(id);
  for (let seq = 0; seq < 8; seq++) {
    const t0 = T0 + seq * 5000, t1 = t0 + 5000, last = seq === 7;
    const events = seq === 0 ? [{ t: t0, type: "start" }, { t: t0 + 500, type: "video_start" }] : [];
    if (last) events.push({ t: t1, type: "video", sha256: clipSha, bytes, durationMs, startedAt: T0 + 500, name: "clip.webm" }, { t: t1, type: "frame" }, { t: t1, type: "stop" });
    const payload = JSON.stringify({
      gps: gps ? [0, 1, 2, 3, 4].map((k) => [t0 + k * 1000, 33.6 + (seq * 5 + k) * 0.00002, -117.6, 5, null, 1]) : [],
      motion: [0, 1, 2].map((k) => [t0 + k * 100, 0.1 + k * 0.4, 9.8, 0.2, 0.01, 0, 0]),
      events,
      frameSha: last ? seal.sha256hex(JPEG) : null,
      check: last ? { ok: true, reason: "keep going", mode: "on_device", label: "hands" } : null,
    });
    const c = { seq, t0, t1, prevHash: prev, payload, hash: "", frame: last ? { jpegB64: JPEG, w: 1, h: 1, t: t1 } : null };
    c.hash = seal.chunkHash(c);
    prev = c.hash;
    chunks.push(c);
  }
  return { chunks, T0, headHash: prev };
}

if (HAS_STORAGE) {
  console.log("v3: full_video (Storage emulator) on a v3-sealed Moment");
  const id = "e2e00000-0000-4000-8000-00000000f1d0";
  const clip = Buffer.from("not really an mp4, but the bytes are what the chain commits to");
  const clipSha = createHash("sha256").update(clip).digest("hex");
  const { chunks, T0, headHash } = videoChunks(id, clipSha, { durationMs: 5000 });
  const ref = db.doc(`moments/${id}`);
  await db.recursiveDelete(ref);
  await ref.set({ ownerUid: alice.uid, owner: { name: "E2E", photoURL: null }, intention: { text: "Film the lake", category: "outdoors" }, platform: "android", status: "recording", startedAt: T0, endedAt: null, chunkCount: 0, headHash: null, seal: null, bar: null, verification: null });
  for (const c of chunks) await ref.collection("chunks").doc(seal.chunkId(c.seq)).set(c);
  const op = { verdict: "consistent", confidence: 0.9, reasons: ["e2e"], model: "e2e", ranAt: Date.now() };
  await ref.update({
    status: "sealed",
    endedAt: chunks.at(-1).t1,
    chunkCount: chunks.length,
    headHash,
    judge: op,
    skeptic: op,
    score: { probability: 0.62, reasons: ["e2e"], model: "e2e", ranAt: Date.now() },
    bar: { value: 0.55, difficulty: 0.1, rationale: "v3", factors: [], source: "ai", model: "v3", ranAt: 1 },
    seal: { sealed: true, at: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), checks: { chain: true, timing: true, physics: true, frames: true, ai: true, bar: true }, reason: "v3 seal", version: 3, ladderEligible: true },
    verification: { version: 3, baseline: 0.62, score: 0.62, bar: 0.55, verified: true, modules: [], updatedAtServer: FieldValue.serverTimestamp() },
  });
  r = await call("runLadderModule", { momentId: id, module: "full_video", requestId: rid() }, alice.token);
  ok(r.error?.reason === "clip_missing", "clip not uploaded yet -> clip_missing, no charge", r.error);
  bucketName = r.error?.details?.bucket || BUCKET; // the bucket the functions read
  const bucket = getStorage().bucket(bucketName);
  ok(r.error?.details?.path === `clips/${alice.uid}/${id}/${clipSha}.mp4`, "clip_missing tells the client where to upload", r.error?.details);
  await bucket.file(`clips/${alice.uid}/${id}/${clipSha}.mp4`).save(Buffer.from("tampered bytes"), { contentType: "video/mp4" });
  r = await call("runLadderModule", { momentId: id, module: "full_video", requestId: rid() }, alice.token);
  ok(r.error?.reason === "clip_hash_mismatch", "re-hash catches a different clip", r.error);
  ok(!(await bucket.file(`clips/${alice.uid}/${id}/${clipSha}.mp4`).exists())[0], "v3: the mismatched upload is removed so the owner can upload again");
  await bucket.file(`clips/${alice.uid}/${id}/${clipSha}.mp4`).save(clip, { contentType: "video/mp4" });
  const bal = (await db.doc(`credits/${alice.uid}`).get()).get("balance");
  r = await call("runLadderModule", { momentId: id, module: "full_video", requestId: rid(), clipSha }, alice.token);
  ok(r.result?.passed === true && near(r.result.after, 0.62 + 0.45 * 0.38) && r.result.cost === 3 && r.result.balance === bal - 3, "full_video: hash matches the chain, 3 credits, p + 0.45(1-p)", r.result);

  // ───────────────────────── v4: "clap 50 times" (the production failure), all free
  console.log('v4: "Clap 50 times" typed, video clip, free video review');
  /** Records a v4 Moment the way the clients do: chunks, then (optionally) the clip, then submit + judge/skeptic/scorer. */
  async function recordClap(id, { clipBytes, upload, uploadBytes, submittedAtServer, text = "Clap 50 times", chainedBytes = 64 }) {
    const clipSha = createHash("sha256").update(clipBytes).digest("hex");
    const { chunks, T0, headHash } = videoChunks(id, clipSha, { gps: false, bytes: chainedBytes });
    const ref = db.doc(`moments/${id}`);
    await db.recursiveDelete(ref);
    await db.doc(`feed/${id}`).delete();
    await ref.set({ ownerUid: alice.uid, owner: { name: "E2E", photoURL: null }, intention: { text, category: "other" }, platform: "web", status: "recording", startedAt: T0, endedAt: null, chunkCount: 0, headHash: null, summary: null, seal: null, bar: null, verification: null, judge: null, skeptic: null, score: null });
    for (const c of chunks) await ref.collection("chunks").doc(seal.chunkId(c.seq)).set(c);
    const path = `clips/${alice.uid}/${id}/${clipSha}.webm`;
    if (upload === "before") await getStorage().bucket(bucketName).file(path).save(uploadBytes ?? clipBytes, { contentType: "video/webm" });
    const summary = seal.computeSummary({ summary: null }, chunks, chunks.map((c) => JSON.parse(c.payload)));
    await ref.update({ status: "submitted", endedAt: chunks.at(-1).t1, chunkCount: chunks.length, headHash, summary, submittedAtServer: submittedAtServer ?? FieldValue.serverTimestamp() });
    // The client's cloud review: one still frame cannot count claps (the 0.40 production baseline).
    await ref.update({
      judge: { verdict: "uncertain", confidence: 0.5, reasons: ["Single frame cannot verify the complete count of 50 claps"], claims: [], model: "e2e", ranAt: Date.now() },
      skeptic: { verdict: "consistent", confidence: 0.7, reasons: ["Ordinary room, nothing staged"], model: "e2e", ranAt: Date.now() },
      score: { probability: 0.4, reasons: ["One frame of hands"], model: "e2e", ranAt: Date.now() },
    });
    return { ref, path, clipSha };
  }

  const CLAP = "e2e00000-0000-4000-8000-0000000c1a50";
  const clapClip = Buffer.from("fifty claps, one continuous webm clip (e2e bytes)");
  const clap = await recordClap(CLAP, { clipBytes: clapClip });
  let m = await waitFor(clap.ref, (x) => x.claims && x.videoReview?.status === "waiting");
  ok(
    m?.claims?.items?.map((c) => `${c.id} ${c.kind} ${c.text}`).join(" | ") === "c1 action clapping | c2 count 50 claps" && m.claims.items[1].value === 50,
    "typed intention -> server claims: action 'clapping' + count '50 claps'",
    m?.claims?.items,
  );
  ok(m?.plan?.recordMode === "video" && m.plan.requirements.every((q) => q.evidence === "video") && m.plan.requirements[1].minSeconds === 20, "server plan: one continuous video, >= 20 s for the count", m?.plan?.requirements);
  ok(m?.videoReview?.reason === "waiting for video upload" && m.videoReview.clips[0].uploaded === false, "seal waits for the clip", m?.videoReview);
  await sleep(1500);
  ok((await clap.ref.get()).get("status") === "submitted" && !(await clap.ref.get()).get("seal"), "no seal while the clip is missing");
  await getStorage().bucket(bucketName).file(clap.path).save(clapClip, { contentType: "video/webm" });
  m = await waitFor(clap.ref, (x) => !!x.seal);
  ok(m?.videoReview?.status === "done" && m.videoReview.clips[0].hashOk === true && m.videoReview.claims.every((c) => c.verdict === "backed"), "clip uploaded -> free video review backs both claims", m?.videoReview?.claims);
  ok(
    m?.status === "sealed" && m.seal.version === 4 && m.seal.checks.cheating === true && m.seal.reason === `All 2 claims backed · score ${m.bar.value.toFixed(2)} ≥ bar ${m.bar.value.toFixed(2)}`,
    "Verified with no paid module",
    m?.seal?.reason,
  );
  ok(
    m?.verification?.modules.length === 0 && near(m.verification.score, m.bar.value) && m.verification.baselineUsed === 0.4 && m.verification.claimsBacked === 2 && m.verification.claims.every((c) => c.backedBy[0] === "video_review"),
    "baseline 0.40 -> both claims at the bar via the video review",
    m?.verification?.claims,
  );
  const clapFeed = (await db.doc(`feed/${CLAP}`).get()).data();
  ok(clapFeed?.claimsBacked === 2 && clapFeed.claimsTotal === 2 && clapFeed.video.reviewed === true && clapFeed.plan.requirements.every((q) => q.met) && clapFeed.status === "sealed", "feed: 2/2 claims backed, video reviewed", clapFeed?.video);

  console.log('v4: "Clap 50 times" in the client order: clip uploaded before submit, never waits');
  const CLAP2 = "e2e00000-0000-4000-8000-0000000c1a55";
  const clap2 = await recordClap(CLAP2, { clipBytes: Buffer.from("fifty claps, uploaded before submit"), upload: "before" });
  m = await waitFor(clap2.ref, (x) => !!x.seal);
  ok(
    m?.status === "sealed" && m.videoReview?.status === "done" && m.videoReview.attempts === 1 && m.verification?.modules.length === 0 && m.verification.claimsBacked === 2,
    "clip at submit -> video review -> Verified, no paid module",
    m?.seal?.reason,
  );

  console.log("v4: a clip over the 200 MB upload limit does not hold the seal for 24 h");
  const BIG = "e2e00000-0000-4000-8000-0000000c1a56";
  const big = await recordClap(BIG, { clipBytes: Buffer.from("a 4K clip the client skipped"), chainedBytes: 250 * 1024 * 1024 });
  m = await waitFor(big.ref, (x) => !!x.seal);
  ok(
    m?.videoReview?.status === "expired" && m.videoReview.reason === "video too large to upload" && m.seal.checks.cheating === true && m.status === "rejected",
    "oversize clip: sealed at once without it, video requirements unmet, not cheating",
    m?.videoReview,
  );

  console.log("v4: a tampered clip uploaded at submit is cheating (kept as evidence)");
  const TAMPER = "e2e00000-0000-4000-8000-0000000c1a51";
  const tamper = await recordClap(TAMPER, { clipBytes: Buffer.from("the bytes the chain committed to"), upload: "before", uploadBytes: Buffer.from("some other video") });
  m = await waitFor(tamper.ref, (x) => !!x.seal);
  ok(
    m?.videoReview?.clips?.[0]?.hashOk === false && m.status === "rejected" && m.seal.checks.cheating === false && m.seal.reason === "Cheating detected: video: clip does not match the chain",
    "hash mismatch -> cheating, rejected",
    m?.seal?.reason,
  );
  ok(m?.verification?.claims.every((c) => c.p <= 0.1) && m.seal.ladderEligible === false, "every claim capped at 0.1, not ladder-eligible");
  ok((await getStorage().bucket(bucketName).file(tamper.path).exists())[0], "the mismatched clip is kept");

  console.log("v4: a clip that never arrives expires after 24 h; count_measure backs the typed count");
  const LATE = "e2e00000-0000-4000-8000-0000000c1a52";
  const late = await recordClap(LATE, { clipBytes: Buffer.from("never uploaded"), submittedAtServer: Timestamp.fromMillis(Date.now() - 25 * 3_600_000) });
  m = await waitFor(late.ref, (x) => !!x.seal);
  ok(
    m?.videoReview?.status === "expired" && m.videoReview.reason === "video never arrived" && m.status === "rejected" && m.seal.checks.cheating === true && /^0 of 2 claims backed · clapping 0\.40 < bar /.test(m.seal.reason),
    "sealed without the clip: video unmet, not cheating",
    m?.seal?.reason,
  );
  r = await call("runLadderModule", { momentId: LATE, module: "count_measure", requestId: rid() }, alice.token);
  ok(
    r.result?.claims?.length === 1 && r.result.claims[0].id === "c2" && r.result.claims[0].passed === true && near(r.result.claims[0].after, 0.4 + 0.3 * 0.6) && r.result.claimScores.find((c) => c.id === "c1").p === 0.4,
    "count_measure is unlocked by the server count claim and moves only '50 claps'",
    r.result?.claims,
  );
  r = await call("runLadderModule", { momentId: LATE, module: "full_video", requestId: rid() }, alice.token);
  ok(r.error?.reason === "clip_missing", "full_video on an expired upload -> clip_missing", r.error);
  // A clip that arrives after the expiry was never seal evidence: a wrong upload is removed so the right one can follow.
  await getStorage().bucket(bucketName).file(late.path).save(Buffer.from("not the chained bytes"), { contentType: "video/webm" });
  r = await call("runLadderModule", { momentId: LATE, module: "full_video", requestId: rid() }, alice.token);
  ok(r.error?.reason === "clip_hash_mismatch" && !(await getStorage().bucket(bucketName).file(late.path).exists())[0], "late wrong clip -> clip_hash_mismatch, removed (not seal evidence)", r.error);
  await getStorage().bucket(bucketName).file(late.path).save(Buffer.from("never uploaded"), { contentType: "video/webm" });
  r = await call("runLadderModule", { momentId: LATE, module: "full_video", requestId: rid() }, alice.token);
  // (the fake full_video follows the frames judge, which was "uncertain" here: the run happens, per claim, and fails)
  ok(r.result && r.result.claims.map((c) => c.id).join(",") === "c1,c2" && r.result.claims.every((c) => c.verdict === "not_backed" && !c.passed), "late right clip -> full_video runs on both claims", r.result?.claims ?? r.error);
  m = (await late.ref.get()).data();
  ok(m.seal.version === 4 && m.verification.modules.length === 2 && m.videoReview.status === "expired", "the expired Moment keeps seal v4; modules recorded per claim", m.verification.modules.map((x) => x.module));

  console.log("v4: the model fails: default claim, video review retried once, then failed (not cheating)");
  const DOWN = "e2e00000-0000-4000-8000-0000000c1a53";
  const down = await recordClap(DOWN, { clipBytes: Buffer.from("model is down"), upload: "before", text: "Clap 50 times #ai-fail" });
  m = await waitFor(down.ref, (x) => !!x.seal);
  ok(m?.bar?.source === "default" && m.claims?.source === "default" && m.claims.items.length === 1, "barAndClaims failure -> default bar and one outcome claim", m?.claims);
  ok(m?.videoReview?.status === "failed" && m.videoReview.attempts === 2 && m.videoReview.clips[0].hashOk === true && m.seal.checks.cheating === true, "video review failed after 2 attempts; sealed without it, not cheating", m?.videoReview);
} else {
  console.log("  (storage emulator not running: full_video and the v4 video review skipped)");
}

const ledger = await db.collection(`credits/${alice.uid}/ledger`).get();
console.log(`  ledger: ${ledger.docs.map((d) => `${d.get("kind")}${d.get("delta") > 0 ? "+" : ""}${d.get("delta")}`).join(" ")}`);
console.log(failures ? `ladder-check: ${failures} FAILED` : "ladder-check: all ok");
process.exit(failures ? 1 : 0);
