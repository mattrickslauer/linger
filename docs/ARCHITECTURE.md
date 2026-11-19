# Architecture

The single canonical doc for how Linger is built. Update the "As built" section in the same commit as the code it describes.

## Pipeline

```
webcam ──► MediaPipe Face Landmarker (WASM/GPU, local)
              │ 478 landmarks + facial transformation matrix
              ▼
         gazeFeatures()          iris position inside each eye, head forward axis and position
              │
              ▼
         ridge regression        fitted from a 9-point calibration (λ = 2, z-scored features)
              │
              ▼
         One Euro filter         heavy smoothing at rest, light during saccades
              │  screen point (or the mouse pointer in mouse mode)
              ▼
         AttentionEngine         blocks, not words: focus / stuck(long-dwell | reread) / blur
              │
      ┌───────┴───────────────────────────┐
      ▼ focus                             ▼ stuck
  lamp on the block                  margin note
  + speculative on-device help        (instant if prefetched)
      │                                   │
      └──────────► Firebase AI Logic ◄────┘
                   readerModel  PREFER_ON_DEVICE  (paragraphs, JSON output)
                   figureModel  PREFER_IN_CLOUD   (charts as PNG)
```

## Design decisions

- **Block-level attention.** Webcam gaze is accurate to ~100–200 px. Paragraph-sized targets with a 60 px margin and 250 ms switch hysteresis are robust to that; line- or word-level tracking is not.
- **"Stuck" is relative to length, with a ceiling.** Expected time = words ÷ wpm; stuck after `clamp(expected × stuckFactor, minStuckMs, maxStuckMs)` = 6–12 s by default. The ceiling matters: help that arrives after the reader gives up is useless.
- **Camera and model start in parallel**, GPU delegate first with a CPU fallback; a setup screen shows live face detection and only enables calibration once a face is seen. Measured: setup visible in <100 ms, tracker ready in ~2 s (headless Chromium, fake camera).
- **"Prepared before you needed it" is only claimed for real prefetches.** Ids requested speculatively on focus are tracked separately from ones the reader asked for.
- **Offline.** `public/sw.js` caches the shell, hashed assets, MediaPipe WASM/model and fonts (never Firebase/Gemini). With no network, `PREFER_IN_CLOUD` chart help falls back to Nano (verified in e2e B6).
- **PDFs never leave the device.** pdf.js (lazy-loaded) extracts text; lines are grouped by baseline and paragraphs by vertical gaps. Returning to an earlier, already-read block within 20 s is a re-read and triggers immediately.
- **Speculative inference only when it is free.** On focus, if Nano is `available` and `prefetch_on_device` is on, paragraph help is generated before the reader is stuck. We never prefetch against the cloud.
- **Routing per job, not per app.** The mode is fixed per `GenerativeModel`, so there are two models with opposite preferences.
- **Structured output on both paths.** On-device uses the Prompt API `responseConstraint` (plain JSON Schema); cloud uses `responseSchema`. `parseHelp` tolerates fenced or plain-text replies.
- **Everything tunable lives in Remote Config**, with code defaults identical to the template.

## As built

| Module | Responsibility |
|---|---|
| `web/src/gaze/tracker.ts` | Camera + Face Landmarker loop, assets from `/mediapipe` |
| `web/src/gaze/features.ts` | Landmarks → 11-dim feature vector; null on blink |
| `web/src/gaze/ridge.ts` | Ridge fit/predict |
| `web/src/gaze/oneEuro.ts` | One Euro filter |
| `web/src/gaze/attention.ts` | Attention engine (pure, clock-injected, unit-tested) |
| `web/src/firebase.ts` | App, App Check, Remote Config, the two hybrid models |
| `web/src/ai/assist.ts` | `explainParagraph`, `explainFigure`, inference source + latency |
| `web/src/App.tsx` | Modes (intro, setup, calibrating, eyes, mouse), calibration + accuracy, event wiring, prefetch, stats |
| `web/src/MarginNote.tsx` | Margin note: why it appeared, answer, route badge ("prepared before you needed it") |
| `web/src/ReaderSettings.tsx` | Text size, line spacing, typeface; persisted in localStorage |
| `web/src/content/library.ts` | Original sample documents (benefits letter, lease, leaflet, explainer) |
| `web/src/content/pdf.ts` | Local PDF → paragraphs (pdf.js, lazy) |
| `web/public/sw.js` | Offline service worker |
| `web/scripts/sync-mediapipe.mjs` | Copies WASM, downloads the face model (pre-dev, pre-build) |
| `web/e2e/run.mjs` | 30-check end-to-end suite: cloud path, on-device path (stubbed Prompt API), offline, PDF, setup |
| `infra/setup-firebase.sh` | Project, web app, APIs, reCAPTCHA key, App Check debug token, `.env` files |
