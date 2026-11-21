# Devpost text (draft; keep every claim true to the build)

## Tagline
Help appears where your eyes linger: a reader that notices you're stuck and explains it, on your device.

## Inspiration
People who struggle with dense text rarely ask for help. They re-read. A benefits letter, a lease, a medicine leaflet: the moment of confusion is visible in your eyes long before you'd think to select text and open a chatbot. We wanted help that arrives at that moment, without being asked, and without sending your camera or your difficulties anywhere.

## What it does
- Follows your gaze with your webcam (or your mouse) and lights the paragraph you're reading.
- Notices when you're stuck: you stay far longer than a paragraph warrants, or you come back to one you'd moved past.
- Writes a plain-language version and explains the confusing terms in the margin, saying why it appeared.
- Explains charts and figures.
- Opens your own PDFs and pasted text, with adjustable size, spacing and a hyperlegible typeface.
- Every answer says where it ran (on this device or in the cloud) and how long it took.

## How we built it: hybrid by job, not by fallback
- **Firebase AI Logic hybrid inference, two models with opposite routing.** Paragraph help uses `PREFER_ON_DEVICE`: it fires often, it reveals what you find hard, and it has to arrive *while you're still stuck*, so Gemini Nano answers locally with structured JSON output. Chart help uses `PREFER_IN_CLOUD` with the image as PNG; offline, the SDK falls back to Nano.
- **Speculative on-device inference.** When you settle on a paragraph, Linger prepares help before you need it. We only do this on-device, where it is private and free; the note then says "Prepared on this device before you needed it."
- **Gaze:** MediaPipe Face Landmarker in the browser → iris and head-pose features → ridge regression from a 9-point calibration → One Euro smoothing → an attention engine that reasons about paragraphs (webcam gaze is ~100–200 px accurate, so we never pretend to track words).
- **App Check** with reCAPTCHA Enterprise; **Remote Config** for reading thresholds and the cloud model; **Hosting**; a service worker so the app works offline.
- Tested: unit tests for the gaze maths and attention engine, and a 30-check end-to-end suite in real Chromium that exercises both the cloud and on-device paths.

## Challenges
Webcam gaze is noisy; we designed around it (block-level targets, hysteresis, relative "stuck" timing with a 12-second ceiling) rather than pretending to precision we don't have.

## What's next
[Fill in honestly at submission time.]

## Built with
firebase-ai-logic, gemini-nano, gemini, firebase-app-check, firebase-remote-config, firebase-hosting, mediapipe, react, typescript, vite, pdf.js
