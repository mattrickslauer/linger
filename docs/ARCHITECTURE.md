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
(version 2 = the `ai` check also gates on the verification score.) **v4** (`version: 4`): per-claim scores, `checks.cheating`;
see "v4.6".
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
- v4: `claims`, `plan`, `videoReview` are server-only too; `intention.claims`/`intention.plan` follow the intention
  (writable only while recording); Storage clips gain owner `get` (see v4.9).

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
- v4: `barAndClaims` and `videoReview` (functions), claims/plan in `interviewTurn`/`structureIntention`, plan +
  unmet requirements in `witnessDraft`/`witnessRefine`, per-claim verdicts in `judge` and every `module*` (see v4.10).

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

**Credits** — free demo credits to start, then packs bought through pay.mattrickslauer.com (`buyCredits` →
hosted checkout → `confirmCreditPurchase` / signed `payWebhook`, see functions/src/purchases.ts). Web redirects to
the checkout; iOS (SFSafariViewController) and Android (Custom Tab) open it in-app with
`returnUrl = https://<project>.web.app/me?from=app` and settle the purchase themselves when the browser closes.
Written **only** by Cloud Functions:
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
| Storage `clips/{uid}/{momentId}/{file}` | nobody (Functions read via Admin); **v4.12: owner, or anyone when the Moment is sealed/rejected** | that user, create only, `video/*`, < 200 MB |

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

## v4 — claims, evidence plan, video in the free baseline, per-claim scores (contract)

> Status: **binding** (owner-approved 2026-11-25). Design: `docs/superpowers/specs/2026-11-25-claims-evidence-plan-video-baseline-design.md`.
> Why: "clap 50 times" with a recorded clip scored 0.40 because every model only saw one still frame; the video only
> counted after paying for `full_video`; `count_measure` stayed locked because a typed intention has no `quantities`.
> v4 rule in one line: **the interview sets up the minimum evidence per claim; if that evidence arrives and no cheating
> is detected, the Moment is Verified, for free.** Everything below is additive: v3 Moments (seal `version` ≤ 3) keep
> v3 behaviour forever (ladder runs on them use the v3 math, no claims). Shared files: `shared/prompts.json`
> (`version: 4`), `shared/ladder.json` (`version: 4`, `backs`), `shared/test-vectors-v4.json` (regenerate with
> `node shared/make-test-vectors-v4.mjs`; that script is the **reference implementation** of v4.5), types and constants
> in `functions/src/v4.ts`.

### v4.1 Claims

