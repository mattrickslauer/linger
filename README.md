# Verified — proof that a moment really happened

**Verified** turns a moment of your life into evidence. You say what you are about to do ("Catch and release a
largemouth bass at the lake"), record it live, and walk away with a sealed, public record that the thing
actually happened, here, now, done by you.

Built for the Firebase **#BuildHybridAI** hackathon on **iOS, Android and Web**, with every AI call going
through **Firebase AI Logic hybrid inference**.

| | |
|---|---|
| Live app (web: opens straight into the app as a guest, no sign-in needed) | https://verified-99e74.web.app *(deploying before submission)* |
| Demo video | *(YouTube link added at submission)* |
| iOS | TestFlight public link *(added at submission)* |
| Android | APK on the Releases page *(added at submission)* |
| Architecture contract | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Embed Verified into your app (SDK, coming soon) | [`/embed`](https://verified-99e74.web.app/embed) · plan in [`docs/SDK.md`](docs/SDK.md) |

## The problem

A photo used to be proof. Now anyone can generate one, stage one, or photograph a screen. That breaks every
place where people pay or compete on "pics or it didn't happen": fishing tournaments that pay prize money for a
catch photo, fitness challenges, outdoor achievements, community bets. Organisers fall back to trusting people or
to manual review, and honest people get doubted along with the cheats.

**Who it's for:** anglers and fishing derbies (a catch is only worth a prize if it's real), fitness and outdoor
challenges, brands and sponsors who pay out on contests, and anyone who wants a post nobody can call fake.

**A single image can't prove anything any more. A recorded session can.** Faking one frame is easy; faking
minutes of GPS, motion, timing and several camera frames that all agree with each other, with a hash chain that
breaks if you touch any of it, is hard.

## How it works

1. **Open the app, no sign-in.** Web, iOS and Android all open straight onto the public feed as a guest. Guests
   can browse, open any Moment and record their own; sign-in is asked for only when something has to be written to
   the server (upload, a ladder check, delete).
2. **Say what you're about to do.** A short **voice interview** (or typing) turns "going fishing" into a
   structured intention: goal, numbers to prove ("1 bass, 4 lb, weighed on a scale"), place, conditions and the
   assumptions the AI made, all editable. Follow-up questions run on the device; the final structuring runs in the
   cloud. The app shows a preview of the **bar** this claim will have to clear.
3. **Record a Moment.** A live session captures GPS (~1 Hz), motion (accelerometer + gyroscope, 10 Hz), proof
   shots or short video clips, and events. Every 5 s the data closes into a chunk chained with **SHA-256** to the
   previous one, so nothing can be inserted, removed or reordered later.
4. **On-device coach (hybrid).** Each proof shot is checked against the intention **on the device**: Gemini Nano
   in Chrome and on Android, Apple Foundation Models on iOS. It answers in under a second, works with no signal,
   and the image never leaves the phone for this step. It can only say **"keep going"** or **"retake: fish not
   visible"**. It can never verify. When no on-device model is available, the same call falls back to Gemini in
   the cloud.
5. **A realtime witness.** During the session an AI witness asks, out loud and on screen, for the evidence that
   would convince a skeptic ("Hold the fish next to the ruler"). **Show** opens the camera; the shot is tagged with
   the request and hashed into the chain like every other frame. With the phone locked it sends a local
   notification. Drafts run on the device; a cloud refine (4 s budget, latest frames) sharpens them when online.
6. **Offline-first.** Everything is written through Firestore with offline persistence, and also journalled to a
   local raw vault. At a lake with no signal the Moment keeps recording and syncs by itself later. The local raw
   copy is deleted only after the server provably holds every chunk. A guest's Moments stay in that local vault until
   they sign in; then the app offers to upload them, and they sync through the normal path under the new account.
   The chain binds only the Moment id, never an owner, so claiming a guest Moment does not change a single hash.
7. **Three cloud AI reads.** After sync, three separate Gemini calls look at the same evidence:
   - the **judge** decides whether the evidence is consistent with the intention;
   - the **skeptic** hunts for staging, screen photos, stock or AI images, and place/time mismatches;
   - the **scorer** estimates P(claim is true) from a cheater-heavy prior of 0.2.
8. **An AI-set bar.** A Cloud Function asks Gemini how hard the claim is (a 10 lb bass in Norway in December is
   not one from a stocked pond) and code maps that difficulty to the score the Moment must reach, between 0.50
   and 0.95.
9. **Code decides, not AI.** A Cloud Function recomputes the hash chain, timing, physics (no GPS jump faster than
   70 m/s), frame hashes, and reads the three AI opinions, and checks the score against the bar. Only this function can write the **seal** and
   the public feed entry. **AI proposes; deterministic code decides.**
10. **A verification ladder.** After the free review the owner can add checks (second opinion, place & time from
    sun angle, witness review, count & measure, full-video review), each showing "if it passes → 0.79 · if it fails
    → 0.50". Pass: `p' = p + s(1 − p)`; fail: `p' = p(1 − s)`, so the limit is exactly 1 and each step is harder.
    Checks run only in Cloud Functions, spend free demo credits (10 on first use, no payments) whether they pass or
    fail, and the server recomputes the score; clients never write it. Paying buys scrutiny, never a score.
11. **Public feed.** Anyone can open a sealed Moment: map track, frame timeline, motion chart, the AI reasons, and
   every seal check that passed or failed, plus the bar, the final score and every ladder result.

## Why hybrid, and where each model runs

The split is not decorative. Each call runs where it makes sense for that job:

| Call | Mode | Why there | Web | Android | iOS |
|---|---|---|---|---|---|
| **Live coach**, every proof shot | `PREFER_ON_DEVICE` | Many calls per session, often with no signal; instant, private, free. Its power is deliberately limited to "retake", so a small model is enough. | Gemini Nano in Chrome (image + text, JSON-constrained) | Gemini Nano (image + text) | Apple Foundation Models, fed by Apple Vision labels of the frame (the on-device model takes text only) |
| **Judge** | `ONLY_IN_CLOUD` | Once per Moment, multimodal over several frames; needs the larger model. | Gemini | Gemini | Gemini |
| **Skeptic** | `ONLY_IN_CLOUD` | An independent, adversarial second read. | Gemini | Gemini | Gemini |
| **Scorer** | `ONLY_IN_CLOUD` | A calibrated probability, not a yes/no. | Gemini | Gemini | Gemini |
| **Interview turns** (`interviewTurn`) | `PREFER_ON_DEVICE` | Short, conversational, often offline at the trailhead. | Gemini Nano | Gemini Nano | Apple Foundation Models |
| **Structure the intention** (`structureIntention`) | `ONLY_IN_CLOUD` | One call that must fill a strict schema well; offline it keeps the last on-device draft. | Gemini | Gemini | Gemini |
| **Bar preview** (`barPreview`) | `PREFER_ON_DEVICE` | A hint only; the binding bar is set on the server. | Gemini Nano | Gemini Nano | Apple Foundation Models |
| **Witness draft** (`witnessDraft`) | `PREFER_ON_DEVICE` | Runs every minute or so during recording, with no signal. | Gemini Nano | Gemini Nano | Apple Foundation Models |
| **Witness refine** (`witnessRefine`) | `ONLY_IN_CLOUD` | Optional, 4 s budget, sees the latest frames. | Gemini | Gemini | Gemini |
| **Bar** (`bar`) and **ladder modules** (`module*`) | Cloud Functions | Server-side so no client can set its own bar or result. | Gemini on Vertex AI, from the Cloud Function | ← | ← |

Every coach result records **which side answered** (`response.inferenceSource` on web and Android; the response's
model version on iOS). It is stored in each chunk (coach), in the intention (`interview.mode`, `preview.mode`) and
in each witness chain event (`by`), and shown in the app as an "On-device" or "Cloud" chip, so you can see the
routing happen. None of the on-device calls can verify anything: they coach, ask and preview.

### Where Firebase AI Logic is called in the code

| Platform | Model setup | Calls |
|---|---|---|
| Web | [`web/src/firebase.ts`](web/src/firebase.ts) (`getGenerativeModel` with `InferenceMode.PREFER_ON_DEVICE` / `ONLY_IN_CLOUD`) | [`web/src/ai.ts`](web/src/ai.ts), [`web/src/components/Interview.tsx`](web/src/components/Interview.tsx), [`web/src/witnessAgent.ts`](web/src/witnessAgent.ts) |
| Android | [`android/app/src/main/java/com/mattricks/verified/ai/Ai.kt`](android/app/src/main/java/com/mattricks/verified/ai/Ai.kt) (`OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE)`) | same file, used by `record/` (coach, [`Interview.kt`](android/app/src/main/java/com/mattricks/verified/record/Interview.kt), witness in `RecordViewModel.kt`) and `judge/` |
| iOS | [`ios/Verified/AI/LiveCoach.swift`](ios/Verified/AI/LiveCoach.swift), [`ios/Verified/AI/HybridAI.swift`](ios/Verified/AI/HybridAI.swift) (`.hybridModel(primary: SystemLanguageModel.default, secondary: geminiModel)`) | [`ios/Verified/AI/JudgeRunner.swift`](ios/Verified/AI/JudgeRunner.swift), [`ios/Verified/Record/InterviewModel.swift`](ios/Verified/Record/InterviewModel.swift), [`ios/Verified/Record/WitnessAgent.swift`](ios/Verified/Record/WitnessAgent.swift) |
| Cloud Functions | [`functions/src/ai.ts`](functions/src/ai.ts) (`@google/genai` on Vertex AI, service account, no key on any device) | [`functions/src/agents.ts`](functions/src/agents.ts) (bar + ladder modules) |

All prompts and JSON schemas live in one file shared by all three platforms and the functions:
[`shared/prompts.json`](shared/prompts.json); the ladder catalog is [`shared/ladder.json`](shared/ladder.json).

### Other Firebase products used

- **App Check**: reCAPTCHA Enterprise (web), Play Integrity (Android), App Attest with DeviceCheck fallback
  (iOS); debug providers for development builds. Required by Firebase AI Logic.
- **Authentication**: Firebase Auth with custom tokens: every platform signs in (with Google) through one OIDC
  provider, so a person has the same uid on web, Android and iOS. Requested only when an action writes to the
  server (guest mode everywhere else; no anonymous accounts).
- **Cloud Firestore**: offline persistence; security rules make chunks append-only and the seal and feed
  server-only, and the bar, verification score and credits ledger Functions-only ([`firestore.rules`](firestore.rules),
  tested in [`functions/test/rules.test.ts`](functions/test/rules.test.ts)).
- **Cloud Functions** (v2, Node 22): the deterministic seal ([`functions/src/seal.ts`](functions/src/seal.ts)), the
  AI-set bar, the `getCredits` and `runLadderModule` callables ([`functions/src/ladder.ts`](functions/src/ladder.ts),
  [`functions/src/credits.ts`](functions/src/credits.ts)) and owner delete cleanup
  ([`functions/src/index.ts`](functions/src/index.ts)).
- **Cloud Storage**: owner-uploaded video clips for the full-video check, create-only, re-hashed by the function
  against the hash in the chain ([`storage.rules`](storage.rules)).
- **Remote Config**: key `cloud_model` picks the cloud Gemini model without shipping a new build.
- **Hosting**: the web app.

## Trust model, honestly

The hash chain makes a Moment **tamper-evident** after recording, and the seal re-checks everything
deterministically. The AI reads are evidence, not authority. Two known limits for the hackathon version:
the cloud AI calls are made from the client (the rules require AI to run through Firebase AI Logic), and a
determined attacker with a modified client could still feed in fabricated sensor data. Moving the judge calls
server-side and adding device attestation of sensor streams are the next steps.

## What's built, and what's next

Built on all three platforms, from the approved design
([`docs/superpowers/specs/2026-11-25-witness-and-verification-ladder-design.md`](docs/superpowers/specs/2026-11-25-witness-and-verification-ladder-design.md),
contract in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) "v3"):

