# Linger

**Help appears where your eyes linger.**

Linger is a reading assistant that follows your eyes through your webcam. Look at a paragraph and it comes into the light. Stay on it far longer than its length warrants, or come back to it after moving on, and Linger writes a plain-language version with the confusing terms explained, in the margin, right beside where you are stuck.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) with **Firebase AI Logic hybrid inference**: Gemini Nano answers on your device, and the cloud steps in only where it earns its place.

## Who it is for

Readers for whom dense text is a wall: people with dyslexia or low vision, people reading in a second language, and anyone handed a lease, a benefits letter or a technical explainer. Today they have to notice they are lost, select text, open a tool and ask. Linger notices for them.

## Why hybrid, and why it matters here

| Job | Where it runs | Why |
|---|---|---|
| Eye tracking (MediaPipe Face Landmarker) | Browser, always | Camera frames never leave the device. |
| Paragraph help: plain rewrite and key terms | **Gemini Nano on-device** (`PREFER_ON_DEVICE`), cloud fallback | Fires many times per page, and *what you struggle with* is personal. On-device is private, instant and free, so Linger can even prepare help speculatively the moment you settle on a paragraph. |
| Chart and figure explanation | **Cloud Gemini** (`PREFER_IN_CLOUD`), on-device fallback | Rare, multimodal, benefits from a larger model. Offline, Nano (which accepts PNG/JPEG) still answers. |

Every answer is labelled with where it ran and how long it took, and the footer keeps a running count.

## Firebase products used

- **Firebase AI Logic** (Web SDK hybrid inference) in [`web/src/firebase.ts`](web/src/firebase.ts) and [`web/src/ai/assist.ts`](web/src/ai/assist.ts)
- **App Check** (reCAPTCHA Enterprise; debug token for local testing)
- **Remote Config**: reading thresholds (dwell time, stuck factor, reading speed), cloud model and prefetch, tuned live without a release ([`remoteconfig.template.json`](remoteconfig.template.json))
- **Hosting**

## Run it

Requirements: Node 22+, desktop Chrome 139+ with Gemini Nano enabled (`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled, restart). Without Nano, Linger still works, answering from the cloud.

```bash
cd web
cp .env.example .env.local   # fill in your Firebase web config and App Check key
npm install
npm run dev                  # http://localhost:5173
npm test                     # gaze math and attention engine
```

Firebase setup: create a project, add a Web app, enable **AI Logic** with the Gemini Developer API, register the app in **App Check** with reCAPTCHA Enterprise (or set `VITE_APPCHECK_DEBUG=true` and register the printed debug token), then `npx firebase deploy --only hosting,remoteconfig` from the repo root after `npm run build` in `web/`.

No webcam? Choose **Read with the mouse**: the pointer stands in for your gaze and drives the same engine.

## How it works

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). In short: Face Landmarker → iris-in-eye and head-pose features → a ridge regression fitted by a 9-point calibration → One Euro smoothing → an attention engine that reasons about blocks, not words, and emits *focus*, *stuck* and *blur* → Firebase AI Logic.

## Third-party code and disclosure

- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (Apache-2.0) for face landmarks, served from our own origin.
- Fonts: Literata and Atkinson Hyperlegible Next (SIL Open Font License) via Google Fonts.
- All code in this repository was written during the contest period (from 18 Nov 2026), with AI coding assistance.

## License

[Apache-2.0](LICENSE)
