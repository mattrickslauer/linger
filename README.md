# Verified — proof that a moment really happened

**Verified** turns a moment of your life into evidence. You say what you are about to do ("Catch and release a
largemouth bass at the lake"), record it live, and walk away with a sealed, public record that the thing
actually happened, here, now, done by you.

Built for the Firebase **#BuildHybridAI** hackathon on **iOS, Android and Web**, with every AI call going
through **Firebase AI Logic hybrid inference**.

| | |
|---|---|
| Live app (web, public feed, no sign-in needed) | https://verified-99e74.web.app *(deploying before submission)* |
| Demo video | *(YouTube link added at submission)* |
| iOS | TestFlight public link *(added at submission)* |
| Android | APK on the Releases page *(added at submission)* |
| Architecture contract | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

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

1. **Sign in** and **declare an intention**: one sentence plus a category (fishing, fitness, outdoors, making).
2. **Record a Moment.** A live session captures GPS (~1 Hz), motion (accelerometer + gyroscope, 10 Hz), proof
   shots or short video clips, and events. Every 5 s the data closes into a chunk chained with **SHA-256** to the
   previous one, so nothing can be inserted, removed or reordered later.
3. **On-device coach (hybrid).** Each proof shot is checked against the intention **on the device**: Gemini Nano
   in Chrome and on Android, Apple Foundation Models on iOS. It answers in under a second, works with no signal,
   and the image never leaves the phone for this step. It can only say **"keep going"** or **"retake: fish not
   visible"**. It can never verify. When no on-device model is available, the same call falls back to Gemini in
   the cloud.
4. **Offline-first.** Everything is written through Firestore with offline persistence, and also journalled to a
   local raw vault. At a lake with no signal the Moment keeps recording and syncs by itself later. The local raw
   copy is deleted only after the server provably holds every chunk.
5. **Three cloud AI reads.** After sync, three separate Gemini calls look at the same evidence:
   - the **judge** decides whether the evidence is consistent with the intention;
   - the **skeptic** hunts for staging, screen photos, stock or AI images, and place/time mismatches;
   - the **scorer** estimates P(claim is true) from a cheater-heavy prior of 0.2.
6. **Code decides, not AI.** A Cloud Function recomputes the hash chain, timing, physics (no GPS jump faster than
   70 m/s), frame hashes, and reads the three AI opinions. Only this function can write the **seal** and the public
   feed entry. **AI proposes; deterministic code decides.**
7. **Public feed.** Anyone can open a sealed Moment: map track, frame timeline, motion chart, the AI reasons, and
   every seal check that passed or failed.

## Why hybrid, and where each model runs

The split is not decorative. Each call runs where it makes sense for that job:

| Call | Mode | Why there | Web | Android | iOS |
|---|---|---|---|---|---|
| **Live coach**, every proof shot | `PREFER_ON_DEVICE` | Many calls per session, often with no signal; instant, private, free. Its power is deliberately limited to "retake", so a small model is enough. | Gemini Nano in Chrome (image + text, JSON-constrained) | Gemini Nano (image + text) | Apple Foundation Models, fed by Apple Vision labels of the frame (the on-device model takes text only) |
| **Judge** | `ONLY_IN_CLOUD` | Once per Moment, multimodal over several frames; needs the larger model. | Gemini | Gemini | Gemini |
| **Skeptic** | `ONLY_IN_CLOUD` | An independent, adversarial second read. | Gemini | Gemini | Gemini |
| **Scorer** | `ONLY_IN_CLOUD` | A calibrated probability, not a yes/no. | Gemini | Gemini | Gemini |

Every coach result records **which side answered** (`response.inferenceSource` on web and Android; the response's
model version on iOS). It is stored in each chunk and shown in the app as an "On-device" or "Cloud" chip, so you
can see the routing happen.

### Where Firebase AI Logic is called in the code

| Platform | Model setup | Calls |
|---|---|---|
| Web | [`web/src/firebase.ts`](web/src/firebase.ts) (`getGenerativeModel` with `InferenceMode.PREFER_ON_DEVICE` / `ONLY_IN_CLOUD`) | [`web/src/ai.ts`](web/src/ai.ts) |
| Android | [`android/app/src/main/java/com/mattricks/verified/ai/Ai.kt`](android/app/src/main/java/com/mattricks/verified/ai/Ai.kt) (`OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE)`) | same file, used by `record/` and `judge/` |
| iOS | [`ios/Verified/AI/LiveCoach.swift`](ios/Verified/AI/LiveCoach.swift) (`.hybridModel(primary: SystemLanguageModel.default, secondary: geminiModel)`) | [`ios/Verified/AI/JudgeRunner.swift`](ios/Verified/AI/JudgeRunner.swift) |

All prompts and JSON schemas live in one file shared by all three platforms:
[`shared/prompts.json`](shared/prompts.json).

### Other Firebase products used

- **App Check**: reCAPTCHA Enterprise (web), Play Integrity (Android), App Attest with DeviceCheck fallback
  (iOS); debug providers for development builds. Required by Firebase AI Logic.
- **Authentication**: Google sign-in.
- **Cloud Firestore**: offline persistence; security rules make chunks append-only and the seal and feed
  server-only ([`firestore.rules`](firestore.rules), tested in [`functions/test/rules.test.ts`](functions/test/rules.test.ts)).
- **Cloud Functions** (v2, Node 22): the deterministic seal ([`functions/src/seal.ts`](functions/src/seal.ts)) and
  owner delete cleanup ([`functions/src/index.ts`](functions/src/index.ts)).
- **Remote Config**: key `cloud_model` picks the cloud Gemini model without shipping a new build.
- **Hosting**: the web app.

## Trust model, honestly

The hash chain makes a Moment **tamper-evident** after recording, and the seal re-checks everything
deterministically. The AI reads are evidence, not authority. Two known limits for the hackathon version:
the cloud AI calls are made from the client (the rules require AI to run through Firebase AI Logic), and a
determined attacker with a modified client could still feed in fabricated sensor data. Moving the judge calls
server-side and adding device attestation of sensor streams are the next steps.

## What's next

Designed, not built yet (draft: [`docs/superpowers/specs/2026-11-25-witness-and-verification-ladder-design.md`](docs/superpowers/specs/2026-11-25-witness-and-verification-ladder-design.md)):

- **A voice interview sets the intention.** Say "going fishing" and an AI asks a few quick questions out loud,
  fills in the rest (place, season, likely species) and starts tracking.
- **A bar that matches the claim.** A 10 lb bass in Norway in winter is harder than one in a stocked pond, so the
  AI turns every intention into a comparable structure and sets how much proof that Moment needs.
- **A realtime witness.** During the session an AI witness asks, by voice and on screen, for the evidence that
  would convince a skeptic ("Show me the rock you're going to climb"), and the app snaps the proof. If the phone
  is locked, it sends a notification.
- **A verification ladder.** After the free review, the owner can add more checks (full-video review, counting
  and measuring, a human reviewer) and see what the score becomes if each passes. Each step up is harder and the
  limit is exactly 1. Checks cost the same whether they pass or fail, and a failed check lowers the score, so
  paying buys scrutiny, never a score.
- **Video and counted values.** Catches, reps, laps, length and weight, checked from video and sensors.

## Try it

**Judges, quickest path:** open the web app and browse the public feed. No sign-in is needed. Open any Moment to
see its map, frames, motion chart, AI reasons and seal checks. Look for a **rejected** Moment to see the skeptic
catch a fake (a photo of a screen).

**Record your own (web, Chrome desktop or Android):** sign in with Google, write an intention, press **Start
Moment**, take a few proof shots, and keep recording for at least 20 seconds (the seal rejects shorter
sessions). Press **Finish**; the Moment syncs, gets its three AI reads, and appears sealed or rejected in the feed
within about a minute.

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
npm test              # seal unit tests + security-rules tests + end-to-end seal on the emulators
npm run emulators     # local Auth, Firestore, Functions, Hosting
npm run deploy        # rules, indexes, functions, hosting (needs the Blaze plan for functions)
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
shared/                prompts.json, hash test vectors, sample Moments
functions/             Cloud Functions: deterministic seal, delete cleanup, tests
firestore.rules        security rules
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
- **Mobile sign-in** goes through my own existing accounts service (an OIDC provider that hands back a Firebase
  custom token); the Android and iOS loopback-redirect sign-in flow is adapted from another of my apps. The web
  app uses Firebase Auth Google sign-in directly.
- Open-source libraries listed in each platform's package manifest (Firebase SDKs, React, Leaflet, Jetpack
  Compose, AppAuth, Mapbox, and others), used under their licenses.

Built with Claude Code as the coding agent.

## License

[Apache License 2.0](LICENSE)