- **Guest mode** with claim-on-upload: no sign-in wall; local guest Moments are offered for upload at sign-in.
- **Voice interview → structured intention**, with platform speech recognition and text-to-speech (Web Speech API,
  Android `SpeechRecognizer`/`TextToSpeech`, iOS `SFSpeechRecognizer`/`AVSpeechSynthesizer`). A text field is
  always there as a fallback.
- **AI-set bar**, computed server-side; seal v3 compares the score with it. Clients show an on-device preview.
- **Realtime witness** during recording: voice + toast, "show me" shots tagged and chained, local notifications
  when the app is in the background (web: browser notification if allowed).
- **Verification ladder** with five runnable checks (second opinion, place & time, witness review, count & measure,
  full-video review), free demo credits and a Functions-only ledger. Results are public on the post.

Next:

- **Human reviewer** check (listed as "coming soon").
- **Counting and measuring on the device** (reps, length from a ruler in frame) before upload; today the
  count & measure check runs on the server from GPS, motion and frames.
- **Answering a witness "show me" with a video clip**, not just a photo; and full-video review from a device other
  than the one that recorded the clip.
- **Server-side judge, skeptic and scorer**, and device attestation of the sensor streams (see the trust model).

## Try it

**Judges, quickest path:** open the web app. It opens straight into the app as a guest, with no sign-in: the public
feed, a one-line pitch and a **Record a Moment** button. Open any Moment to see its map, frames, motion chart, AI
reasons, seal checks, its bar, its score and any ladder checks. Look for a **rejected** Moment to see the skeptic
catch a fake (a photo of a screen).

