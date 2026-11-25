# Witness agent, structured intentions and the verification ladder — design (DRAFT)

Status: **draft, not approved for build.** Captures the product conversation of 2026-11-24/25. Items marked
*(proposal)* are Claude's calls awaiting the owner's confirmation; everything else was decided by the owner.
Already shipped and not repeated here: the scorer agent (P(claim true | evidence) from a 0.2 prior, seal v2 gate at
0.5) — see `docs/ARCHITECTURE.md`.

## Why

AI can fake any photo. Verified exists to make a real moment provable. Two gaps remain after the scorer:

1. Setting an intention is a typed form, so claims are vague and not comparable ("caught a fish" vs "caught a
   10 lb largemouth in Norway in December"). The bar for "verified" can't depend on difficulty if difficulty
   isn't captured.
2. Once recording, the person gets no help collecting the evidence that would actually convince a skeptic, and
   the only way to buy more certainty is to record more.

## Goals

- **Voice interview to set the intention.** The person can say as little as "going fishing"; an AI asks short
  follow-ups by voice, assumes what it can (location from GPS, season, likely species, conditions), and starts
  tracking the session.
- **Structured, congruent intention.** The AI translates every intention into one loose, shared structure so
  difficulty can be compared across activities and places (a 10 lb bass in Africa is not a 10 lb bass in Norway).
- **AI-set bar.** The score a Moment needs to count as Verified is set by AI from that structure: everything is
  relevant (place, season, size, rarity, conditions).
- **Realtime witness agent during the session.** It watches the session, asks questions by voice plus an
  on-screen toast, and asks the person to show things ("show me the rock you're going to climb" → the app snaps
  a proof photo). Its job is to help the person reach the highest verification they can. If the phone is
  locked or the app is in the background when the witness has a question, it sends a push notification.
- **Video as evidence** and **counted numeric values** (catches, reps, laps, length, weight, distance).
- **Verification ladder (monetization).** After the free baseline run, the owner of the post can opt in to more
  verification modules, prompted by the app from a list. Each shows what the score will become *if it passes*.
  The limit of verification is exactly 1 and each step up is progressively harder to reach. Modeled on
  DerbyFish's BAIT (1 BAIT = $1, spent only on verification).

## Non-goals / anti-goals

- **Paying must never buy a score.** It buys more scrutiny. *(proposal)* Credits are spent whether a module
  passes or fails, and a failed module lowers the score, so buying modules is a bad bet for a cheater.
- The on-device model still can never verify anything (it coaches and asks; cloud + code decide).
- No chat-bot personality for its own sake: the witness asks only for evidence that moves the score.

## Constraints

- Hackathon: Firebase AI Logic hybrid inference must be real and visible; deadline 2026-11-30 14:00 PT.
- Three clients (web, Android, iOS) share `shared/prompts.json` and the Firestore contract.
- Everything the witness captures must enter the existing SHA-256 chunk chain (no gallery uploads).
- Offline-first: the session must record with no signal; the witness degrades to on-device or silence.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | **Pilot-style turn-based voice** (owner's pick): speech-to-text in, LLM turn, sentence-by-sentence TTS out, as in puq-city's Pilot (`apps/guide/src/scripts/pilot.ts` `listen()`, `pilot-voice.ts`, `services/guide-api/src/speak.mjs`) | Proven in production, cheap, works with Firebase AI Logic text/image calls on all three platforms; not full-duplex |
| B | Gemini Live (bidirectional audio) through Firebase AI Logic | Most natural conversation; newest API, harder offline story, higher cost per minute |
| C | Text-only toasts, no voice | Simplest; loses the "witness standing next to you" feel the owner wants |

Chosen: **A**, Pilot as the model.

## Design

### 1. Voice interview → structured intention

- Voice in: platform speech recognition (Web Speech API on web, Android `SpeechRecognizer`, iOS `SFSpeechRecognizer`).
- Turn model: hybrid via Firebase AI Logic — *(proposal)* on-device first for short follow-up questions
  (Gemini Nano / Apple Foundation Models), cloud for the final structuring pass.
- Voice out: Gemini TTS with sentence-level caching (Pilot's `speak.mjs` pattern) *(proposal: through a Cloud
  Function so the key stays server-side)*; platform TTS when offline.
- Ends when the structure has the required fields or the person says "start"; then tracking starts.
- Output, *(proposal)* stored on `moments/{id}.intention` alongside the existing `{text, category}`:

```
intention: {
  text, category,                                  // existing
  activity: "fishing",                             // free-form verb/noun
  goal: "catch a largemouth bass",
  quantities: [{ metric: "weight", value: 10, unit: "lb", measuredBy: "scale|photo|count|gps|motion|claim" }],
  place: { name, lat, lng, region, country },      // auto-filled from GPS, confirmed by voice
  window: { start, expectedMinutes },
  conditions: ["winter", "ice"],                   // assumed by AI, editable
  difficulty: { level: 0..1, rationale: string },  // AI, from everything above
  bar: 0..1                                        // AI-set score needed to be Verified
}
```

### 2. AI-set bar

- A cloud call turns the structure into `difficulty.level` and `bar` with a short rationale shown to the person.
- *(proposal)* Bar range 0.5 (ordinary: "went for a walk") to 0.95 (record-class claims); the seal compares the
  final score to the Moment's bar instead of the fixed 0.5 once this ships (seal v3).

### 3. Realtime witness agent

- Runs during recording. Inputs: the structured intention, live session summary (GPS, motion, frames so far),
  the current score estimate.
- Asks for the cheapest evidence that would move the score most: "Show me the rock you're going to climb",
  "Hold the fish next to the ruler", "Pan slowly across the lake".
- Delivery: spoken (Pilot pattern) + toast in the record screen; tapping/answering opens the camera with the
  request as the frame's label. The resulting frame is a normal proof frame (hashed into the chain), tagged with
  the witness request it answers.
- Phone locked / app in background: local notification (offline) or FCM push *(proposal)*; the request stays in
  the session until answered or skipped.
- Hybrid: on-device model drafts requests offline; cloud refines when online.

### 4. Verification ladder

- After the baseline (judge + skeptic + scorer) the owner sees a list of modules with price and a preview:

```
 Bass at Lake Mission Viejo         score 0.62  (bar 0.80)
 ▸ Watch the full video        3 credits   if it passes → 0.79
 ▸ Count + measure the catch   2 credits   if it passes → 0.73
 ▸ Human reviewer             10 credits   if it passes → 0.92
 Modules that fail lower the score. Credits are spent either way.
```

- Score math *(proposal)*: each module has a strength `s`. Pass: `p' = p + s·(1 − p)`. Fail: `p' = p·(1 − s)`.
  Gains shrink near 1, so 1 is the limit and each step costs more. Module order is free; some cost more than
  others.
- Candidate modules: full-video review, counting (reps/catches/laps), measurement (length via ruler/bump board,
  weight), second-model cross-check, place/time cross-check (weather, daylight), human reviewer.
- Credits *(proposal)*: BAIT-like, 1 credit = $1 via Stripe, a few free per month. Ledger + balance, owner-only.
- The seal (code) recomputes the score from module results; clients never write the score directly.

### 5. Video and counting

- Video clips are already recorded on Android and iOS (SHA-256 of the file in the chain, clip stays on the
  phone). The full-video module uploads the clip, verifies its hash matches the chained hash, then runs a cloud
  multimodal pass.
- Counting: sensor-countable metrics (distance from GPS, reps from motion) computed deterministically in the seal;
  camera-only metrics (fish, cards, laps seen) counted by the AI from video.

## Build order

1. Voice interview + structured intention
2. AI-set bar (seal v3)
3. Witness agent during the session
4. Verification ladder + credits
5. Video and counting modules

## Open questions for the owner

- Credits: real-money Stripe at launch, or free credits only for the hackathon demo?
- Who can see the bar and the ladder: owner only, or also viewers of the public post?
- Human reviewer module: who are the reviewers (staff, community votes like DerbyFish's "Verified or Nah")?
