// v4.12 shared video, end to end against the Emulator Suite (auth, firestore, storage running; `npm run dev:emu`):
// seeds a sealed Moment owned by someone else with one uploaded clip + its feed entry, then as a signed-out visitor
// checks the feed slide autoplays the clip muted, the sound toggle unmutes it, and the evidence room plays it.
// CLIP=path/to/clip.webm (any small webm), BASE, CHROME, PROJECT as in e2e-emu.mjs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "http://localhost:5173";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const PROJECT = process.env.PROJECT || "verified-99e74";
const BUCKET = process.env.BUCKET || `${PROJECT}.appspot.com`;
const CLIP = process.env.CLIP;
if (!CLIP) throw new Error("set CLIP=path/to/clip.webm");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= "127.0.0.1:9199";
const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
initializeApp({ projectId: PROJECT, storageBucket: BUCKET });

const id = "shared-video-check";
const uid = "someone-else";
const bytes = readFileSync(CLIP);
const sha = createHash("sha256").update(bytes).digest("hex");
const path = `clips/${uid}/${id}/${sha}.webm`;
await getStorage().bucket().file(path).save(bytes, { contentType: "video/webm" });
const vr = { status: "done", clips: [{ sha256: sha, ext: "webm", durationMs: 4000, startedAt: null, uploaded: true, hashOk: true }], claims: [], cheating: { detected: false, signals: [] }, summary: "test clip", attempts: 1, reason: null, model: "fake", ranAt: Date.now() };
const intention = { text: "Shared video check" };
await getFirestore().doc(`moments/${id}`).set({ ownerUid: uid, owner: { name: "Tester", photoURL: null }, status: "sealed", intention, videoReview: vr, startedAt: Date.now() - 60000, endedAt: Date.now(), chunkCount: 0, platform: "web", onDevice: { mode: "none" }, device: { model: "test" }, summary: { durationMs: 60000, distanceM: 0, frameCount: 1, gpsCount: 0, motionCount: 0 } });
await getFirestore().doc(`feed/${id}`).set({
  momentId: id, owner: { name: "Tester", photoURL: null }, intention, platform: "web", status: "sealed", sealReason: "check",
  summary: { durationMs: 60000, distanceM: 0, frameCount: 1, gpsCount: 0, motionCount: 0 }, checks: {}, judgeReasons: [], skepticReasons: [], scoreReasons: [],
  verificationScore: 0.9, bar: 0.5, heroJpegB64: null, track: [], sealedAtServer: Timestamp.fromMillis(Date.now() + 3600e3),
  video: { reviewed: true, summary: "test clip", status: "done", clips: [{ path, sha256: sha, ext: "webm", contentType: "video/webm", durationMs: 4000, hashOk: true }] },
});
console.log("seeded", path);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let ok = true;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`);
  ok &&= !!cond;
};

await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForSelector(`.slide[data-id="${id}"]`);
await page.evaluate((id) => document.querySelector(`.slide[data-id="${id}"]`).scrollIntoView(), id);
const v = page.locator(`.slide[data-id="${id}"] video.slide-video`);
await v.waitFor({ timeout: 15000 });
await page.waitForSelector(`.slide[data-id="${id}"] video.slide-video.is-on`, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
let st = await v.evaluate((el) => ({ muted: el.muted, paused: el.paused, t: el.currentTime, loop: el.loop, controls: el.controls, on: el.classList.contains("is-on") }));
check("feed slide autoplays the clip muted and looping, no controls", st.muted && !st.paused && st.t > 0 && st.loop && !st.controls && st.on, JSON.stringify(st));
check("only one feed video is mounted", (await page.locator("video.slide-video").count()) === 1);

await page.locator(`.slide[data-id="${id}"] .rail-btn[aria-pressed]`).click();
st = await v.evaluate((el) => ({ muted: el.muted, paused: el.paused }));
check("sound toggle unmutes", !st.muted && !st.paused, JSON.stringify(st));

await page.evaluate(() => document.querySelector(".tok-scroll").scrollTo({ top: 0 }));
await page.waitForTimeout(1200);
check("leaving the slide unmounts the player", (await page.locator("video.slide-video").count()) === 0);

await page.goto(`${BASE}/m/${id}`, { waitUntil: "load" });
const dv = page.locator(".shared-clips video");
await dv.waitFor({ timeout: 15000 });
await page.waitForFunction(() => (document.querySelector(".shared-clips video")?.readyState ?? 0) >= 1, null, { timeout: 15000 }).catch(() => {});
st = await dv.evaluate((el) => ({ controls: el.controls, ready: el.readyState, paused: el.paused, d: el.duration }));
check("evidence room plays the clip with controls, not autoplayed", st.controls && st.ready >= 1 && st.paused && st.d > 3, JSON.stringify(st));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(ok ? 0 : 1);
