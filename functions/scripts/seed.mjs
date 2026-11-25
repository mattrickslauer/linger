#!/usr/bin/env node
// Seeds 4 demo Moments through the real data path so the Cloud Function seals them:
//   create moment (recording) -> hashed chunks (+frames) -> submit -> judge + skeptic -> [function seals]
// Usage (from repo root):
//   npm run seed                       # emulator (127.0.0.1:8080), waits for the seal
//   npm run seed -- --prod             # real project verified-99e74 via Application Default Credentials
//   npm run seed -- --no-wait          # don't wait for the function
// Specs: shared/sample-moments/moments.json. Frames: shared/sample-moments/frames/*.jpg.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

const PROD = flag("--prod");
const WAIT = !flag("--no-wait");
const PROJECT = opt("--project", process.env.GCLOUD_PROJECT || "verified-99e74");
if (!PROD) process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const seal = require("../lib/seal.js"); // run `npm run build` first (the npm script does)

initializeApp({ projectId: PROJECT });
const db = getFirestore();

// ───────────────────────── deterministic randomness + geo helpers

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const M_PER_DEG_LAT = 111_320;
const offset = (lat, lng, dx, dy) => [lat + dy / M_PER_DEG_LAT, lng + dx / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))];
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const r3 = (x) => Math.round(x * 1e3) / 1e3;
const r1 = (x) => Math.round(x * 10) / 10;

// Position (metres east/north of start, altitude delta, speed) at time s seconds, per kind.
function pathFn(kind, durationS) {
  switch (kind) {
    case "fishing": // walk 70 m along the shore, then fish from one spot
      return (s) => {
        const walk = Math.min(s, 70);
        return { x: walk * 0.95, y: walk * 0.3, dz: 0, v: s < 70 ? 1.0 : 0 };
      };
    case "run": { // out-and-back with a gentle curve, ~5.1 km
      const v = 4640 / durationS; // radial out-and-back on a curve; path length comes out ~5.1 km
      const half = durationS / 2;
      return (s) => {
        const d = (s <= half ? s : durationS - s) * v; // distance from start along the out leg
        const side = s <= half ? 0 : 18; // come back on the other side of the creek
        const ang = 0.35 + 0.25 * Math.sin(d / 400);
        const x = d * Math.sin(ang) + side;
        const y = d * Math.cos(ang);
        return { x, y, dz: 8 * Math.sin(d / 600), v };
      };
    }
    case "hike": { // switchbacks, 2.0 km, +250 m
      const v = 2000 / durationS;
      return (s) => {
        const d = s * v;
        const leg = Math.floor(d / 160);
        const into = d - leg * 160;
        const x = (leg % 2 ? 160 - into : into) * 0.8;
        const y = leg * 70 + into * 0.35;
        return { x, y, dz: (250 * d) / 2000, v };
      };
    }
    default: // fake: sitting at home
      return () => ({ x: 0, y: 0, dz: 0, v: 0 });
  }
}

function motionSample(kind, s, rand, fight) {
  const n = (a) => (rand() - 0.5) * 2 * a;
  let ax = n(0.08), ay = 9.81 + n(0.08), az = n(0.08), gx = n(0.01), gy = n(0.01), gz = n(0.01);
  const w = (hz) => Math.sin(2 * Math.PI * hz * s);
  if (kind === "run") {
    ay += 3.6 * w(2.8); ax += 1.3 * w(1.4); az += 0.8 * w(2.8 + 0.1); gx += 0.9 * w(1.4); gz += 0.4 * w(2.8);
  } else if (kind === "hike") {
    ay += 1.5 * w(1.8); ax += 0.5 * w(0.9); gx += 0.3 * w(0.9);
  } else if (kind === "fishing") {
    if (s > 30 && s < 32) { ax += 7 * w(1.5); gz += 3 * w(1.5); } // cast
    if (fight(s)) { ax += n(3.5); ay += n(3.5); az += n(2.5); gx += n(1.2); gy += n(1.2); }
  } else {
    ax += n(0.02); // phone in hand, indoors
  }
  return [ax, ay, az, gx, gy, gz].map(r3);
}

// ───────────────────────── build one moment's chunks

