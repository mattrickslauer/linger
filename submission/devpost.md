# Devpost submission: Verified

Copy each section into the matching Devpost field. Everything below the "Project story" line goes into the
story editor as-is (Devpost renders Markdown). Placeholders are marked **TODO**.

---

## Project name

Verified

## Elevator pitch (200 characters max)

> An on-device intent & evidence factory. Say what you'll do; Gemini Nano / Apple Foundation Models plan and coach the proof offline, Gemini in the cloud reads it, code seals it.

(176 characters)

## Platforms (select all)

Web (Chrome) · Android · iOS

## Try it out links

- Live web app, guest mode, no sign-in: https://verified-99e74.web.app
- iOS (TestFlight public link): https://testflight.apple.com/join/8SGF1Pqr
- Android APK: **TODO** https://github.com/mattrickslauer/verified/releases
- Source code (Apache-2.0): https://github.com/mattrickslauer/verified

## Video demo link

**TODO** YouTube URL (public, ≤ 3:00, English with subtitles from `submission/Verified-demo.srt`)

## Built with (25 max, comma-separated)

firebase-ai-logic, hybrid-inference, gemini-nano, apple-foundation-models, gemini, gemini-3.5-flash, vertex-ai, firebase-app-check, firebase-authentication, cloud-firestore, cloud-functions-for-firebase, cloud-storage-for-firebase, firebase-remote-config, firebase-hosting, chrome-prompt-api, apple-vision, typescript, react, vite, kotlin, jetpack-compose, swift, swiftui, node.js, claude-code

(25 tags)

---

## Project story

### Inspiration

A photo used to be proof. Now anyone can generate one in seconds or photograph a screen. Fitness challenges,
fishing derbies and sponsor contests still pay out on "pics or it didn't happen", so they run on trust, and honest
people get doubted along with the cheats.

Faking one frame is easy. Faking a whole session is hard: minutes of GPS, motion, timing and video that all agree
with each other. So I didn't build a better photo checker. I built something that records the session.

### What it does

**Verified is an on-device intent and evidence factory.** You say what you're about to do, and it builds the proof
while you do it.

1. **Say it.** A short voice interview runs **on the device** (Gemini Nano in Chrome and on Android, Apple
   Foundation Models on iOS) and turns one sentence ("20 push-ups at the top of the hill") into **claims** that can
   each be checked (a place, an action, a count) and an **evidence plan**: the minimum a fair skeptic would need.
2. **Do it.** The phone records GPS, motion, video and proof shots. Every 5 seconds it closes a chunk that is
   **SHA-256-chained** to the previous one, so changing one byte later breaks the chain.
3. **Get coached, on-device.** Each proof shot is checked against your intent locally in under a second, offline,
   without the image leaving the phone. The on-device model has exactly one power: it can say **"retake"**. It can
   never say "verified".
