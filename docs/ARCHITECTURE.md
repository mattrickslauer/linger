# Verified — Architecture (canonical)

> Firebase #BuildHybridAI 2026. Deadline Mon 30 Nov 2026 14:00 PT. Rules: `docs/rules/` (authority).
> This file is the **contract** every platform builds against. Change it here first, then in code.

## The product in one loop

1. **Sign in with Google** (Firebase Auth) on iOS, Android or web.
2. **Declare an intention**: one sentence ("Catch and release a largemouth bass at Lake Mission Viejo") plus a category.
3. **Record a Moment**: a live, Strava-style session that captures a high-dimensional time series:
   GPS track, motion (accelerometer + gyroscope), proof frames from the camera, and app events —
   all chained with SHA-256 so nothing can be inserted, removed or reordered afterwards.
4. **On-device AI coaches live** (hybrid, `PREFER_ON_DEVICE`): every proof frame is checked against the
   intention *on the device*. It can only say **"keep going"** or **"retake: <reason>"**. It can never verify.
5. **Offline-first**: everything is written through Firestore with offline persistence. At the lake with no
   signal, the Moment records and queues; it syncs by itself when the phone is back online.
6. **Judge + Skeptic in the cloud** (`ONLY_IN_CLOUD`, via Firebase AI Logic on the client at sync time): a
   judge proposes a verdict, a separate skeptic hunts for fake signals.
7. **Deterministic seal**: a Cloud Function re-checks the hash chain, timing and physics, reads both AI
   opinions, and alone writes the seal and the public feed entry. AI proposes; code decides.
8. **Public feed**: judges open the web app (no sign-in needed) and browse sealed Moments: map track,
   frame timeline, motion graph, AI reasoning, seal checks.

Hero story for the video: a verified fishing catch (DerbyFish derbies pay prizes; photo fraud is the problem).

## Platforms and priority

| Priority | Platform | Dir | Stack | On-device model |
|---|---|---|---|---|
| 1 | iOS 26+ | `ios/` | Swift 6, SwiftUI, Firebase iOS SDK (SPM), FirebaseAI hybrid | Apple Foundation Models (text only) fed by Apple Vision labels of the frame |
| 2 | Android 10+ | `android/` | Kotlin, Jetpack Compose, Firebase Android BoM, Firebase AI Logic hybrid | Gemini Nano (image+text) when available; else cloud |
| 3 | Web (Chrome) | `web/` | React + Vite + TypeScript, Firebase JS SDK, `firebase/ai` hybrid | Gemini Nano in Chrome (Prompt API) when available; else cloud |
| — | Backend | `functions/`, `firestore.rules` | Cloud Functions v2 (Node 22, TS), Firestore | — |

Firebase project: `linger-reader`. App ids: web `1:802156319542:web:c726231211014eae1f9997`,
iOS `1:802156319542:ios:580bc5a2da33c73b1f9997` (bundle `com.mattricks.verified`),
Android `1:802156319542:android:762ce35b55bc50351f9997` (package `com.mattricks.verified`).
Config files live **git-ignored** in `config/` of the verified-core worktree
(`/home/mattricks/Code/firebase-hackathon/.claude/worktrees/verified-core/config/`): `GoogleService-Info.plist`,
`google-services.json`, `web-config.json`. Never commit them.

Cloud model: `gemini-3.5-flash` (judge/skeptic), on-device as above. Model names come from Remote Config key
`cloud_model` with that default.

## Data model (Firestore)

All timestamps are **epoch milliseconds (number)** from the device clock unless named `*Server`
(Firestore `serverTimestamp()`).

### `users/{uid}`
`{ displayName, photoURL, createdAtServer }` — written by the client on first sign-in.

### `moments/{momentId}`  (momentId = client-generated UUID v4, lowercase)
```
ownerUid: string
owner: { name: string, photoURL: string|null }
intention: { text: string (≤200), category: "fishing"|"fitness"|"outdoors"|"making"|"other" }
platform: "ios"|"android"|"web"
device: { model: string, os: string, appVersion: string }
status: "recording" | "submitted" | "sealed" | "rejected"
startedAt: number
endedAt: number|null
chunkCount: number            // set at submit; == number of chunk docs
headHash: string|null         // hash of the last chunk, set at submit
summary: {                    // computed by the client at submit (the seal recomputes and compares)
  durationMs, distanceM, frameCount, gpsCount, motionCount,
  start: {lat,lng}|null, end: {lat,lng}|null, heroFrameSeq: number|null
}
onDevice: { mode: "on_device"|"cloud"|"none", checks: number, retakes: number }
judge:   AiOpinion|null       // written by the client after sync (cloud call)
skeptic: AiOpinion|null
seal: Seal|null               // written ONLY by the Cloud Function
createdAtServer, submittedAtServer
```
`AiOpinion = { verdict: "consistent"|"inconsistent"|"uncertain", confidence: 0..1, reasons: string[], model: string, ranAt: number }`
(skeptic uses the same shape; "inconsistent" means it found a fake signal.)

`Seal = { sealed: boolean, at: serverTimestamp, checks: { chain: bool, timing: bool, physics: bool, frames: bool, ai: bool }, reason: string, version: 1 }`

