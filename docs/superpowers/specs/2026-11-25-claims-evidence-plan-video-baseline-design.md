# Claims, evidence plan and video baseline (v4) — design

Status: **approved by the owner 2026-11-25** (direction from the owner; details are Claude's calls, built as v4).
Builds on v3 (`docs/ARCHITECTURE.md` v3.1–v3.10).

## The problem (seen in production)

"Clap 50 times" (web, recorded with a video clip) scored a baseline of **0.40** because the judge, skeptic and scorer
only ever see still frames: "Single frame cannot verify the complete count of 50 claps". The video only counted after
the owner paid for the `full_video` module (0.40 → 0.67). `count_measure` stayed locked ("needs a number in the
claim") because the typed intention had no structured `quantities`. An honest person who records exactly the right
evidence can therefore never reach Verified without paying, and modules can't say *what* they verified.

## Owner's direction

1. Break every intention into parts, and say which module backs which part ("some can back the 50, some can back the
   clap").
2. Video proof must be judged as video, not reduced to one frame.
3. The interview sets the session up to collect the **minimum evidence**; if that evidence is provided and **no
   cheating is detected**, the Moment is Verified.

## Design

### 1. Claims (`intention.claims`, server-authoritative `moments/{id}.claims`)

An intention is split into ≤5 **claims**, each one checkable on its own:
```
Claim = { id: "c1", kind: "action"|"count"|"measure"|"place"|"time"|"object"|"outcome",
          text: string (≤80),                       // "clapping", "50 claps", "largemouth bass", "≥ 6 lb"
          metric?: string, value?: number, unit?: string }   // count/measure only
```
"clap 50 times" → `c1 action "clapping"`, `c2 count "50 claps" {metric:"claps", value:50, unit:"claps"}`.
- Clients draft claims in the interview (`interviewTurn` on-device, `structureIntention` cloud) and store them on the
  intention (frozen after recording, like the rest of the intention).
- The server derives the **authoritative** claims in the same call that sets the bar (prompt `bar` → renamed
  `barAndClaims`, ONLY_IN_CLOUD), using the client's claims as a hint. Typed intentions (no interview) therefore
  still get claims. Stored as `moments/{id}.claims` (server-only).

### 2. Evidence plan (`intention.plan`, server-authoritative `moments/{id}.plan`)

For each claim the **minimum evidence** that would convince a fair skeptic:
```
Requirement = { id: "r1", claimId: "c2", evidence: "video"|"frames"|"gps"|"motion"|"witness",
                ask: string (≤120),                  // "One continuous video of all 50 claps, both hands in frame"
                minSeconds?: number }                // video/motion: minimum continuous length
plan = { requirements: Requirement[] (≤6), recordMode: "video"|"photo", note: string (≤160) }
```
- The interview ends by **showing the plan** ("To get this verified: …") and the record screen starts in
  `recordMode`. A checklist on the record screen ticks requirements off as evidence arrives (video clip of ≥
  minSeconds, ≥1 frame, GPS fixes, motion samples, answered witness request).
- The **witness asks for unmet requirements first** (its prompt gets the plan and what's met).
- The server's `barAndClaims` call also returns the authoritative plan (client plan as a hint, may only add or
  tighten requirements). The server plan is what the seal checks.

### 3. Video in the free baseline

- Every chained `video` clip is **uploaded at submit** (signed in + online), before the client writes
  `status = "submitted"`, to the existing path `clips/{uid}/{momentId}/{sha256}.{ext}` (≤ 200 MB). Guests upload when
  they claim the Moment. Offline: submit waits (the journal/vault already retries).
- The server runs a **free `video_review`** (ONLY_IN_CLOUD, Gemini on Vertex with the `gs://` URI, like
  `moduleFullVideo`) as part of sealing whenever the Moment has a `video` event: re-hash the clip against the chain
  (mismatch → cheating), then judge **each claim** against the whole clip, plus cheating signals (cuts/edits, screen
  re-recording, looped footage, mismatch with sensors/time of day).
  Output: `{ claims: [{id, verdict: "backed"|"not_backed"|"unclear", confidence, reasons[], measured?: {value, unit}}],
  cheating: { detected: boolean, signals: string[] } }`.
- Seal waits while a chained clip hasn't arrived (`status` stays `submitted`, reason "waiting for video upload"); a
  Moment whose clip never arrives seals without it after 24 h (requirements needing video are then unmet).

### 4. Per-claim scores and "minimum evidence + no cheating = Verified"

Server-only `verification.claims`:
```
ClaimScore = { id, p: number, met: string[] /* requirement ids */, unmet: string[], backedBy: string[] /* sources */ }
```
Per claim, in order (deterministic code; the models only give verdicts):
1. Start at the baseline (client scorer probability, clamp01; 0.2 if absent).
2. Sources that back claims: frames judge (`action`, `object`, `outcome`), video review (all kinds it can see,
   incl. `count`), GPS/motion code (`place`, `time`, `measure` of distance, `count` of reps), witness answers.
3. A requirement is **met** when its evidence exists in the chain (and, for video, the review's verdict for that
   claim is `backed` with confidence ≥ 0.6).
4. If **every requirement of the claim is met** and **no cheating is detected** (chain, timing, physics intact;
   skeptic ≠ inconsistent; video review `cheating.detected == false`; clip hash matches): `p = max(p, bar)` —
   the minimum evidence earns the bar.
5. Ladder modules then move `p` per claim (pass `p + s(1−p)`, fail `p(1−s)`), only for claims they back.
6. Cheating detected → every claim `p = min(p, 0.1)` and the Moment is rejected with the signals as the reason.

Moment: `verification.score = min(claim p)`, `verified = every claim p ≥ bar` (and integrity checks). Seal
`version: 4`; `checks.bar` = verified; new `checks.cheating` (true = none detected). v3 Moments keep v3 behaviour.

### 5. Modules back claim kinds

`shared/ladder.json` modules gain `backs: Kind[]` and return per-claim verdicts:
- `second_look` → action, object, outcome · `place_time` → place, time · `witness_review` → whatever the answered
  requests targeted · `count_measure` → count, measure · `full_video` → all kinds (now a deeper second pass
  — stricter model, frame-by-frame count — since the baseline already reviews the clip) · `human_review` (soon).
A module is offered for a claim only if it backs that claim's kind and its evidence exists. `count_measure` uses the
server claims, so "50 claps" is countable even when the person typed the intention.

### 6. UI (all platforms, same words)

- Interview end card: claims as chips + "To get this verified" checklist (the plan) + bar.
- Record screen: starts in the plan's mode, live checklist, witness prompts for unmet items.
- Detail: one row per claim — `clapping ✓ backed by video review` / `50 claps · 0.62 / bar 0.52`, with the
  requirements met/unmet and the modules that can still back that claim (+ previews). Overall verdict on top.
- Feed: unchanged badge; adds "2/2 claims backed".

## Out of scope

Payments, human review, server-side judge for frames (the frames judge stays a client AI Logic call — hybrid
requirement), re-sealing old Moments.