4. **Answer the witness.** A live AI witness asks for whatever the plan still needs ("show me the view behind
   you"). Drafts run on-device; a cloud pass sharpens them when there is signal.
5. **Prove it.** When online, the Moment syncs (offline-first). In the cloud, Gemini watches the whole video claim
   by claim, and three independent reads (**judge**, **skeptic**, **scorer**) look at the frames. Then a Cloud
   Function re-checks the hash chain, timing and physics and is the only thing allowed to write the seal.
6. **Share it.** Sealed Moments appear in a public feed with the map, video, frames, motion chart, AI reasons and
   every check. Fakes (like an AI-generated fish filmed off a laptop) come back **Rejected** with the skeptic's
   reason.

Push-ups are only the demo. Any intent works: a run, a catch, a repair, a recipe, a song.

**Value proposition:** anyone who pays or ranks people on real-world proof (tournaments, challenges, sponsors,
coaches) gets evidence they can audit instead of a photo they have to trust. Recording and the baseline review are
free. When the stakes are high, owners can buy extra checks on a verification ladder; credits are spent whether a
check passes or fails, so **paying buys scrutiny, never a score**.

### How I used Firebase AI Logic (hybrid inference)

Every client AI call goes through the **Firebase AI Logic hybrid inference SDK**, on three platforms, and each job
runs where it makes sense:

- **On-device first (`InferenceMode.PREFER_ON_DEVICE`):** the live coach on every proof shot, interview turns,
  the difficulty preview and witness drafts. These run many times per session, often with no signal, so they need
  to be instant, private and free. Falls back to Gemini in the cloud when the device has no local model.
  - **Web (Chrome):** Gemini Nano via the Prompt API, image + text input, JSON-constrained output.
  - **Android:** Gemini Nano through `OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE)`.
  - **iOS:** `.hybridModel(primary: SystemLanguageModel.default, secondary: Gemini)`. Apple Foundation Models is
    text-only, so the app feeds it Apple Vision labels for each image.
- **Cloud only (`InferenceMode.ONLY_IN_CLOUD`):** structuring the intention into a strict schema, the judge, the
  skeptic and the scorer. These are once-per-Moment, multimodal over many frames, and need a bigger model.
- **Server (Cloud Functions + Gemini on Vertex AI):** the difficulty bar, the full-video review and paid ladder
  checks, because no client may set its own bar or result.

**Routing is visible, not assumed.** Every hybrid response's `inferenceSource` is stored with the Moment and shown
in the app as an **On-device** or **Cloud** chip.

**Hybrid is a trust boundary, not just a cost trade-off.** The small local model coaches; it never judges. A
hallucinating or tampered local model can at worst ask for a retake. AI only proposes; deterministic code seals.

### How I built it

- **Three native apps, one contract:** React + Vite + TypeScript (web), Kotlin + Jetpack Compose (Android),
  Swift + SwiftUI (iOS). One shared spec (`docs/ARCHITECTURE.md`), one prompts file (`shared/prompts.json`) used by
  every platform and the functions, and shared SHA-256 test vectors so all three hash chains match byte for byte.
  A Moment recorded on any platform is sealed by the same function and shows in the same feed.
- **Firebase AI Logic** with **App Check** on every platform: reCAPTCHA Enterprise (web), Play Integrity
  (Android), App Attest + DeviceCheck (iOS).
- **Firebase Authentication** (one Google sign-in, same uid on all three), asked for only when something must be
  written. Guests can browse and record without an account.
- **Cloud Firestore** with offline persistence plus a local raw vault. Security rules make chunks append-only and
  the seal, feed, score and credits server-only.
- **Cloud Functions** (v2, Node 22) for the deterministic seal, video review, verification ladder and credits;
  **Cloud Storage** for video clips, re-hashed against the chain; **Remote Config** to switch the cloud Gemini
  model without a new build; **Firebase Hosting** for the web app.
- Built with **Claude Code** as the coding agent.

### Challenges I ran into

- **Making a small model useful without trusting it.** The answer was to limit its power to "retake" and move every
  decision into code.
- **Apple Foundation Models is text-only**, so iOS pairs it with the Apple Vision framework to describe images.
- **Offline-first without losing data.** Raw data is deleted from the phone only after the server provably holds
  all of it.
- **Keeping three platforms identical**: same bytes hashed, same prompts, same seal rules, enforced by shared test
  vectors.

### Accomplishments that I'm proud of

- One hybrid AI product shipped on **Web, Android and iOS** in under two weeks, live and testable today.
- The on-device / cloud split is a deliberate design, and every answer shows which side ran.
- It catches real fakes: a photo of a screen gets **Rejected** with the reason.

### What I learned

On-device and cloud models are good at different jobs. Hybrid works best when you decide per job and give the
local model a narrow, safe role. And "AI says so" is not proof; AI evidence plus deterministic checks is.

### What's next for Verified

- Move judge, skeptic and scorer server-side and add device attestation of the sensor streams.
- On-device counting and measuring (reps, length against a ruler) before upload.
- A human-reviewer ladder check.
- An embed SDK so tournament and challenge apps can request a Verified Moment.

### Built during the hackathon

New project: first commit 18 Nov 2026, inside the submission period. Reused design patterns (not code) from my
earlier hackathon entry *Warrant*, my own sign-in service for Firebase custom tokens, and open-source libraries
listed in each platform's manifest. Full disclosure in the README.

### Try it in 30 seconds

Open https://verified-99e74.web.app (no account needed) and open any Moment in the feed. Look for a **Rejected**
one to see the skeptic catch a fake. To see the on-device route in Chrome, enable
`chrome://flags/#optimization-guide-on-device-model` and `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`.