function buildMoment(spec, frameB64) {
  const rand = rng(parseInt(spec.id.slice(-4), 16));
  const T = Math.floor((Date.now() - spec.hoursAgo * 3600_000) / 1000) * 1000;
  const END = T + spec.durationS * 1000;
  const pos = pathFn(spec.kind, spec.durationS);
  const fight = (s) => spec.kind === "fishing" && s > 270 && s < 300;

  // samples
  const gps = [];
  for (let s = 0; s <= spec.durationS; s++) {
    const p = pos(s);
    const acc = 4 + rand() * 4;
    // slow, smooth GPS wander (real receivers drift; white noise would inflate the distance)
    const [lat, lng] = offset(spec.start.lat, spec.start.lng, p.x + 1.5 * Math.sin(s / 23), p.y + 1.5 * Math.cos(s / 31));
    gps.push([T + s * 1000 + Math.floor(rand() * 40), r6(lat), r6(lng), r1(acc), r1(spec.start.alt + p.dz), r1(p.v * (0.9 + rand() * 0.2))]);
  }
  const motion = [];
  for (let k = 0; k < spec.durationS * 10; k++) {
    const s = k / 10;
    motion.push([T + k * 100 + 50, ...motionSample(spec.kind, s, rand, fight)]);
  }

  // chunk boundaries: every 5 s, and a chunk closes immediately when a frame is taken
  const frameAt = new Map(spec.frames.map((f) => [T + f.atS * 1000, f]));
  const bounds = new Set([T, END, ...frameAt.keys()]);
  for (let t = T + 5000; t < END; t += 5000) bounds.add(t);
  const b = [...bounds].sort((x, y) => x - y);

  const chunks = [];
  let prev = seal.genesis(spec.id);
  let heroSeq = null;
  for (let i = 0; i < b.length - 1; i++) {
    const t0 = b[i];
    const t1 = b[i + 1];
    const last = i === b.length - 2;
    const inC = (t) => t >= t0 && (t < t1 || (last && t <= t1));
    const events = [];
    if (i === 0) events.push({ t: T, type: "start" });
    const f = frameAt.get(t1);
    let frame = null;
    let frameSha = null;
    let check = null;
    if (f) {
      const jpegB64 = frameB64(f.file);
      frame = { jpegB64, w: 640, h: 480, t: t1 };
      frameSha = seal.sha256hex(jpegB64);
      check = f.check;
      events.push({ t: t1, type: "frame" });
      events.push({ t: t1, type: f.check.ok ? "check" : "retake", ok: f.check.ok, reason: f.check.reason });
      if (f.hero) heroSeq = i;
    }
    if (last) events.push({ t: END, type: "stop" });
    const payload = JSON.stringify({ gps: gps.filter((g) => inC(g[0])), motion: motion.filter((m) => inC(m[0])), events, frameSha, check });
    const c = { seq: i, t0, t1, prevHash: prev, payload, hash: "", frame };
    c.hash = seal.chunkHash(c);
    prev = c.hash;
    chunks.push(c);
  }
  const summary = seal.computeSummary({ summary: { heroFrameSeq: heroSeq } }, chunks, chunks.map((c) => JSON.parse(c.payload)));
  return { T, END, chunks, summary, headHash: prev };
}

// ───────────────────────── write through the real path

async function seedOne(spec, frameB64) {
  const ref = db.collection("moments").doc(spec.id);
  await db.recursiveDelete(ref);
  await db.collection("feed").doc(spec.id).delete();

  const { T, END, chunks, summary, headHash } = buildMoment(spec, frameB64);
  await db.collection("users").doc(spec.owner.uid).set({ displayName: spec.owner.name, photoURL: spec.owner.photoURL, createdAtServer: FieldValue.serverTimestamp() });

  // 1. start
  await ref.set({
    ownerUid: spec.owner.uid,
    owner: { name: spec.owner.name, photoURL: spec.owner.photoURL },
    intention: spec.intention,
    platform: spec.platform,
    device: spec.device,
    status: "recording",
    startedAt: T,
    endedAt: null,
    chunkCount: 0,
    headHash: null,
    summary: null,
    onDevice: spec.onDevice,
    judge: null,
    skeptic: null,
    score: null,
    seal: null,
    createdAtServer: FieldValue.serverTimestamp(),
  });
  // 2. chunks (client writes them one by one while recording; BulkWriter is just faster here)
  const bw = db.bulkWriter();
  for (const c of chunks) bw.create(ref.collection("chunks").doc(seal.chunkId(c.seq)), c);
  await bw.close();
  // 3. finish
  await ref.update({ status: "submitted", endedAt: END, chunkCount: chunks.length, headHash, summary, submittedAtServer: FieldValue.serverTimestamp() });
  // 4. judge + skeptic + scorer (the apps call Firebase AI Logic ONLY_IN_CLOUD; here they are scripted)
  const ranAt = END + 15_000;
  await ref.update({
    judge: { ...spec.judge, model: "seeded-demo", ranAt },
    skeptic: { ...spec.skeptic, model: "seeded-demo", ranAt: ranAt + 1200 },
    score: spec.score ? { ...spec.score, model: "seeded-demo", ranAt: ranAt + 1500 } : null,
  });
  return { chunks: chunks.length, summary };
}

async function waitForSeal(id, timeoutMs = 120_000) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const s = (await db.collection("moments").doc(id).get()).data();
    if (s?.seal) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

const spec = JSON.parse(readFileSync(join(root, "shared/sample-moments/moments.json"), "utf8"));
const frameB64 = (file) => readFileSync(join(root, "shared/sample-moments/frames", file)).toString("base64");
const only = opt("--only", null);

console.log(`Seeding ${PROD ? "PRODUCTION project " + PROJECT : "emulator " + process.env.FIRESTORE_EMULATOR_HOST + " (" + PROJECT + ")"}`);
let bad = 0;
for (const m of spec.moments) {
  if (only && !m.id.endsWith(only) && m.kind !== only) continue;
  const r = await seedOne(m, frameB64);
  console.log(`  wrote ${m.kind.padEnd(8)} ${m.id}  ${r.chunks} chunks, ${r.summary.frameCount} frames, ${Math.round(r.summary.distanceM)} m, ${Math.round(r.summary.durationMs / 1000)} s`);
}
if (WAIT) {
  console.log("Waiting for the Cloud Function to seal...");
  for (const m of spec.moments) {
    if (only && !m.id.endsWith(only) && m.kind !== only) continue;
    const s = await waitForSeal(m.id);
    if (!s) {
      bad++;
      console.log(`  ${m.kind.padEnd(8)} NO SEAL (is the functions emulator running? npm run emulators)`);
      continue;
    }
    const expect = m.kind === "fake" ? "rejected" : "sealed";
    if (s.status !== expect) bad++;
    console.log(`  ${m.kind.padEnd(8)} ${s.status.padEnd(8)} ${s.status === expect ? "(as expected)" : "(UNEXPECTED, wanted " + expect + ")"}  ${JSON.stringify(s.seal.checks)}  ${s.seal.reason}`);
  }
}
process.exit(bad ? 1 : 0);
