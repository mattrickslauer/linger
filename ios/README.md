# Verified for iOS

SwiftUI app for iOS 26+ (Swift 6, approachable concurrency). Tabs: **Feed** · **Record** · **Me**.
Contract: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Prompts: [`shared/prompts.json`](../shared/prompts.json),
bundled into the app as a resource.

## Hybrid AI: where Firebase AI Logic runs

| What | Where | API |
|---|---|---|
| Live coach, one call per proof shot (`liveCheck`, PREFER_ON_DEVICE) | **Apple Foundation Models on-device**, with Gemini in the cloud as the fallback | `ai.generativeModelSession(model: .hybridModel(primary: FirebaseAI.SystemLanguageModel.default, secondary: ai.geminiModel(name:)))` in `Verified/AI/LiveCoach.swift` |
| Frame → text for the on-device model | on-device | Apple Vision labels, OCR text, faces and hands (`VisionLabeler.swift`). Foundation Models takes text only, so these labels fill `{{frame}}`. |
| Judge, skeptic and scorer after sync (ONLY_IN_CLOUD, with images) | cloud | `ai.generativeModel(modelName:generationConfig:systemInstruction:)` with a JSON `responseSchema` (`JudgeRunner.swift`) |
| No signal and no on-device model | on-device | A heuristic from the Vision labels only. The Moment records `mode: "none"`. Recording is never blocked. |

The coach's mode (`on_device` or `cloud`) comes from `response.rawResponse.modelVersion`. The on-device model
reports `apple-foundation-models-system-language-model`. The mode is stored in every chunk's `check` and in
`moments/{id}.onDevice`. A card shows the "checked on-device" chip when any check ran on-device.