An intention is split into **≤ 5 claims**, each checkable on its own.
```
Claim = { id: "c1".."c5" (in order), kind: "action"|"count"|"measure"|"place"|"time"|"object"|"outcome",
          text: string (≤80),                                  // "clapping", "50 claps", "largemouth bass", "at least 6 lb"
          metric?: string, value?: number, unit?: string }     // count/measure only
```
"clap 50 times" → `c1 action "clapping"`, `c2 count "50 claps" {metric:"claps", value:50, unit:"claps"}`.
Models return `metric: ""`, `value: 0`, `unit: ""` for other kinds (on-device schemas need every field); **normalize**
(client and server alike): trim, cut `text` to 80, drop entries with an unknown kind or empty text, keep the first 5,
renumber ids `c1..cN` in order (and remap the plan's `claimId`s), keep `metric/value/unit` only when `kind` is
`count`/`measure` and `value > 0`, otherwise omit the three keys.

- **Client draft**: `intention.claims` (from `interviewTurn`'s `draft.claims`, then `structureIntention`). Typed
  intentions may run `structureIntention` on the typed sentence (cloud, optional) to get claims + plan before Start.
- **Server, authoritative**: `moments/{id}.claims` (server-only), from `barAndClaims` (v4.3). Every v4-sealed Moment
  has ≥ 1 server claim, typed ones included.

### v4.2 Evidence plan

For each claim, the **minimum evidence** that would convince a fair skeptic.
```
Requirement = { id: "r1".."r6", claimId: "c1".., evidence: "video"|"frames"|"gps"|"motion"|"witness",
                ask: string (≤120),            // "One continuous video of all 50 claps, both hands in frame"
                minSeconds?: number }          // video/motion only; omitted when 0
Plan = { requirements: Requirement[] (≤6), recordMode: "video"|"photo", note: string (≤160) }
```
Normalize: drop requirements whose `claimId` is unknown or `evidence` invalid, keep the first 6, renumber `r1..rN`,
omit `minSeconds` when ≤ 0 or not video/motion, `recordMode = "video"` iff any requirement is `video`. **Server only:**
every claim without a requirement gets one appended (while < 6; else the claim keeps none and can never earn the bar):
`count`/`action` → `{evidence:"video", ask:"A continuous video showing <text>"}`, `place`/`time` → `{evidence:"gps",
ask:"Keep location on during the session"}`, else `{evidence:"frames", ask:"A clear proof shot of <text>"}`.

- **Client**: `intention.plan` (same shape), shown at the end of the interview and driving the record screen.
- **Server, authoritative**: `moments/{id}.plan` (server-only), from `barAndClaims`; the model is told to keep the
  client's requirements and only add or tighten. The seal checks the **server** plan.

`moments/{id}.intention` v4 (additive to v3.2; all v3 keys unchanged):
```
intention: { …v3 fields…, v: 4, claims?: Claim[] (≤5), plan?: Plan|null }
```
Writable only while `status == "recording"` (and on the recording → submitted update), frozen afterwards (rules).

**Client checklist ("captured", never "verified").** While recording, the record screen ticks a requirement off when
its evidence exists locally: `video` — a finished clip (`video` event) of ≥ `minSeconds` (any length if absent);
`frames` — ≥ 1 proof frame; `gps` — ≥ 1 fix with accuracy ≤ 100 m; `motion` — non-zero motion samples spanning ≥
`minSeconds` (default 10 s); `witness` — an answered witness request tagged with that requirement's `rid`. The server
decides "met" (v4.5); the client's tick only means "captured".

### v4.3 Bar + claims + plan at submit (`barAndClaims`)

Replaces the v3 `bar` agent for every bar written by v4 functions (the `bar` prompt stays in `prompts.json` for
compatibility; nothing new calls it). Trigger, lease (`barLeases/{momentId}`, 150 s) and timing are as v3.3:
runs while `status == "submitted"` and (`bar == null` **or** `claims == null`). Inputs: `{{intention}}` (the intention
without `claims`/`plan`), `{{draft}}` = `{"claims": intention.claims ?? [], "plan": intention.plan ?? null}`,
`{{context}}` as v3.3. One update writes:
```
bar:    as v3.3 (value = round2(0.5 + 0.45 * clamp01(difficulty)); kept if already set — first bar wins)
claims: { items: Claim[] (1..5), source: "ai"|"client"|"default", model: string|null, ranAt: number }
plan:   Plan & { source: "ai"|"client"|"default" }
```
On model failure: bar = v3 default; claims = normalized `intention.claims` if non-empty (`source: "client"`), else
`[{id:"c1", kind:"outcome", text: (intention.goal || intention.text) cut to 80}]` (`source: "default"`); plan = the
normalized `intention.plan` if it covers them, else the server default requirements above. A Moment whose `bar` was set
by v3 functions but has no `claims` runs `barAndClaims` once and keeps its bar.

### v4.4 Video in the free baseline

**Clip upload at submit (client, all platforms).** Every chained `video` clip is uploaded **before** the client writes
`status = "submitted"`, to `clips/{uid}/{momentId}/{sha256}.{mp4|mov|webm}` (unchanged path and limits, < 200 MB,
`video/*`). Order at Finish: write the last chunks → upload every clip (sequentially, resumable upload) → submit update.
Idempotent retry: `getMetadata` on the path first (owner may `get`; v4.9); exists → skip. Offline or upload failing:
submit **waits** (the Moment stays `recording` locally, journal keeps everything, retried by the raw vault loop; the UI
says "Uploading video · 34 MB"). A clip > 200 MB is not uploaded (its requirements stay unmet) and submit proceeds.
Guests: the same upload runs during the claim (after the chunks, before the submit fields). The raw vault's re-create
path does the same. v3 clients that never upload are handled by the 24 h expiry below.

**Video review (server, free, `videoReview` prompt, ONLY_IN_CLOUD, Gemini on Vertex with `fileData` `gs://` URIs,
like `moduleFullVideo`).** Runs as part of sealing, after all chunks arrived (`chunkCount` reached), when the chain has
≥ 1 `video` event. Server-only state on the Moment:
```
videoReview: {
  status: "waiting"|"running"|"done"|"failed"|"expired"|"none",
  clips: [{ sha256, ext: "mp4"|"mov"|"webm"|null, durationMs, startedAt: number|null, uploaded: boolean, hashOk: boolean|null }],
  claims: [{ id, verdict: "backed"|"not_backed"|"unclear", confidence, reasons: string[] (≤3), measured?: {value, unit} }],
  cheating: { detected: boolean, signals: string[] (≤4) },
  summary: string (≤160), attempts: number, reason: string|null,    // reason e.g. "waiting for video upload"
  model: string|null, ranAt: number|null, updatedAtServer
}
```
1. No `video` event in the chain → `{status:"none"}` (written once, with empty lists).
2. Any chained clip not in Storage → `status:"waiting"`, `reason:"waiting for video upload"`. A Storage
   `onObjectFinalized` trigger on `clips/` touches the Moment (`videoReview.updatedAtServer`) to re-run the trigger.
   A scheduled function (every 30 min) marks Moments waiting longer than **24 h** since `submittedAtServer` as
   `status:"expired"` (`reason:"video never arrived"`) and lets them seal without it.
3. All clips present → re-hash each (SHA-256 of the bytes, lowercase hex) against its `video` event: mismatch →
   `hashOk:false` (cheating, v4.5; the bad object is **not** deleted, it is the evidence). Then under the lease
   `videoLeases/{momentId}` (300 s, server-only) call the model once with the ≤ 3 last clips in chain order,
   `{{intention}}`, `{{claims}}` (server claims), `{{plan}}`, `{{summary}}`, `{{sensors}}` (GPS distance, motion reps,
   local time, sun elevation — the code facts of `place_time`/`count_measure`), `{{clips}}`. → `status:"done"`.
4. Model/infra failure → `attempts += 1`, retried on the next trigger; after 2 attempts `status:"failed"` (video
   requirements unmet, **not** cheating).
5. Seal waits while `status` is `waiting` or `running` (Moment stays `submitted`; detail shows "Waiting for video upload").

`isReadyToSeal` v4: `status == "submitted" && judge && skeptic && bar && claims && plan && videoReview.status in
["done","failed","expired","none"] && !seal`.

### v4.5 Per-claim scores, "minimum evidence + no cheating = bar" (deterministic code)

Inputs: `bar.value`, baseline `b = clamp01(score.probability)` or **0.2** when the Moment has no `score`, server claims
and plan, the chain facts, `judge`, `skeptic`, `videoReview`, and (later) ladder results. Constants: `BACKED = 0.6`,
`CAP = 0.1`. **Reference implementation: `shared/make-test-vectors-v4.mjs` (`scoreV4`)**; vectors
`shared/test-vectors-v4.json` `scoring[]` (21 cases); IEEE doubles, no rounding between steps.

A **verdict backs** a claim when `verdict == "backed" && confidence ≥ 0.6`.
- **frames judge backs claim c**: chain has ≥ 1 frame AND (if `judge.claims` is a non-empty list: its entry for `c.id`
  backs; else `judge.verdict == "consistent" && judge.confidence ≥ 0.6`).
- **video review backs claim c**: `videoReview.status == "done"`, ≥ 1 clip `uploaded && hashOk`, and its entry for
  `c.id` backs.

**Requirement met** (`r`, for claim `c = r.claimId`):
| evidence | met when |
|---|---|
| `video` | a clip with `uploaded && hashOk == true && durationMs > 0 && durationMs ≥ (minSeconds ?? 0) × 1000` exists **and** the video review backs c |
| `frames` | the frames judge backs c |
| `gps` | ≥ 1 GPS fix with accuracy ≤ 100 m |
| `motion` | non-zero motion samples spanning ≥ (`minSeconds` or 10) s (last t − first t) |
| `witness` | an answered (`witness_answer`, not skip) request whose `witness` event has `rid == r.id`, or has no `rid` (pre-v4 clients) |

**Cheating detected** iff any signal, collected in this order (≤ 6 kept):
`!chain` → `"chain: hashes do not link"` · `!timing` → `"timing: clock does not add up"` · `!physics` →
`"physics: impossible movement"` · skeptic `inconsistent` → `"skeptic: " + (reasons[0] ?? "fake signal")` · any clip
`uploaded && hashOk == false` → `"video: clip does not match the chain"` · `videoReview.status == "done" &&
cheating.detected` → `"video: " + s` per signal (or `"video: cheating detected"` if none).

**Per claim, in order:**
1. `p = b`.
2. `met`/`unmet` = its requirements split by the table; `minimumMet = requirements.length > 0 && unmet == []`.
3. `minimumMet && !cheating` → `p = max(p, bar)` — **the minimum evidence earns the bar.** `sealP = p`.
4. Ladder modules, in run order (v4.6): for each module, for each claim it backs: verdict backs →
   `p = p + s(1 − p)`, else (not_backed, unclear, low confidence, **missing**) → `p = p(1 − s)`. Modules work on the
   uncapped p.
5. Cheating → reported `p = min(p, 0.1)` (also for each module's before/after).

`backedBy` (in this order): `"video_review"` if the video review backs it, `"frames_judge"` if the frames judge backs
it, `"gps"`/`"motion"`/`"witness"` if it has a met requirement of that evidence, then each module id that counted a
pass for it (run order).

**Moment**: `score = min over claims of p`; `claimsBacked = #claims with p ≥ bar`.
Checks: `chain, timing, physics, frames` as v3; **`ai` = NOT (judge.verdict == "inconsistent" && confidence ≥ 0.6)**;
**`cheating` = no cheating detected**; **`bar` = every claim p ≥ bar**. `sealed` = all seven. `verified = sealed`.
`ladderEligible = chain && timing && physics && frames && cheating` (no score needed: the baseline defaults to 0.2).

### v4.6 Seal v4, verification v4, modules back claims

```
Seal (v4) = { sealed, at, updatedAt, checks: { chain, timing, physics, frames, ai, cheating, bar }, reason,
              version: 4, ladderEligible, cheatingSignals: string[] (≤6) }
verification (v4) = { version: 4, baseline: number|null, baselineUsed: number, score: number, bar: number,
                      verified: boolean, cheating: { detected, signals }, claimsBacked: number,
                      claims: ClaimScore[], modules: LadderResult[], updatedAtServer }
ClaimScore = { id, p, sealP, met: string[], unmet: string[], minimumMet: boolean, backedBy: string[] }
```
`reason` (UI words, first that applies): cheating → `"Cheating detected: " + signals.join("; ")`; an integrity check →
the v3 reason; `!ai` → `"The proof frames contradict the intention"`; `!bar` → `"<k> of <n> claims backed · <text of
the lowest claim> <p> < bar <bar>"` (2 decimals); sealed → `"All <n> claims backed · score <s> ≥ bar <bar>"`.
Which seal: **every seal written by v4 functions is v4** (incl. Moments from old clients: they get server claims);
`seal.version ≤ 3` Moments are never re-sealed and their ladder runs keep v3 math. Seal and verification are written
in one transaction as in v3.5.

**Modules back claim kinds** (`shared/ladder.json` `backs[]`):
| module | backs | note |
|---|---|---|
| `second_look` | action, object, outcome | |
| `place_time` | place, time | |
| `witness_review` | all kinds, `backsTargetedOnly: true` | only claims whose requirements an answered request targeted (`rid`); any answered request without `rid` → all claims |
| `count_measure` | count, measure | need `quantities` = a server claim of kind count/measure (v4) / `intention.quantities` (v3) |
| `full_video` | all kinds | deeper second pass (stricter, frame-by-frame count); clip is already uploaded at submit |
| `human_review` | all kinds | `available: false` |

A module is **offered** (v4 Moments) only if it backs ≥ 1 claim (after `backsTargetedOnly`) and its `needs` are met;
the offer row lists those claims. Each module prompt gets `{{claims}}` (only the claims it backs; `[]` for v3 Moments)
and returns, besides v3's `passed/confidence/reasons(/measured)`, `claims: [{id, verdict, confidence, reasons,
measured?}]`. Code uses the per-claim verdicts for v4 Moments (v4.5 step 4) and the overall `passed` for v3 Moments.
`LadderResult` (v4) adds `claims: ModuleClaimOutcome[]`:
```
ModuleClaimOutcome = { id, verdict: "backed"|"not_backed"|"unclear"|"missing", confidence, passed: boolean,
                       before: number, after: number, reasons: string[] (≤2), measured?: {value, unit} }
```
and its `passed` = every backed claim passed; `confidence` = the model's overall; `before`/`after` = the Moment score.
After a run the function recomputes **all** claims from `sealP` with every module in run order (v4.5 step 4-5), then
`score`, `claimsBacked`, `checks.bar`, `sealed`, `reason`, `updatedAt`, `status`, feed — as v3.5 does.

### v4.7 Callables (changes only)

`getCredits`: unchanged. `runLadderModule` request unchanged; response adds (v4 Moments):
```
claims: ModuleClaimOutcome[], claimScores: ClaimScore[], claimsBacked: number
```
`passed`, `before`, `after`, `score`, `verified`, `status` keep their v3 meaning (overall). New `failed-precondition`
reason: `no_claims_backed` (the module backs none of this Moment's claims). `needs_quantities`
now means "no count/measure claim" on v4 Moments. `full_video` on a v4 Moment uses the clip already uploaded at submit;
`clip_missing` stays for v3 Moments and expired uploads. No new callables (seal, video review and expiry are triggers).

### v4.8 Feed v4 (`feed/{momentId}`, Function-only)

Adds to v3.8: `sealVersion: 4`,
`claims: [{ id, kind, text, p, backed: boolean /* p ≥ bar */, backedBy: string[], met: number, total: number }]`,
`claimsBacked: number`, `claimsTotal: number`, `cheating: boolean`, `cheatingSignals: string[]`,
`video: { reviewed: boolean /* status done */, summary: string|null, status }`,
`plan: { recordMode, requirements: [{ id, claimId, evidence, ask, met: boolean }] }`.
`verificationScore` = `verification.score` (the min). `baselineScore` = `verification.baselineUsed`.
Card: badge unchanged + chip **"2/2 claims backed"**.

### v4.9 Rules delta

| Path | Change |
|---|---|
| `moments/{id}` | **`claims`, `plan`, `videoReview` join `seal`, `bar`, `verification` as server-only** (create only as null/absent; never changed by a client). `intention.claims` (list ≤ 5) and `intention.plan` (map: `requirements` list ≤ 6, `recordMode` in video/photo) are validated when written; like the whole intention, writable only while `status == "recording"` (incl. the submit update). |
| `videoLeases/{id}` | server-only (no client access; default deny, like `barLeases`) |
| Storage `clips/{uid}/{momentId}/{sha}.{ext}` | adds **`get` for the owner** (metadata check before an idempotent re-upload); create now also requires `resource == null` (an upload over an existing object evaluated as create, so clips could be overwritten); no list/update/delete |

Tests: `functions/test/rules.test.ts` (Firestore) and `functions/test/storage.rules.test.ts` (Storage), both in
`npm run test:rules` (emulators `firestore,storage`).

### v4.10 Prompts and hybrid map (v4 changes)

| Prompt | Mode | Runs in | v4 change |
|---|---|---|---|
| `interviewTurn` | PREFER_ON_DEVICE | client | `draft.claims`, `draft.plan` |
| `structureIntention` | ONLY_IN_CLOUD | client | `claims`, `plan` |
| `witnessDraft` / `witnessRefine` | PREFER_ON_DEVICE / ONLY_IN_CLOUD | client | new vars `{{plan}}` (JSON) and `{{unmet}}` (JSON list of unmet requirements `{id, claimId, evidence, ask}`); output `requirementId` ("" if none) |
| `judge` | ONLY_IN_CLOUD | client | new var `{{claims}}` (server claims, JSON); output `claims: [{id, verdict, confidence}]` |
| `skeptic`, `scorer`, `liveCheck`, `barPreview` | as v3 | client | unchanged |
| `barAndClaims` | ONLY_IN_CLOUD | functions | **new** (v4.3): difficulty, rationale, factors, claims, plan |
| `videoReview` | ONLY_IN_CLOUD | functions | **new** (v4.4): claims verdicts, cheating, summary |
| `bar` | ONLY_IN_CLOUD | functions | kept, unused by v4 code |
| `module*` | ONLY_IN_CLOUD | functions | new var `{{claims}}`; output `claims[]` per-claim verdicts |

None of them can verify: the on-device model still only coaches/drafts; cloud models propose verdicts; code decides.

**Client judge timing.** After submit (online, signed in), the client waits for the server `claims` on the Moment
(snapshot listener, ≤ 30 s), then runs judge + skeptic + scorer with `{{claims}}` = `claims.items` as JSON. If no
server claims arrived in time, `{{claims}}` = `[]` (the judge then returns `claims: []` and the seal falls back to its
overall verdict). Write `judge.claims` as returned (inside `judge`, same update as v3).

**Witness chain event (v4).** `witness` events gain an optional last key `rid` (the plan requirement the request
serves, from `requirementId`; omitted when ""): `{"t","type":"witness","wid","ask","kind","by","rid"}`. Vector:
`shared/test-vectors-v4.json` `videoChain`. The witness asks for **unmet requirements first**; pacing as v3.4.

### v4.11 UI words (all platforms, same words)

- **Interview end card**: claims as chips (`clapping` · `50 claps`), then **"To get this verified"** with one row per
  requirement (`ask`, evidence icon, `minSeconds` as "≥ 20 s"), the plan `note`, then "Bar ≈ 0.52 (preview)" and
  **Start Moment**. Record screen opens in `recordMode` ("Video" / "Photo").
- **Record screen**: the checklist under the timer: `○ One continuous video of all 50 claps` → `● captured` when the
  local evidence exists. Witness prompts for unmet items first.
- **Finish / sync**: "Uploading video · 34 MB" → "Video uploaded" → "Reviewing video" (server `running`) → sealed.
  Offline (clip still on the device): "Video waits for a connection". Waiting (server): "Waiting for video upload".
  Expired: "Video never arrived · sealed without it".
- **Detail**: overall verdict on top (**Verified ✓** / **Not verified**, "score 0.52 · bar 0.52", "2/2 claims backed").
  One row per claim: `clapping ✓ backed by video review` (backed, p ≥ bar) or `50 claps · 0.40 / bar 0.52` (not
  backed), its requirements as `✓ met` / `○ not met` with `ask`, and the modules that can still back it with
  previews ("Count & measure · if it passes → 0.58 · if it fails → 0.28"). Source labels: `video_review` "video
  review", `frames_judge` "proof shots", `gps` "GPS", `motion` "motion", `witness` "witness", module ids → module title.
  Cheating: red banner "Cheating detected" + signals.
- **Feed card**: badge unchanged + chip "2/2 claims backed"; cheating → "Not verified · cheating detected".

Previews on the detail are computed locally with the v4.5 math (module pass/fail on just that claim), exactly like the
v3 previews but per claim.

### v4.12 Shared video (all platforms)

The clips uploaded at submit (v4.4) are evidence anyone can watch: whoever can read the Moment can play its clips.

**Storage rules.** `clips/{uid}/{momentId}/{file}` `get` (download URL / metadata) is allowed to the owner (as v4.9)
**or to anyone, guests too,** when `moments/{momentId}` exists with `ownerUid == uid` and `status in ["sealed",
"rejected"]` (the same condition that makes the Moment public; cross-service `firestore.get`). Still no list, update
or delete; create unchanged.

**Feed field (Function-only, written at seal).** `feed.video` gains
```
clips: [{ path: "clips/{uid}/{momentId}/{sha256}.{ext}", sha256, ext: "mp4"|"mov"|"webm",
          contentType: "video/mp4"|"video/quicktime"|"video/webm", durationMs: number, hashOk: boolean|null }]
```
= the uploaded clips of `videoReview.clips` (those with `ext != null`), chain order. `[]` when none. Feed docs sealed
before v4.12 have no `clips` (treat as `[]`); `functions/scripts/backfill-feed-video.mjs` fills them.

**Feed autoplay.** The **feed clip** of a post is the last entry of `feed.video.clips` with `hashOk != false` (else
none). On the current (settled) feed slide, it plays **muted, looping, inline, without controls**, over the hero
photo, which stays as the poster until the first frame renders; it pauses when the slide leaves the screen, when the
app/tab goes to the background, and only one slide plays at a time. A small speaker button toggles sound for that
slide (default muted). The URL comes from the Storage SDK (`getDownloadURL` / `downloadUrl` / `downloadURL()`),
cached per path for the session; a failure just leaves the photo.

**Evidence room (detail).** A **Video** section under Proof lists every uploaded clip of the Moment, playable with
controls (not autoplayed), from `moments/{id}.videoReview.clips` where `uploaded` (path = `clips/{ownerUid}/{id}/
{sha256}.{ext}`), so the owner sees them before the seal too. A clip with `hashOk == false` is labelled "Hash does
not match the chain". The on-device clip list (owner, recording device) stays, below it, for clips not uploaded.

### v4.14 Long, compressed video (all platforms)

A `video` requirement may now be as long as the activity: up to **2 hours** (`minSeconds` <= 7200; "meditate for
30 minutes" is one 30-minute clip). Clips are made small **before they are hashed and chained**, so the chain, the
gallery copy and the upload are the same small file (compressing at upload would break the SHA-256 check).

**Clip cap** = longest `video` `minSeconds` x 1.05 + 15 s, clamped to [60 s (web) / 300 s (phones), 7200 s].

**Encoding profile** from the cap (web `clipProfile`, iOS/Android `ClipProfile`):

| tier | cap | frames | longest edge | video | audio |
|------|-----|--------|--------------|-------|-------|
| live | <= 5 min | camera rate | 1280 | 1.2 Mbit/s | 64 kbit/s |
| long | <= 20 min | 5 fps | 960 | 350 kbit/s | 32 kbit/s |
| slow | <= 2 h | 1 fps | 720 | 110 kbit/s | 24 kbit/s |

Time is never sped up: the clip's duration and continuous audio stay evidence. Web draws the camera into a canvas
at the profile's rate (`captureStream(fps)` + the mic track) for long/slow, and keeps <= 48 candidate middle frames
in memory. iOS records the movie (sensor lowered to ~10 fps for long/slow), then `ClipCompressor` re-encodes it
(H.264 at the profile's size/bitrate, frames thinned to `fps`, mono AAC); on any failure the original is kept.
Android encodes at capture (CameraX bitrate, SD for long/slow, the lowest supported sensor range), with a duration
limit at the cap and a 190 MB file-size guard.

**Review sampling** (`reviewSampling` in functions/src/video.ts). Footage <= 2 min: the model's default sampling.
Longer: `videoMetadata.fps` = 360 frames / total seconds (0.1 to 1 fps), low media resolution past 5 min, model
timeout 90 s + 0.1 s per second of footage (<= 300 s). Audio is always heard in full. The reviewer prompt says a low
frame rate is deliberate, not a cut or loop.

## Repo layout

```
docs/ARCHITECTURE.md  this file
shared/               prompts.json, ladder.json, test-vectors.json, test-vectors-v3.json, test-vectors-v4.json
                      (+ make-test-vectors*.mjs generators; v4 is the reference scoring), sample-moments/ (seed data)
functions/            Cloud Function (TS) + emulator tests
firestore.rules, storage.rules, firestore.indexes.json, firebase.json
web/                  React app (feed public, recorder)
ios/                  Xcode project (XcodeGen project.yml) — Verified.app
android/              Gradle project — app module
config/               git-ignored Firebase config files
```
