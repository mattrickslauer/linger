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
6. **Judge + Skeptic + Scorer in the cloud** (`ONLY_IN_CLOUD`, via Firebase AI Logic on the client at sync
   time): a judge proposes a verdict, a separate skeptic hunts for fake signals, and a scorer gives the
   verification score: P(claim true | evidence), starting from a prior that most submissions cheat (0.2).
7. **Deterministic seal**: a Cloud Function re-checks the hash chain, timing and physics, reads all three AI
   outputs, and alone writes the seal and the public feed entry. AI proposes; code decides.
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

Firebase project: `verified-99e74` (switched from `linger-reader` on 2026-11-24). App ids: web `1:726678528605:web:f550d3f11e8ccf787263b4`,
iOS `1:726678528605:ios:7c2fc9c82d1ac7a37263b4` (bundle `com.mattrickslauer.verified`, the App Store Connect record;
the older iOS app `1:726678528605:ios:7a98231181871ed67263b4` is for the unused `com.mattricks.verified`),
Android `1:726678528605:android:dab78f52952073fc7263b4` (package `com.mattrickslauer.verified`, the Play listing id;
the Kotlin namespace stays `com.mattricks.verified`). The older Firebase app for `com.mattricks.verified`
(`…:android:569f9ce4ec35c6c87263b4`) is unused.
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
score:   VerificationScore|null // written in the SAME update as judge + skeptic; absent on older Moments
seal: Seal|null               // written ONLY by the Cloud Function
createdAtServer, submittedAtServer
```
`AiOpinion = { verdict: "consistent"|"inconsistent"|"uncertain", confidence: 0..1, reasons: string[], model: string, ranAt: number }`
(skeptic uses the same shape; "inconsistent" means it found a fake signal.)

`VerificationScore = { probability: 0..1, reasons: string[] (≤4), model: string, ranAt: number }`: the scorer's
P(claim true | evidence) under an adversarial prior of 0.2 (most submissions assumed to be cheating). Only evidence
that is hard to fake moves it up; generic evidence leaves it near 0.2. The seal needs ≥ 0.5 when a score is present.

`Seal = { sealed: boolean, at: serverTimestamp, checks: { chain: bool, timing: bool, physics: bool, frames: bool, ai: bool }, reason: string, version: 2 }`
(version 2 = the `ai` check also gates on the verification score.)

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
  "events": [{"t":..., "type":"start"|"frame"|"check"|"retake"|"pause"|"resume"|"stop"|"video_start"|"video"|"hr", ...}],
  "frameSha": "<sha256hex of the base64 jpeg string>" | null,
  "check": { "ok": bool, "reason": string, "mode": "on_device"|"cloud"|"none", "label": string } | null
}
```
A chunk closes every **5 s** or immediately when a proof frame is taken (one frame max per chunk).
Optional events (Android and iOS today; the seal ignores unknown types):
- `video_start` — a video clip began. `video` `{sha256, bytes, durationMs, startedAt, name}` — the clip stays on the
  phone (gallery: Movies/Verified on Android, Photos album "Verified" on iOS); the chain commits to the SHA-256 of its file bytes. The clip's middle frame is the
  proof frame of the same chunk (coached + judged like a photo), so `video` sits next to the `frame` event.
- `hr` `{bpm}` — ~1 Hz heart rate from a Bluetooth LE Heart Rate (0x180D) device connected in Settings.
Frames: JPEG, longest side **640 px**, quality 0.6, target < 120 KB base64 (Firestore doc limit 1 MB).
SHA-256 helpers must hash UTF-8 bytes and output lowercase hex. Test vector in `shared/test-vectors.json`.

### `feed/{momentId}`  (public read; written ONLY by the Cloud Function)
```
momentId, owner, intention, platform, summary, onDeviceMode,
status: "sealed"|"rejected", sealReason, checks, judgeReasons: string[], skepticReasons: string[],
verificationScore: number|null, scoreReasons: string[],
heroJpegB64: string|null, track: [{lat,lng}, ...] (≤200 pts, downsampled), sealedAtServer
```
`track` is a list of `{lat, lng}` maps, not `[[lat,lng]]`: Firestore cannot store nested arrays.
Clients read `p.lat` / `p.lng`.

## Flow and responsibilities