**The Firebase SDK is pinned to 12.19.3.** Versions 12.13 to 12.19 include the hybrid `GenerativeModelSession`
API that the [hybrid docs](https://firebase.google.com/docs/ai-logic/hybrid/ios/get-started) describe. Firebase
13.0.0 removed it ("remove legacy Foundation Models integration") and replaced it with
`ai.geminiLanguageModel(name:)` for Apple's `LanguageModelSession`, which needs Xcode 27 and iOS 27. Do not bump
to 13.x unless you port `LiveCoach.hybrid` to that API.

## Build and run (needs a Mac with Xcode)

1. **Install Xcode 26.2 or newer** from the App Store. Firebase 12.19.3 needs Swift 6.2.3, which ships with
   Xcode 26.2. Xcode 27 also works. Open Xcode once to accept the license and install the iOS platform, then run:
   `sudo xcode-select -s /Applications/Xcode.app`
2. **Install XcodeGen:** `brew install xcodegen`
3. **Add the Firebase config.** It is git-ignored and must never be committed.
   ```bash
   cp /path/to/config/GoogleService-Info.plist ios/Verified/GoogleService-Info.plist
   ```
   Take the plist from `.claude/worktrees/verified-core/config/` on the dev box, or download it from Firebase
   console → Project settings → iOS app `com.mattrickslauer.verified`.
4. **Sign-in** needs no setup: like Android, it goes through accounts.mattrickslauer.com (client `verified-app`,
   loopback redirect `http://127.0.0.1:47231/auth`) and trades the result for a Firebase custom token
   (`Verified/Auth/AccountsSignIn.swift`). No Google client id is needed in the plist.
5. **Generate the project and open it:**
   ```bash
   cd ios && xcodegen && open Verified.xcodeproj
   ```
   The first open resolves Swift packages (Firebase and the local `VerifiedCore`), which takes a
   few minutes.
6. **Signing.** Select target Verified → Signing & Capabilities → Team, and pick your Apple ID. Signing is
   automatic. Bundle id: `com.mattrickslauer.verified` (the App Store Connect record; it cannot change). If you
   change it, change it in `project.yml` and register the new id in Firebase. To avoid re-picking the team after each `xcodegen`, set
   `DEVELOPMENT_TEAM` in `project.yml`.
7. **Run on an iPhone 17 Pro:**
   - Connect the phone with a cable and trust the Mac.
   - Enable Developer Mode (Settings → Privacy & Security).
   - Select the phone as the run destination and press ⌘R.
   - Allow Camera, Location ("While Using") and Motion when the app asks.
   - The first launch on a new device may require Settings → General → VPN & Device Management → trust the
     developer app.
   - On-device AI needs Apple Intelligence turned on (Settings → Apple Intelligence & Siri) and its model
     downloaded. Me → Hybrid AI shows the state. When on-device AI is unavailable, the coach falls back to the
     cloud.
8. **App Check (debug).** Debug builds use the App Check debug provider. Copy the `App Check debug token` from
   the Xcode console and add it in Firebase console → App Check → Apps → iOS → Manage debug tokens. This is
   required once enforcement is on for AI Logic.

In the Simulator there is no camera. **Proof shot** sends a synthetic frame through the same pipeline: resize,
hash, Vision, coach, chain. GPS comes from Simulator → Features → Location (for example, *City Run*). Core
Motion does not report data in the Simulator, so the motion arrays stay empty, which the physics check allows.

## Emulator vs production

Production is the default. To use the Firebase Emulator Suite, start it from the repo root with
`npm run emulators`. That starts Auth 9099, Firestore 8080 and Functions (the seal), plus the UI on 4000. Then
switch the app over in one of these ways:

- **Simulator on the same Mac:** in the scheme (Product → Scheme → Edit Scheme → Run → Environment), set
  `USE_EMULATOR=1`. `EMULATOR_HOST` defaults to `127.0.0.1`.
- **iPhone on the same Wi-Fi:**
  - Turn on Me → Developer → *Use Firebase Emulator*, enter the computer's LAN IP, and relaunch.
  - The emulators must listen on all interfaces. Add `"host": "0.0.0.0"` to the `auth`, `firestore` and
    `functions` entries in `firebase.json` (owned by the backend). Alternatively, run the emulators on the Mac
    and use the Simulator.
  - Allow the Local Network prompt.
- With the emulator on, the sign-in screen shows **Emulator sign-in**. It sends an unsigned Google ID token to
  the Auth emulator, so no Google account or `CLIENT_ID` is needed.

Firebase AI Logic has no emulator, so the coach's cloud fallback and the judge/skeptic/scorer always call production
Gemini through the `verified-99e74` project. AI Logic must be enabled there (see `infra/setup.md`).

## What happens on a recording

1. **Start Moment** writes `moments/{uuid}` with `status: "recording"`. GPS starts at 1 Hz
   (`CLLocationUpdate.liveUpdates(.fitness)`), Core Motion at 10 Hz (gravity plus user acceleration in m/s²,
   rotation in rad/s), and the camera preview.
2. Every 5 s the buffer is sealed into the SHA-256 chain (`VerifiedCore.Chain`) as `chunks/{000000…}`. The
   payload JSON matches JS `JSON.stringify` byte for byte and is checked against `shared/test-vectors.json`.
3. **Proof shot** works like this:
   - The photo is resized to a 640 px longest side and saved as JPEG at quality 0.6 (ImageIO, EXIF orientation
     applied).
   - `frameSha` is the sha256 of the base64 string.
   - The image goes through Vision labels and the hybrid coach.
   - The chunk closes right away, holding the frame and its `check`.
   - The banner shows "On-device: keep going · bass in hand" or "Retake: fish not visible".
4. Writes are fire-and-forget. With offline persistence they queue when there is no signal. The badge reads
   `Offline · N chunks queued`, using `hasPendingWrites` from the chunk listener.
5. **Finish** is available after 20 s, the seal's minimum. It writes the stop event and the last chunk, then
   sets `summary`, `chunkCount`, `headHash` and `status: "submitted"`.
6. Once online, `JudgeRunner` sends up to 4 frames plus the summary to the judge, the skeptic and the scorer
   (ONLY_IN_CLOUD) and writes all three in one update. The Cloud Function then seals the Moment and publishes it to
   `feed/`.
7. **Feed → detail** shows:
   - the map track
   - the frame timeline with the coach verdict for each frame
   - a Swift Charts motion graph
   - the judge and skeptic reasons and the verification score
   - the seal checklist
   - a chain re-verification run on the phone

## Checks without Xcode

The Mac mini has only the Command Line Tools. This script runs `swift test` for `VerifiedCore`. It then builds a
harness from the app's Firebase-free sources (`ProofFrame`, `VisionLabeler`, the coach heuristic and JSON
parser, and `CameraController`) under Swift 6 strict concurrency and runs it against the sample frames:

```bash
ios/scripts/mac-check.sh                  # on the Mac
ios/scripts/mac-check.sh --remote studio  # from the Linux box (rsyncs to ~/verified-build)
```

## Layout

```
project.yml            XcodeGen spec (SPM: Firebase 12.19.3, local VerifiedCore)
VerifiedCore/          chain, payload JSON, summary (+ tests, also run on Linux/macOS)
Verified/App           entry, Firebase setup (emulator switch, offline cache, App Check, Remote Config)
Verified/Auth          accounts.mattrickslauer.com sign-in → Firebase custom token; emulator sign-in
Verified/Record        RecorderModel, sensors, camera, ProofFrame, Record + live screens
Verified/AI            LiveCoach (hybrid), JudgeRunner (cloud), Vision labels, prompts
Verified/Sync          Firestore writes, feed/my-moments/chunk-sync listeners, network monitor
Verified/Feed          feed cards, detail (MapKit, Swift Charts, seal checklist)
Verified/Me            profile, my Moments, hybrid AI status, developer switches
```
