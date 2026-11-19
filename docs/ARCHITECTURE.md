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
- **"Stuck" is relative to length.** Expected time = words ÷ wpm; stuck after `max(minStuckMs, expected × stuckFactor)`. Returning to an earlier, already-read block within 20 s is a re-read and triggers immediately.
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
| `web/src/App.tsx` | Modes (intro, calibrating, eyes, mouse), calibration, event wiring, stats |
| `web/src/MarginNote.tsx` | Margin note and route badge |
| `web/scripts/sync-mediapipe.mjs` | Copies WASM, downloads the face model (pre-dev, pre-build) |