```
client (any platform)                                      server (Cloud Function onMomentWritten)
──────────────────────                                     ───────────────────────────────────────
create moments/{id} status=recording
every 5s / on frame: write chunks/{seq} (offline OK)
per frame: on-device check → "keep going" | "retake"
stop: write summary, chunkCount, headHash, status=submitted
when online & status=submitted & judge==null:
   judge + skeptic + scorer via AI Logic ONLY_IN_CLOUD (hero
   frame + up to 3 frames + summary + intention), in parallel
   → write judge,skeptic,score in one update
                                                           trigger when status=submitted && judge && skeptic && !seal
                                                           wait until chunk count == chunkCount (else no-op; retrigger
                                                             on chunk writes via onChunkWritten touching parent)
                                                           recompute: chain (every hash, prevHash links, headHash),
                                                             timing (t monotonic, duration ≥ 20s, endedAt ≥ last t1),
                                                             physics (no GPS jump > 70 m/s; motion not all-zero if any),
                                                             frames (≥1 frame; frameSha matches),
                                                             ai (judge consistent ≥0.6 AND skeptic != inconsistent
                                                               AND score.probability ≥ 0.5 if score present)
                                                           write seal; status=sealed|rejected; write feed/{id}
```

The seal's AI check is honest about its limits: the client calls the cloud models (rules require AI to run
through Firebase AI Logic), so the hackathon trust model is "tamper-evident data + three independent AI reads
+ deterministic gates". Post-hackathon: move judge calls server-side.

## Raw vault: never lose a Moment (all platforms)

The Firestore cache is not a backup: if the server loses a document, the cache records the deletion. So every client
keeps its **own raw copy** of each Moment and deletes it **only after the server provably holds all of it**:

1. **Journal first.** Before each Firestore write, write the same data to app-private storage, atomically (temp file +
   fsync + rename): the moment fields (as created, then as submitted) and every chunk exactly as stored
   (`seq, t0, t1, prevHash, payload, hash, frame`). A failed journal write is an error, never skipped.
2. **Verify from the server, not the cache** (Android `Source.SERVER`, iOS `.server`, web `getDocFromServer`/
   `getDocsFromServer`), only for Moments with `status == submitted`, owned by the signed-in user.
3. **Repair.** Moment missing on the server → re-create it from the journal as `recording` (rules allow), upload every
   chunk, then the submit fields. Chunks missing → upload them (rules allow `seq < chunkCount` after submit).
   Chunks are append-only: a server chunk that *differs* is a conflict; keep the local copy and surface it.
4. **Delete only on a full match:** server status in `submitted|sealed|rejected`, same `chunkCount` and `headHash`, and
   for every seq the same `hash`, `payload` and `frame.jpegB64`. Offline, any error or any mismatch → keep.
5. Re-check on start, on sign-in, and every ~30 s while the app runs. Show the state on the Me screen
   ("kept on this phone until the server confirms every chunk" / "all safely stored on the server").

Android: `android/.../data/Vault.kt` (pure comparison `VaultCheck`, unit-tested; verified on a real phone). Web: `web/src/vault.ts` (IndexedDB journal; pure `compareVault` in `web/src/vaultCheck.ts`, unit-tested; emulator browser test `npm run vault:emu`). iOS: `ios/Verified/Sync/Vault.swift` (pure `VaultCheck` in VerifiedCore, `swift test`; app target not yet compiled: needs Xcode).

### Deleting a Moment (owner only, from "my Moments")

Only the owner can delete, and only from their own Moments list or that Moment's detail when opened from it — never from
the public feed. Any status. Not the Moment currently being recorded on this device. Always behind a confirm dialog
("Delete this Moment? Its recording, proof shots and feed entry are removed for good.").

1. **Client:** delete the local raw-vault journal for that id **first** (so this device can't re-upload it), then
   `delete moments/{id}`. Offline is fine: the delete queues like any write.
2. **Server (`onMomentDeleted`):** writes `deleted/{id} = { ownerUid, deletedAt }`, recursively deletes
   `moments/{id}/chunks`, deletes `feed/{id}`. Clients can't do these (chunks are append-only, the feed is server-written).
3. **Every raw vault:** before re-creating a Moment the server lacks, read `deleted/{id}` from the server. If it exists,
   the owner deleted it on another device: drop the local journal and do **not** re-create.

Product direction (not built): **pay to store a Moment forever.** The verified raw archive (full time series, frames,
hash chain) is the paid asset: free Moments keep the sealed summary and feed entry, raw data expires after a retention
window; paid Moments keep the raw archive permanently plus an exportable, independently re-verifiable proof bundle.

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
- `scorer` (cloud): same inputs, told to assume an adversarial setting (prior 0.2 that a claim is genuine) and
  update only on hard-to-fake evidence → `VerificationScore`.

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