**Record one as a guest (no account needed):** press **Record a Moment**, answer the short voice interview (or type),
press **Start Moment**, take a few proof shots and answer the witness when it asks. The Moment, the coach and the
witness all work without signing in, and the Moment is kept on your device ("On this device · sign in to verify",
listed under **Me**).

**Get it verified:** sign in with Google when you want it uploaded. The app offers to upload your guest Moments;
keep recording for at least 20 seconds (the seal rejects shorter sessions). After **Finish** the Moment syncs, gets
its bar and its three AI reads, and appears sealed or rejected in the feed within about a minute. As the owner you
then get 10 free demo credits to run ladder checks on it.

To see the on-device route in Chrome you need Gemini Nano with image input, which at the time of writing is
behind flags: enable `chrome://flags/#optimization-guide-on-device-model` and
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart Chrome, and let the model download.
Without it, the coach falls back to the cloud and the chip says "Cloud".

**iOS:** iPhone with iOS 26+ and Apple Intelligence on for the on-device route (Me → Hybrid AI shows the state).
**Android:** Android 10+; the on-device route needs a phone with Gemini Nano, otherwise the cloud fallback runs.

## Build and run

Firebase config files are **not committed**. Create your own Firebase project, or ask for test access.
Full console steps: [`infra/setup.md`](infra/setup.md).