### `moments/{momentId}/chunks/{seq}`  (doc id = seq zero-padded to 6 digits, `000000`)
```
seq: number          // 0,1,2,... no gaps
t0: number, t1: number
prevHash: string     // "GENESIS:" + momentId for seq 0
payload: string      // JSON string, EXACT bytes hashed (see below)
hash: string         // lowercase hex sha256( `${seq}|${t0}|${t1}|${prevHash}|${sha256hex(payload)}` )
frame: { jpegB64: string, w: number, h: number, t: number } | null   // NOT in payload; payload holds frameSha
```
`payload` JSON (written as a string so all three languages hash identical bytes):
```
{
  "gps":    [[t, lat, lng, accuracyM, altitudeM|null, speedMps|null], ...],   // ~1 Hz
  "motion": [[t, ax, ay, az, gx, gy, gz], ...],                               // 10 Hz, m/s^2 and rad/s
  "events": [{"t":..., "type":"start"|"frame"|"check"|"retake"|"pause"|"resume"|"stop", ...}],
  "frameSha": "<sha256hex of the base64 jpeg string>" | null,
  "check": { "ok": bool, "reason": string, "mode": "on_device"|"cloud"|"none", "label": string } | null
}
```
A chunk closes every **5 s** or immediately when a proof frame is taken (one frame max per chunk).
Frames: JPEG, longest side **640 px**, quality 0.6, target < 120 KB base64 (Firestore doc limit 1 MB).
SHA-256 helpers must hash UTF-8 bytes and output lowercase hex. Test vector in `shared/test-vectors.json`.

### `feed/{momentId}`  (public read; written ONLY by the Cloud Function)
```
momentId, owner, intention, platform, summary, onDeviceMode,
status: "sealed"|"rejected", sealReason, checks, judgeReasons: string[],
heroJpegB64: string|null, track: [[lat,lng], ...] (≤200 pts, downsampled), sealedAtServer
```

## Flow and responsibilities

```
client (any platform)                                      server (Cloud Function onMomentWritten)
──────────────────────                                     ───────────────────────────────────────
create moments/{id} status=recording
every 5s / on frame: write chunks/{seq} (offline OK)
per frame: on-device check → "keep going" | "retake"
stop: write summary, chunkCount, headHash, status=submitted
when online & status=submitted & judge==null:
   judge + skeptic via AI Logic ONLY_IN_CLOUD (hero frame
   + up to 3 frames + summary + intention) → write judge,skeptic
                                                           trigger when status=submitted && judge && skeptic && !seal
                                                           wait until chunk count == chunkCount (else no-op; retrigger
                                                             on chunk writes via onChunkWritten touching parent)
                                                           recompute: chain (every hash, prevHash links, headHash),
                                                             timing (t monotonic, duration ≥ 20s, endedAt ≥ last t1),
                                                             physics (no GPS jump > 70 m/s; motion not all-zero if any),
                                                             frames (≥1 frame; frameSha matches),
                                                             ai (judge consistent ≥0.6 AND skeptic != inconsistent)
                                                           write seal; status=sealed|rejected; write feed/{id}
```

The seal's AI check is honest about its limits: the client calls the cloud models (rules require AI to run
through Firebase AI Logic), so the hackathon trust model is "tamper-evident data + two independent AI opinions
+ deterministic gates". Post-hackathon: move judge calls server-side.

## Security rules (summary — `firestore.rules` is authoritative)

- `feed/*`: read public; write never (Function uses Admin SDK).
- `moments/{id}`: create by signed-in owner with `ownerUid == auth.uid`, `status == "recording"`, `seal == null`.
  Update by owner only while `status in ["recording","submitted"]`, never touching `seal`, and `status` may only
  move recording→submitted. Read: owner, or anyone once `status in ["sealed","rejected"]`.
- `chunks/*`: create by moment owner while parent `status == "recording"` or (`submitted` and seq < chunkCount — offline
  tail). No update/delete. Read: same as parent.
- `users/{uid}`: read public; write self.

## Prompts (shared — `shared/prompts.json` is authoritative)

- `liveCheck` (on-device, per frame): intention + (image | Vision labels text) → `{ ok, reason, label }`.
- `judge` (cloud): intention, summary, frames → `AiOpinion`.
- `skeptic` (cloud): same inputs, told to look for staging, screen photos, reused/stock images, mismatched
  place/time → `AiOpinion`.

## UI (all platforms share the words)

Tabs: **Feed** · **Record** · **Me**. Record: intention field + category chips → big **Start Moment** →
live screen (timer, distance, GPS dot, motion sparkline, **Proof shot** button, on-device coach banner
"On-device: keep going" / "Retake: fish not visible", sync badge "Offline · 12 chunks queued") → **Finish**.
Moment card: hero frame, intention, owner, duration · distance · frames, badge **Verified ✓** / **Not verified**,
platform + "checked on-device" chip. Detail: map track, frame timeline, motion chart, judge/skeptic reasons,
seal checklist.

## Repo layout

```
docs/ARCHITECTURE.md  this file
shared/               prompts.json, test-vectors.json, sample-moment.json (seed data)
functions/            Cloud Function (TS) + emulator tests
firestore.rules, firestore.indexes.json, firebase.json
web/                  React app (feed public, recorder)
ios/                  Xcode project (XcodeGen project.yml) — Verified.app
android/              Gradle project — app module
config/               git-ignored Firebase config files
```
