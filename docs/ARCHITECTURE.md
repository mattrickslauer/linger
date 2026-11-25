# Verified — Architecture (canonical)

> Firebase #BuildHybridAI 2026. Deadline Mon 30 Nov 2026 14:00 PT. Rules: `docs/rules/` (authority).
> This file is the **contract** every platform builds against. Change it here first, then in code.

## The product in one loop

1. **Open the app as a guest** (web, iOS, Android: no sign-in wall). **Sign in** (accounts.mattrickslauer.com OIDC +
   PKCE → Firebase custom token, same uid on every platform; the Auth emulator fakes Google instead) only
   when something must be written to the server; guest Moments are kept on the device and claimed at sign-in (v3.1).
2. **Declare an intention** by a short voice interview (v3.2) or by typing one sentence ("Catch and release a
   largemouth bass at Lake Mission Viejo") plus a category. A Cloud Function sets the bar it must reach (v3.3).
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
**v3** (`version: 3`) adds `checks.bar`, `ladderEligible`, `updatedAt` and moves the score gate from `ai` to `bar`;
see "v3.5 Seal v3". New Moment fields `bar`, `verification` (server-only), `witness`, `recordedAsGuest`, `claimedAt`
and the structured `intention` are specified in the v3 section.

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
- v3: `seal`, `bar`, `verification` are server-only on `moments/*`; `intention` is frozen after recording;
  `credits/*` is readable by its owner and written only by Functions (see v3.9).

## Prompts (shared — `shared/prompts.json` is authoritative)

- `liveCheck` (on-device, per frame): intention + (image | Vision labels text) → `{ ok, reason, label }`.
- `judge` (cloud): intention, summary, frames → `AiOpinion`.
- `skeptic` (cloud): same inputs, told to look for staging, screen photos, reused/stock images, mismatched
  place/time → `AiOpinion`.
- `scorer` (cloud): same inputs, told to assume an adversarial setting (prior 0.2 that a claim is genuine) and
  update only on hard-to-fake evidence → `VerificationScore`.
- v3: `interviewTurn`, `structureIntention`, `barPreview`, `bar`, `witnessDraft`, `witnessRefine`, and one
  `module*` prompt per ladder module. Every prompt has `mode`, `runsIn` (`client`|`functions`), `system`, `user`,
  `schema` (see v3.10).

## UI (all platforms share the words)

Tabs: **Feed** · **Record** · **Me** (guest by default; web `/` is the Feed with the pitch and a **Record a Moment** CTA). Record: intention field + category chips → big **Start Moment** →
live screen (timer, distance, GPS dot, motion sparkline, **Proof shot** button, on-device coach banner
"On-device: keep going" / "Retake: fish not visible", sync badge "Offline · 12 chunks queued") → **Finish**.
Moment card: hero frame, intention, owner, duration · distance · frames, badge **Verified ✓** / **Not verified**,
platform + "checked on-device" chip. Detail: map track, frame timeline, motion chart, judge/skeptic reasons,
seal checklist.

## v3 — guest mode, voice interview, AI bar, witness, verification ladder (contract)

> Status: **binding** for the hackathon build (owner decisions 2026-11-25). Design rationale:
> `docs/superpowers/specs/2026-11-25-witness-and-verification-ladder-design.md`. Everything below is additive:
> v2 Moments, prompts and vectors stay valid. Shared files: `shared/prompts.json` (prompts + JSON schemas),
> `shared/ladder.json` (module catalog), `shared/test-vectors-v3.json` (guest chain, bar and ladder math vectors,
> regenerated by `node shared/make-test-vectors.mjs`).

### v3.1 Guest mode and claim-on-upload

**No sign-in wall anywhere.** Web `/`, the iOS app and the Android app all open straight into the app as a guest.
Sign-in (Google, as today) is requested only when an action writes to the server, by a sheet
"Sign in to <action>" that resumes the action after sign-in.

| Action | Guest | Signed in |
|---|---|---|
| Browse the public feed, open a Moment (detail, map, frames, chain, bar, ladder results) | ✓ | ✓ |
| Voice interview → structured intention (on-device turns; cloud structuring when online) | ✓ | ✓ |
| Record a Moment (GPS, motion, frames, video, on-device coach, witness agent) — kept **local** | ✓ | ✓ (synced) |
| See and delete own local guest Moments (vault list on Me) | ✓ | ✓ |
| Upload / sync a Moment, run the cloud review (judge + skeptic + scorer writes to the Moment) | sign in | ✓ |
| See credits, run a ladder module (spends credits) | sign in | ✓ |
| Delete a Moment from the server | sign in | ✓ (owner) |

Firebase AI Logic itself does not need a signed-in user, so hybrid calls (coach, interview, witness, bar preview)
work for guests. Anonymous Auth is **not** used: a guest has no uid and makes **no Firestore writes at all**
(rules would reject them; do not even queue them).

**Guest Moment (local only).** Recorded exactly like a signed-in Moment into the raw-vault journal (same UUID
momentId, same chunks, same chain), with journal-only markers: `ownerUid: null`, `owner: null`, `guest: true`.
Local status goes `recording` → `submitted` (UI: "On this device · sign in to verify"). No Firestore writes.

**Why the chain survives a claim.** The chain binds the momentId (`GENESIS:<momentId>`), never an owner: no uid,
device id or account appears in `prevHash`, `hash` or `payload` (`shared/test-vectors-v3.json` `guestChain` proves
it; its test asserts no `uid`/`owner` in any payload). The owner is bound **at upload time** by the Firestore rules
(`ownerUid == request.auth.uid` on create; owner immutable afterwards). So a guest Moment needs no rewriting.

**Claim flow** (on sign-in, and on each app start while signed in, at most once per session, while unclaimed
guest Moments with local status `submitted` exist):
1. Sheet: "You recorded N Moments as a guest. Upload them to your account to get them verified?"
   **[Upload all]** · **[Not now]** (each row also has *Keep on this device* / *Delete*).
2. For each accepted Moment, update the **journal** first: `ownerUid = uid`, `owner = {name, photoURL}`,
   `recordedAsGuest = true`, `claimedAt = <epoch ms now>`, `guest = false`. Then run the normal raw-vault verify
   for it (it is missing on the server, so the vault re-creates it as `recording` with those fields, uploads every
   chunk, then sends the submit fields) and then the normal cloud review (judge + skeptic + scorer).
3. "Not now" leaves them guest-local. A guest Moment still recording at sign-in is offered when it finishes.
   A Moment once owned by a uid is never re-assigned. Signing out never touches local guest Moments.

New client-written Moment fields: `recordedAsGuest: boolean` (create; default false/absent),
`claimedAt: number|null` (create; epoch ms of the claim). `startedAt` may be far in the past; nothing checks it
against server time.

**Web landing.** The root URL **is** the app in guest mode: the public feed front and centre, one-line pitch
("Proof that it really happened. Recorded, chained and checked by AI."), a big **Record a Moment** CTA, and a quiet
"Sign in" in the header. No marketing page, no login wall. iOS/Android open on the same Feed tab.

### v3.2 Voice interview → structured intention

Voice in: Web Speech API (`webkitSpeechRecognition`), Android `SpeechRecognizer`, iOS `SFSpeechRecognizer`
(on-device recognition when the platform supports it). Voice out: `speechSynthesis`, Android `TextToSpeech`,
`AVSpeechSynthesizer`, one sentence at a time. **A text field is always visible** as the fallback, and a
"Skip — just type it" path keeps the v1 form (`{text, category}` is still a valid intention).

Loop (all through Firebase AI Logic hybrid):
1. Build `context` JSON: `{ "lat", "lng", "place": "<reverse-geocoded name or null>", "localTime": "2026-11-25T06:42 Wed",
   "month": 11, "hemisphere": "N"|"S", "platform" }` (reverse geocode with CLGeocoder / Android Geocoder; web: null).
2. Turn: prompt `interviewTurn` (**PREFER_ON_DEVICE**) with `{{context}}`, `{{draft}}` (JSON, `{}` at first) and
   `{{transcript}}` (`me: …` / `ai: …` lines) → `{ say, done, draft, missing }`. Speak `say`, show it as a bubble,
   listen. Max 3 questions; done when the model says so or the person says "start"/"go".
3. Final: prompt `structureIntention` (**ONLY_IN_CLOUD**) with the transcript + last draft → the structured fields.
   Offline / cloud failure: use the last on-device `draft` and set `interview.mode = "on_device"`.
4. Preview the bar: prompt `barPreview` (**PREFER_ON_DEVICE**) → `difficulty` → `bar = round2(0.5 + 0.45 * clamp01(difficulty))`.
   Show as "Bar ≈ 0.73 (preview)". The binding bar is server-side (v3.3).
5. Show the card (goal, quantities, place, assumptions, editable) and **Start Moment**.

`moments/{id}.intention` (v3; all new keys optional so v1 `{text, category}` stays valid):
```
intention: {
  text: string (≤200), category: "fishing"|"fitness"|"outdoors"|"making"|"other",     // v1, unchanged
  v: 3,                                    // present ⇔ structured
  activity: string (≤40),                  // "fishing"
  goal: string (≤120),                     // "catch a largemouth bass"
  quantities: [{ metric: string, value: number, unit: string,
                 measuredBy: "scale"|"ruler"|"photo"|"count"|"gps"|"motion"|"claim" }]   // ≤5
  place: { name: string|null, lat: number|null, lng: number|null, region: string|null, country: string|null } | null,
                                           // lat/lng from GPS (never from the model); "" from the model → null
  window: { start: number (epoch ms), expectedMinutes: number|null },
  conditions: string[] (≤6),               // "autumn", "dawn", "ice"
  assumptions: string[] (≤6),              // what the AI assumed, shown and editable
  interview: { turns: number, mode: "on_device"|"cloud"|"mixed"|"typed" },
  preview: { bar: number, difficulty: number, mode: "on_device"|"cloud" } | null   // client preview, ignored by the server
}
```
The transcript itself is **not** stored on the server (it stays in the local journal). The intention is editable
while `status == "recording"` and may ride the submit update; after that it is **frozen** by the rules (the bar is
computed from it).

### v3.3 The AI-set bar (server-side)

`moments/{id}.bar` — written **only** by Cloud Functions (`onMomentWritten`), once, when `status == "submitted"` and
`bar == null`, before sealing:
```
bar: { value: number (0.5..0.95), difficulty: number (0..1), rationale: string (≤160), factors: string[] (≤4),
       source: "ai"|"default", model: string|null, ranAt: number }
```
The function runs prompt `bar` (**ONLY_IN_CLOUD**, Gemini via the server) on the intention (v1 intentions too: text +
category) and the context (place from `summary.start`, local time from `startedAt`). **Code maps** the model's
`difficulty` to `value = round2(0.5 + 0.45 * clamp01(difficulty))` (`round2(x) = Math.round(x*100)/100`; vectors in
`shared/test-vectors-v3.json` `bars`). On any model failure: `{ value: 0.5, difficulty: 0, source: "default",
rationale: "Standard bar", factors: [], model: null }`, so v2-era Moments behave exactly as seal v2.

### v3.4 Witness agent (client, during recording)

Runs only while a Moment is recording, entirely on the client. Pacing: first request ≥ 30 s after start; one open
request at a time; ≥ 60 s between requests; ≤ 6 per Moment; show only when `ask != ""` and `gain ≥ 0.1`.
1. Draft with `witnessDraft` (**PREFER_ON_DEVICE**): `{{intention}}` (JSON), `{{session}}` (elapsed s, distance m,
   frame labels so far, GPS/motion presence), `{{asked}}` (previous asks + outcomes) → `{ ask, kind, why, gain }`.
2. Online: optionally refine with `witnessRefine` (**ONLY_IN_CLOUD**, + up to 3 latest frames, `{{draft}}`),
   4 s timeout, else keep the draft. `by` records which produced the final ask.
3. Deliver: speak the ask (platform TTS) + toast in the record screen with **Show** / **Answer** / **Skip**.
   App in background / screen locked: **local notification** (iOS `UNUserNotificationCenter`, Android
   `NotificationManager` channel "witness"; web: `Notification` if granted, else toast only). No FCM. The request
   stays open until answered, skipped or the Moment stops.
4. Answer: `kind == "show"` opens the camera with the ask as an overlay; the shot is a normal proof frame (closes
   the chunk, coached by `liveCheck` with `{{intention}}` = `"<intention text> — witness asked: <ask>"`).
   `tell`: speech-to-text (or typed) answer, ≤200 chars. `do`: the person taps Done; sensors carry the evidence.

**Chain events** (inside `payload.events`, so hashed; the chain format and hashing are unchanged):
```
{"t":…, "type":"witness",        "wid":"w1", "ask":"Hold the fish next to the ruler", "kind":"show"|"tell"|"do", "by":"on_device"|"cloud"}
{"t":…, "type":"frame",          "wid":"w1"}                       // existing frame event, tagged with the request it answers
{"t":…, "type":"witness_answer", "wid":"w1", "via":"frame"|"voice"|"text"|"done", "text"?: "…"}   // same chunk as the frame for via=frame
{"t":…, "type":"witness_skip",   "wid":"w1", "reason"?: "stopped"}  // open requests are skipped with reason "stopped" at Finish
```
`wid` = `"w" + n` (1-based per Moment). Key order inside each event object as written above (payload is hashed as
the stored string, so order only matters for byte-identical regeneration of vectors). At submit the client also writes
`witness: { asked: number, answered: number, skipped: number, mode: "on_device"|"cloud"|"mixed"|"none" }` on the
Moment (informational; add `witness` to the raw vault's SUBMIT_FIELDS). The server recounts from the chain.

### v3.5 Seal v3 (Cloud Function)

`isReadyToSeal` v3: `status == "submitted" && judge && skeptic && bar != null && !seal`.
Checks: `chain`, `timing`, `physics`, `frames` unchanged; `ai` = judge `consistent` with confidence ≥ 0.6 **and**
skeptic ≠ `inconsistent` (the score moved out of `ai`); **new `bar`** = `verification.score ≥ bar.value` (true when
the Moment has no `score`: pre-scorer builds). `sealed` = all six. `status = sealed|rejected` as before.
```
Seal = { sealed: boolean, at: serverTimestamp, updatedAt: serverTimestamp,
         checks: { chain, timing, physics, frames, ai, bar: boolean },
         reason: string, version: 3,
         ladderEligible: boolean }   // chain && timing && physics && frames && ai && score present
```
In the **same transaction** it writes:
```
moments/{id}.verification = {         // server-only (rules)
  version: 3,
  baseline: number|null,              // clamp01(score.probability) from the client's scorer; null if absent
  score: number|null,                 // baseline after every ladder result, in run order (v3.6 math)
  bar: number,                        // == bar.value
  verified: boolean,                  // score != null ? score >= bar : seal.sealed
  modules: LadderResult[],            // [] at seal time
  updatedAtServer: serverTimestamp
}
LadderResult = { runId: string, module: ModuleId, title: string, cost: number, strength: number,
                 passed: boolean, confidence: number, before: number, after: number,
                 reasons: string[] (≤4), measured?: [{metric, value, unit}], model: string, ranAt: number }
```
A ladder run re-evaluates **only** `checks.bar` (from the new score), `sealed`, `reason`, `updatedAt` and `status`:
a pass can lift a `rejected` (below-bar) Moment to `sealed`; a fail can drop a `sealed` one to `rejected`. Both are
public. Integrity checks are never re-run and `seal.at` never changes.

### v3.6 Verification ladder + credits

Catalog: `shared/ladder.json` (`id, title, blurb, cost, strength, available, needs[], prompt`). Hackathon modules:

| id | title | cost | s | needs | what the function does |
|---|---|---|---|---|---|
| `second_look` | Second opinion | 1 | 0.20 | frames | `moduleSecondLook` over every frame (≤ 8) + earlier reasons |
| `place_time` | Place & time check | 1 | 0.20 | frames, gps | code computes sun elevation per frame from GPS + clock; `modulePlaceTime` |
| `witness_review` | Witness review | 2 | 0.30 | witness_answered | pairs witness events with answer frames; `moduleWitnessReview` |
| `count_measure` | Count & measure | 2 | 0.30 | quantities | code: GPS distance, motion reps; `moduleCountMeasure` (+ `measured`) |
| `full_video` | Watch the full video | 3 | 0.45 | video | re-hash the uploaded clip vs the chained `video.sha256`; `moduleFullVideo` |
| `human_review` | Human reviewer | 10 | 0.60 | — | `available: false` (shown as "coming soon", not runnable) |

Math (code, never the model): pass `p' = p + s(1 − p)`, fail `p' = p(1 − s)`, applied in run order to `baseline`, no
intermediate rounding (vectors: `shared/test-vectors-v3.json` `ladders`). The model returns `{passed, confidence,
reasons}`; code counts a **pass only if `passed && confidence ≥ 0.6`** (`ladder.json passConfidence`), else a fail.
Each module runs at most once per Moment. Credits are spent whether it passes or fails. **Only the owner** can run
modules; the bar, final score and every result are public on sealed/rejected posts.

Client offer list (owner, when `seal.ladderEligible`): for each available module not yet in
`verification.modules`, show cost and both previews computed locally from `verification.score`:
"if it passes → 0.79 · if it fails → 0.50". Header: "score 0.62 · bar 0.80". Footer: "Modules that fail lower the
score. Credits are spent either way." Disable a module whose `needs` are not met, with the reason.

**Video clip upload** (only for `full_video`): Cloud Storage path `clips/{uid}/{momentId}/{sha256}.{mp4|mov|webm}`
where `sha256` is the `video` event's hash (lowercase hex); content type `video/*`; ≤ 200 MB (`storage.rules`). Upload
first, then call `runLadderModule` with `clipSha`. The function re-hashes the bytes; a mismatch fails the call with
no charge.

**Credits** — free demo credits only (no Stripe, no purchase). Written **only** by Cloud Functions:
```
credits/{uid} = { balance: number, granted: number, spent: number, createdAtServer, updatedAtServer }
credits/{uid}/ledger/{entryId} = {
  delta: number,                       // +10 grant, −cost spend, +cost refund
  kind: "grant"|"spend"|"refund",
  reason: string,                      // "Free demo credits", "Second opinion", "Refund: model failed"
  momentId: string|null, module: ModuleId|null, runId: string|null,
  balanceAfter: number, atServer: serverTimestamp
}
```
`entryId`: `grant` for the first grant, the `requestId` for a spend, `<requestId>-refund` for its refund.
10 credits (`ladder.json freeCredits`) are granted once, by `getCredits` or on the first `runLadderModule`.

### v3.7 Callable Cloud Functions (v2 `onCall`, region `us-central1`)

Clients call them with the Firebase Functions SDK (`httpsCallable(getFunctions(), name)` / `Firebase.functions`
/ `Functions.functions()`). All require a signed-in user; guests get the sign-in sheet before calling. Errors are
`HttpsError(code, message, { reason })`; clients switch on `details.reason`.

**`getCredits`**
```
request:  {}
response: { balance: number, granted: number, spent: number, justGranted: boolean }
```
Grants the free credits on first call (transaction; idempotent). Errors: `unauthenticated`.

**`runLadderModule`**
```
request:  { momentId: string, module: ModuleId, requestId: string /* client UUID (any case), idempotency key; anything else is bad_request */,
            clipSha?: string /* full_video: which chained video; default: the last `video` event */ }
response: { runId: string /* == requestId */, module: ModuleId, passed: boolean, confidence: number,
            before: number, after: number, score: number, bar: number, verified: boolean,
            status: "sealed"|"rejected", cost: number, balance: number, reasons: string[],
            measured?: [{ metric: string, value: number, unit: string }] }
```
Order: auth → validate → load Moment (owner only) → eligibility + `needs` (incl. clip hash) → transaction: grant if
first use, check balance, write the spend ledger entry, decrement → run the module (server Gemini) → transaction:
append the `LadderResult` to `verification.modules`, recompute `verification.score`/`verified`, update `seal`
(`checks.bar`, `sealed`, `reason`, `updatedAt`), `status`, and `feed/{id}`. Model/infra failure after the spend →
refund ledger entry, nothing recorded, error `unavailable`/`model_failed`. Same `requestId` again → returns the stored
result, no second charge.

| code | `details.reason` |
|---|---|
| `unauthenticated` | `sign_in` |
| `invalid-argument` | `bad_request`, `bad_module` |
| `not-found` | `moment_missing` |
| `permission-denied` | `not_owner` |
| `failed-precondition` | `not_sealed_yet` (status not sealed/rejected or seal.version < 3), `not_eligible` (`!seal.ladderEligible`), `already_run`, `unavailable_module`, `needs_frames`, `needs_gps`, `needs_witness_answered`, `needs_quantities`, `needs_video`, `clip_missing`, `clip_hash_mismatch` |
| `resource-exhausted` | `insufficient_credits` (details also `{ balance, cost }`) |
| `unavailable` | `model_failed` (credits refunded; the same `requestId` keeps answering `model_failed`, retry with a new one) |
| `aborted` | `in_progress` (the same `requestId` is still running) |

`clip_missing` also carries `details.bucket`, `details.path` (where to upload; swap `.mp4` for the clip's real extension)
and `details.extensions` (`["mp4","mov","webm"]`). On `clip_hash_mismatch` the function deletes the bad upload (clips are
create-only for clients), so the owner can upload the right bytes and retry. While a run is in flight the function
keeps a server-only marker `verification.pending.<module> = requestId` on the Moment (cleared on record or refund), so
two concurrent requests for the same module cannot both spend. A run whose spend is older than 10 minutes with neither
a result nor a refund (the instance died) is settled by the next request: refund entry `<requestId>-refund` (reason
"Refund: run did not finish"), marker cleared; its own `requestId` then answers `model_failed`. If the Moment is
deleted while a module runs, the spend is refunded and the call fails `not-found`/`moment_missing`. Deleting a Moment
also deletes its clips under `clips/{uid}/{momentId}/`.

**Server-side model (`bar`, `module*`).** Cloud Functions call Gemini on Vertex AI in the same Firebase project with
the function's service account (`@google/genai`, `vertexai: true`; env `CLOUD_MODEL`, default `gemini-3.5-flash`;
`VERIFIED_AI_LOCATION`, default `global`), with the system/user/schema from `shared/prompts.json` (copied into
`functions/lib/shared/` by `npm run build`). No key on any device. In the emulator the default engine is a
deterministic fake (`VERIFIED_AI=fake`; set `VERIFIED_AI=vertex` to use the real model); any prompt variable containing
`#ai-fail` makes the fake throw, which the e2e uses to test refunds. The bar agent runs only while `bar == null`, under
a 150 s lease in the server-only collection `barLeases/{momentId}` (no client access), so the burst of writes around
submit calls the model once; the first bar write wins.

No other callables: the bar is computed by the trigger, guest claims use ordinary rule-checked writes.

### v3.8 Feed v3 (`feed/{momentId}`, still Function-only)

Adds to the v2 fields: `bar: number|null`, `barRationale: string|null`, `difficulty: number|null`,
`baselineScore: number|null`, `ladder: [{ module, title, passed, before, after, reasons: string[] (≤2) }]`,
`witness: { asked, answered, skipped }` (counted from the chain), `recordedAsGuest: boolean`, `sealVersion: 3`.
`verificationScore` now carries the **final** score (`verification.score`); `intention` carries the full structured
intention. Card badge: **Verified ✓** when `status == "sealed"`; show "score 0.83 · bar 0.80" and a ladder chip
("+2 checks") when present.

### v3.9 Firestore paths and rules (v3 delta)

| Path | Read | Write |
|---|---|---|
| `feed/{id}` | anyone (guests too) | Functions only |
| `moments/{id}` | owner; anyone when sealed/rejected | owner create/update as v2; **`seal`, `bar`, `verification` server-only** (create only as null/absent, never changed by a client); **`intention` frozen once status ≠ recording** |
| `moments/{id}/chunks/{seq}` | as parent | as v2 (append-only) |
| `credits/{uid}`, `credits/{uid}/ledger/{entryId}` | that user only | Functions only |
| `deleted/{id}`, `users/{uid}` | as v2 | as v2 |
| Storage `clips/{uid}/{momentId}/{file}` | nobody (Functions read via Admin) | that user, create only, `video/*`, < 200 MB |

Guests have no `request.auth`, so every write path is closed to them by construction. Rules tests:
`functions/test/rules.test.ts` (`npm run test:rules`); contract vectors: `functions/test/contract.test.ts`
(`npm run test:unit`).

### v3.10 Hybrid inference map (must stay visible in the UI: "on-device" / "cloud" chips)

| Prompt | Mode | Runs in | Can it verify? |
|---|---|---|---|
| `liveCheck` | PREFER_ON_DEVICE | client | no (coach) |
| `interviewTurn` | PREFER_ON_DEVICE | client | no |
| `structureIntention` | ONLY_IN_CLOUD | client (AI Logic) | no |
| `barPreview` | PREFER_ON_DEVICE | client | no (preview only) |
| `witnessDraft` / `witnessRefine` | PREFER_ON_DEVICE / ONLY_IN_CLOUD | client | no |
| `judge`, `skeptic`, `scorer` | ONLY_IN_CLOUD | client (AI Logic), results gated by the seal | proposes |
| `bar`, `module*` | ONLY_IN_CLOUD | Cloud Functions | proposes; code decides |

## Repo layout

```
docs/ARCHITECTURE.md  this file
shared/               prompts.json, ladder.json, test-vectors.json, test-vectors-v3.json, sample-moments/ (seed data)
functions/            Cloud Function (TS) + emulator tests
firestore.rules, storage.rules, firestore.indexes.json, firebase.json
web/                  React app (feed public, recorder)
ios/                  Xcode project (XcodeGen project.yml) — Verified.app
android/              Gradle project — app module
config/               git-ignored Firebase config files
```
