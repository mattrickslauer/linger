# Verified

**Proof that a moment really happened, in the age of AI fakes.**

Anyone can generate a photo of a 10 lb bass, a summit at sunrise or a finished marathon. Verified records the
moment itself instead of a picture of it: where you were, how you moved, what the camera saw and when, chained
together so nothing can be swapped later. AI helps you collect good evidence and weighs it. Then plain code, not
the AI, decides whether the moment is sealed as **Verified**.

Built for **#BuildHybridAI 2026** with **Firebase AI Logic hybrid inference** on **web, Android and iOS**.

---

## Who it's for

- **Anglers and fishing derbies.** A catch is only worth a prize if it's real. Verified started from
  DerbyFish's derby use case.
- **Fitness and outdoor challenges.** A 5k, a summit, a 30-day streak, proven without trusting a screenshot.
- **Brands and sponsors running contests.** Pay out on moments you can actually trust.
- **Anyone who wants a post nobody can call fake.**

## How it works

1. **Say what you're about to do.** For example, "Catch and release a largemouth bass at Lake Mission Viejo."
2. **Record the moment.** Verified records a session like a run tracker. It logs GPS about once a second and the
   motion sensors ten times a second, and you take proof shots along the way. Every 5 seconds the data is sealed
   into a SHA-256 hash chain, so a chunk can't be edited, removed or reordered without breaking the chain.
3. **On-device coach.** Each proof shot is checked on your phone or in Chrome by an on-device model. It works at
   a lake with no signal. It can only say *keep going* or *retake* ("Too dark, face the light", "Looks like a
   screen, shoot the real thing"). **It can never verify anything.**
4. **Offline first.** No signal? Everything queues on the device and syncs itself later. Raw data is deleted
   from your phone only after the server provably holds all of it.
5. **Three cloud AIs review it.**
   - The **judge** asks whether the evidence fits what you said you'd do.
   - The **skeptic** hunts for fakes: photos of screens, stock or reused images, AI-generated artifacts,
     staging, a "hike" with no movement.
   - The **scorer** gives the **verification score**: the probability your claim is true given the evidence.
     It starts from the assumption that most submissions are cheating (a 20% prior) and only goes up for
     evidence that's hard to fake.
6. **Code decides.** A Cloud Function recomputes everything itself and alone writes the seal:
   - the hash chain
   - timing (at least 20 s, never backwards)
   - physics (no GPS jumps faster than 70 m/s, live motion sensors)
   - proof-frame fingerprints
   - the AI results (judge consistent, skeptic found nothing, score of at least 50%)

   **AI proposes; code decides.**
7. **The public feed** shows each sealed Moment: map track, frame timeline, motion chart, what each AI said,
   the verification score and the seal checklist. No sign-in is needed to browse.

## Hybrid AI: where Firebase AI Logic runs

| Job | Mode | Web (Chrome) | Android | iOS |
|---|---|---|---|---|
| Live coach, once per proof shot | `PREFER_ON_DEVICE` | Gemini Nano in Chrome (image + text), cloud fallback: [`web/src/firebase.ts`](web/src/firebase.ts) `liveCheckModel()`, [`web/src/ai.ts`](web/src/ai.ts) `liveCheck()` | Gemini Nano via the on-device extension, cloud fallback: [`Ai.kt`](android/app/src/main/java/com/mattricks/verified/ai/Ai.kt) | Apple Foundation Models via `hybridModel(primary:secondary:)`, with Apple Vision labels for the image: [`LiveCoach.swift`](ios/Verified/AI/LiveCoach.swift) |
| Judge, skeptic, scorer, once per Moment | `ONLY_IN_CLOUD` (Gemini, JSON schema, with images) | [`web/src/ai.ts`](web/src/ai.ts) `cloudReview()` | [`Ai.kt`](android/app/src/main/java/com/mattricks/verified/ai/Ai.kt), [`Judging.kt`](android/app/src/main/java/com/mattricks/verified/judge/Judging.kt) | [`JudgeRunner.swift`](ios/Verified/AI/JudgeRunner.swift) |

Why this split: the coach runs on every shot, often with no signal, so it has to be instant, private and free;
on-device is the right place. Judging a whole Moment needs the larger multimodal model and happens once, after
sync, so it runs in the cloud. Every check records which model actually ran (`on_device`, `cloud` or `none`),
and the feed shows a "checked on-device" chip.

All prompts live in one file shared by the three apps: [`shared/prompts.json`](shared/prompts.json).

## Try it

- **Web:** _hosted link goes here at submission_ (Chrome; on-device needs Gemini Nano enabled).
- **Android:** _test build link goes here at submission_
- **iOS:** _TestFlight link goes here at submission_

Or run the web app locally with built-in sample Moments. You don't need a Firebase account:

```bash
npm --prefix web install
npm --prefix web run dev:fixtures      # open the printed localhost URL
```

## Run the whole thing yourself

Requirements: Node 22 and JDK 21+ (for the Firebase Emulator Suite).

```bash
npm run setup          # install Cloud Functions dependencies
npm test               # seal unit tests, security-rules tests, end-to-end seal on the emulators
npm run emulators      # auth, firestore, functions, hosting; UI at http://127.0.0.1:4000
npm run seed           # in another terminal: writes 4 demo Moments, and the function seals them
```

For your own Firebase project (Firestore, AI Logic, App Check, deploy), follow [`infra/setup.md`](infra/setup.md).
To build the iOS app, see [`ios/README.md`](ios/README.md).

## What's next

These are designed but not built yet; see the
[design draft](docs/superpowers/specs/2026-11-25-witness-and-verification-ladder-design.md):

- **A voice interview to set your intention.** Say "going fishing" and an AI asks a few quick questions out loud,
  fills in the rest (place, season, likely species) and starts tracking.
- **A bar that matches the claim.** A 10 lb bass in Norway in winter is harder than one in a stocked pond, so the
  AI sets how much proof each Moment needs.
- **A realtime witness.** During the session an AI witness asks for the evidence that would convince a skeptic,
  by voice and on-screen ("Show me the rock you're going to climb"), and snaps the proof. If your phone is
  locked, it sends a notification.
- **A verification ladder.** After the free review, add more checks (full-video review, counting and measuring,
  a human reviewer) and see what your score becomes if they pass. Each step up is harder; 100% is the limit,
  never a purchase. Failed checks lower the score.
- **Video and counted values.** Catches, reps, laps, length and weight, checked from video and sensors.

## Repository

| Path | What |
|---|---|
| [`web/`](web) | React + Vite web app (record, feed, detail) |
| [`android/`](android) | Kotlin + Jetpack Compose app |
| [`ios/`](ios) | SwiftUI app |
| [`functions/`](functions) | Cloud Functions: the deterministic seal ([`seal.ts`](functions/src/seal.ts)) |
| [`shared/`](shared) | Prompts, hash test vectors, sample Moments shared by every platform |
| [`firestore.rules`](firestore.rules) | Who can write what (only the Cloud Function writes a seal) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full contract: data model, hashing, seal, sync |

Some patterns (deterministic gate after AI review) are reused from our earlier hackathon entry, Warrant.

## License

[Apache-2.0](LICENSE)