### Backend (Node 22, JDK 21+ for the emulators)

```bash
npm run setup         # install functions deps
npm test              # seal/bar/ladder unit tests + security-rules tests + end-to-end seal and ladder on the emulators
npm run emulators     # local Auth, Firestore, Functions, Storage, Hosting
npm run deploy        # rules, indexes, storage rules, functions, hosting (Blaze plan; Vertex AI API enabled)
```

### Web

```bash
cd web
cp .env.example .env.local   # fill in the Firebase web config + reCAPTCHA Enterprise key
npm install
npm run dev                  # http://localhost:5173
npm run dev:fixtures         # no Firebase at all: feed + detail from built-in sample data
npm test                     # unit tests (hash chain, geo, vault check, AI utils)
npm run build                # production build into web/dist, served by Firebase Hosting
```

### Android (Kotlin, Jetpack Compose)

Put `google-services.json` in `android/app/`, then:

```bash
cd android
./gradlew :app:assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest # hash chain, vault, logic tests
```

A debug build logs an App Check debug token on first launch; register it in the Firebase console
(App Check → Apps → Manage debug tokens) or AI calls are refused.

### iOS (Swift 6, SwiftUI; Xcode 26.2+)

See [`ios/README.md`](ios/README.md). In short: put `GoogleService-Info.plist` in `ios/Verified/`, then
`cd ios && xcodegen && open Verified.xcodeproj`. Pure logic (hash chain, payloads, vault check) is a Swift
package with tests: `cd ios/VerifiedCore && swift test`.

## Cross-platform by contract

One contract, three native apps. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) defines the Firestore data model,
the exact bytes that get hashed, the prompts and the seal rules. A Moment recorded on an iPhone, an Android phone
or in Chrome is sealed by the same Cloud Function and shows up in the same feed. All three hash implementations
are checked against the same vectors in [`shared/test-vectors.json`](shared/test-vectors.json).

## Repo layout

```
docs/ARCHITECTURE.md   the contract every platform builds against
docs/rules/            archived hackathon rules
shared/                prompts.json, ladder.json, hash and v3 test vectors, sample Moments
functions/             Cloud Functions: deterministic seal, AI bar, ladder + credits callables, delete cleanup, tests
firestore.rules        security rules (storage.rules for video clips)
web/                   React + Vite + TypeScript (public feed, recorder)
android/               Kotlin + Jetpack Compose
ios/                   SwiftUI app (XcodeGen) + VerifiedCore Swift package
infra/                 setup notes and deploy helpers
```

## Built during the hackathon, and what was reused

This is a **new project**: the first commit is 18 Nov 2026, inside the submission period (11–30 Nov 2026), and
everything in this repository was written during it. Disclosed pre-existing work:

- **Design patterns** (not code) from my earlier Google hackathon entry, *Warrant*: "AI proposes, deterministic
  code decides", a separate skeptic model, and a server-side seal.
- **Sign-in** on all three platforms goes through my own existing accounts service (an OIDC provider that hands
  back a Firebase custom token); the Android and iOS loopback-redirect sign-in flow is adapted from another of my
  apps, and the web uses the same service with a PKCE popup (full-page redirect if popups are blocked).
- Open-source libraries listed in each platform's package manifest (Firebase SDKs, React, Leaflet, Jetpack
  Compose, AppAuth, Mapbox, and others), used under their licenses.

Built with Claude Code as the coding agent.

## License

[Apache License 2.0](LICENSE)
