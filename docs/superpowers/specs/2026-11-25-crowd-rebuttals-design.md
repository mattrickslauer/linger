# Crowd rebuttals → re-verification (v5) — design

Status: draft for owner approval · 2026-11-25 · branch `worktree-rebuttals-spec`
Builds on: `docs/ARCHITECTURE.md` v4 (claims, evidence plan, video review, seal v4). Deadline Mon 30 Nov 14:00 PT.

## Intent

Today, all the doubting in Verified is done by machines: the judge, the Skeptic, the scorer, the video review and
the ladder. People browsing the public feed can only look. This feature lets the community **rebut** a sealed
Moment. Each rebuttal points at a specific piece of evidence and says what's wrong with it. When enough distinct
people have filed rebuttals that pass a screen, the Moment is **re-verified on the server** with those rebuttals as
explicit questions the AI must answer. The re-verification **can revoke the seal**. The Moment then shows
**Overturned**, with the rebuttals that held up. If none hold up, it earns a **Survived a challenge** badge.

Why: proof that strangers can challenge, and that has held up when they did, is stronger than proof only the
machines looked at. It also makes the feed a place where people take part, not just watch. And it adds a new hybrid
AI step for #BuildHybridAI: an on-device model drafts the rebuttal, and cloud models screen it and re-judge.

Owner decisions (2026-11-25):
- Crowd rebuttals that, once enough accumulate, trigger a re-verification that weighs their points.
- A re-verification **can revoke** the seal (Overturned) or confirm it (Survived a challenge).
- Rebuttals are **screened**: an on-device draft helps the rebutter write one, and a server screen decides whether
  it counts (approach B).

## Goals

1. A signed-in non-owner can file a rebuttal on a sealed Moment from its detail page. The rebuttal is anchored to a
   claim and, optionally, a specific frame, clip time or track point.
2. The on-device model (PREFER_ON_DEVICE, with cloud fallback) turns a rough note into a structured rebuttal the
   person reviews before sending.
3. A server screen accepts or refuses each rebuttal. Only accepted rebuttals count toward the threshold.
4. At **3 accepted rebuttals from distinct people**, a server-side re-verification runs once. It answers each
   rebuttal (upheld / dismissed, with a reason) and re-judges each challenged claim.
5. Deterministic code (not the model) decides **Overturned** or **Survived**. Overturned flips the seal off for
   good. Everything is public on the feed and the detail page.
6. Every rebutter has a public record: "rebuttals upheld 4 of 6".

## Non-goals

- An owner reply window or owner counter-evidence before the re-run (option 3, rejected for now).
- Comments, likes, threads or replies. Rebuttals are one-shot and anchored, not a conversation.
- Notifying the owner by push or email. They see it on the detail page and in My Moments.
- Rebuttals on `rejected`, `recording` or `submitted` Moments. Only sealed Moments can be challenged.
- Credits or payment for rebutting. Rebutting is free; the public record is what keeps people honest.
- Moderation tooling or an admin queue. The screen is the only gate.
- Filing rebuttals from iOS or Android in this version (see Platforms).

## Anti-goals (it fails even if it "works")

- **A mob can revoke a seal by volume alone.** The count only *triggers* a review. The rebuttals must be *upheld*
  on the evidence for anything to change.
- **The model decides the outcome.** As everywhere in Verified: AI proposes, code decides.
- **A revoked seal comes back quietly.** No later trigger, ladder run or re-seal can turn an Overturned Moment
  sealed again.
- **Rebuttals that don't point at anything count.** "fake lol" must be refused by the screen.
- **The owner can't see why.** Every upheld rebuttal and its reason are shown.

## Approaches considered

- **A. Simple trigger.** Clients write rebuttals straight to Firestore under rules; a trigger counts and re-runs.
  Least work, follows the seal pattern, but junk rebuttals count toward the trigger and the re-run gets noisy inputs.
- **B. Screened rebuttals with on-device drafting (chosen).** An on-device draft helps the rebutter, a callable
  `submitRebuttal` validates the anchor and runs a cheap cloud screen, and only accepted rebuttals count. More work,
  but it's harder to brigade, gives the re-run cleaner inputs, and adds a visible hybrid AI step.
- C. A manual "request re-verification" button with no rebuttal content. Dropped: it doesn't use the crowd's points,
  which was the whole idea.

## Rules of the game (decided, owner may still adjust)

| Rule | Value | Note |
|---|---|---|
| Who can rebut | signed in, not the owner | guests see a "Sign in to rebut" button |
| Per person | 1 rebuttal per Moment per round | they can't count twice |
| Which Moments | `status == "sealed"` (seal v3 or v4) and not in review | v3 Moments: the intention text is the only claim `c1` |
| Threshold | round 1: **3** distinct accepted; each later round: double the previous (3, 6, 12) | constant `REBUTTAL_THRESHOLD = 3`; my call |
| Later rounds | only people who have not rebutted this Moment in any earlier round | my call |
| Overturned | final for that Moment; no more rebuttals, no ladder runs | the owner can record a new Moment |
| Rate limit | ≤ 10 rebuttal submissions per uid per rolling 24 h (accepted or not) | my call, stops screen-cost abuse |
| Owner delete | unchanged (owner can still delete, including Overturned Moments) | existing owner requirement; tombstone as today |

## How it works

### 1. Filing a rebuttal (client)

On the detail page of a sealed Moment, there's a **Rebut** button under the claims, plus a small "⚑" on every proof
frame, the video player (current time) and the map (tapped point). Each of these opens the rebuttal sheet with that
anchor already filled in.

```
┌ Rebut this Moment ───────────────────────────── on-device ┐
│ Which claim?  [ 50 claps ▾ ]                              │
│ Points at:    frame 14 · 00:00:41          (change)       │
│ What's wrong? ┌───────────────────────────────────────┐   │
│               │ count restarts at 20, he cut the clip │   │
│               └───────────────────────────────────────┘   │
│ [ Tidy it up ]                                            │
│ ── Draft ──────────────────────────────────────────────── │
│ Kind: edited / spliced                                    │
│ "The clap count restarts near 0:41: the clip looks cut    │
│  and rejoined, so 50 continuous claps isn't shown."       │
│                                   [ Edit ]  [ Send ]      │
│ Rebuttals so far: 1 of 3 to re-verify                     │
└───────────────────────────────────────────────────────────┘
```

- **Anchor** = `{ claimId (required), kind: "frame"|"clip"|"track"|"claim", frameSeq?, clipSha?, clipMs?, trackIndex? }`.
  `kind: "claim"` means the whole claim, with no finer pointer.
- **Tidy it up** runs a new client prompt, **`rebuttalDraft`** (PREFER_ON_DEVICE), with the claim, the anchor
  description and the rough note. It returns `{ text (≤240), category, claimId }`, where `category` ∈
  `staged | edited | wrong_object | wrong_count | wrong_place | wrong_time | reused | other`. The person can edit the
  result. Sending without tidying is allowed; the server screen still runs. The sheet shows the usual "on-device" /
  "cloud" chip.

### 2. Screening (`submitRebuttal`, callable, us-central1)

Request: `{ momentId, anchor, text, category, note, draftedOnDevice: boolean }`. Steps, in order. The first one that
fails returns `failed-precondition` with the reason:

1. `unauthenticated` without auth.
2. The Moment exists, `status == "sealed"`, `challenge.status ∉ {reviewing, overturned}` → else `not_challengeable`.
3. Caller ≠ `ownerUid` → else `own_moment`.
4. Caller has not rebutted this Moment in this or any earlier round → else `already_rebutted`.
5. Rate limit → else `rate_limited`.
6. **Anchor is real**: `claimId` is one of the Moment's server claims (v4) or `c1` (v3). `frameSeq` is a frame in
   the chain. `clipSha` is an uploaded clip and `0 ≤ clipMs ≤ durationMs`. `trackIndex` is inside the feed track.
   Else `bad_anchor`.
7. **Screen** with a new server prompt, **`rebuttalScreen`** (ONLY_IN_CLOUD, functions, cheap model, text-only).
   Input: claim, anchor description, rebuttal text, category. Output:
   `{ accepted: boolean, reason (≤120), category }`. It refuses rebuttals that are empty, abusive, point at nothing
   checkable, or don't match the anchor. It does **not** judge whether the rebuttal is true; that's the re-run's job.
   If the screen refuses, nothing is stored except the rate-limit count, and the response returns `screened_out` with
   the reason. A model/infra failure → `unavailable` (nothing stored, the rate limit isn't charged).
8. In a transaction, write the rebuttal doc, increment `challenge.accepted`, and if `accepted ≥ threshold`, set
   `challenge.status = "reviewing"` (the first transaction that crosses the threshold wins).

Response: `{ accepted: boolean, reason, rebuttalId, count, threshold, reviewing: boolean }`.

### 3. Re-verification (server)

Triggered when `challenge.status` becomes `reviewing`, by a Firestore trigger on the Moment that uses the existing
lease pattern (`challengeLeases/{momentId}`, server-only, like `barLeases`), so it runs exactly once per round.

A new server prompt, **`challengeReview`** (ONLY_IN_CLOUD, functions, the same model class as `videoReview`).
Inputs, all taken from data the server trusts:
- intention and server claims (with the per-claim scores as they stand),
- proof frames (≤ 8 via `pickFrames`, **always including every frame a rebuttal anchors to**),
- the uploaded clip(s), when present, using the same video path as `videoReview`; the rebuttals' `clipMs` are listed
  as timestamps to examine,
- chain facts (GPS summary, motion summary, the witness log),
- the earlier AI reasons (judge, skeptic, video review) as "earlier opinions", which must not anchor,
- the round's rebuttals: `[{ id, claimId, anchor, category, text }]`. Rebutter identities are **not** sent.

Output:
```
{ rebuttals: [{ id, verdict: "upheld"|"dismissed"|"unclear", confidence, reason (≤160) }],
  claims:    [{ id, verdict: "backed"|"not_backed"|"unclear", confidence, reasons: string[] (≤2) }],
  cheating:  { detected, signals: string[] (≤4) },
  summary (≤160) }
```

**Deterministic outcome** (reference implementation + vectors in `shared/`, like `scoreV4`):
- A rebuttal **holds** when `verdict == "upheld" && confidence ≥ 0.6`.
- A claim **falls** when it has ≥ 1 holding rebuttal **and** the review's claim verdict for it is
  `not_backed` with `confidence ≥ 0.6`.
- **Overturned** iff any claim falls, **or** `cheating.detected` and ≥ 1 rebuttal holds.
- Otherwise **Survived** (even when some rebuttals were `unclear`).
- Model/infra failure → `challenge.status` **stays `reviewing`** (ladder still paused, no new rebuttals) and
  `challenge.tries` increments. A scheduled function `retryChallenges` (every 30 min, same shape as
  `expireVideoWaits`) re-runs every `reviewing` round whose lease has expired. After 3 failed tries, the round ends
  as `error`: its rebuttals get `verdict: "void"` (not counted in anyone's record), its rebutters may rebut again, and
  `challenge.status` goes back to `open` with the **same** round number and threshold, so the crowd can fill it again.
  UI shows "Re-verification couldn't run · challenge reopened". *(Builder-check call.)*

**Writes, in one transaction:**
- Overturned: `status = "rejected"`, `seal.sealed = false`, `seal.revoked = { at, round, reason }`,
  `seal.reason = "Overturned by challenge: " + X + " · " + <first holding rebuttal reason>`, where X = the first
  fallen claim's text, or, when the overturn comes from cheating alone, `"cheating — " + cheating.signals[0]`
  (`"cheating detected"` if no signal). Fixed in `shared/test-vectors-v5.json`. *(Builder-check call.)*
  `verification.verified = false`. The original checks are kept as they were.
  The status goes to the existing `rejected`, so old app builds show "Not verified" with the reason and don't break
  on an unknown status.
- Survived: nothing in the seal changes. Score and bar are untouched: the challenge is pass/fail, not a scoring
  module.
- Both: the `challenge` record (below), every rebuttal's `verdict/confidence/reason`, each rebutter's record, and the
  feed doc.

**Ladder runs during an open round** (accepted > 0, not yet reviewing) stay allowed, so a single rebutter can't
freeze the owner. If a run drops the Moment to `rejected`, the open round ends as `moot`: its rebuttals get
`verdict: "void"` (not counted in anyone's record) and `challenge.status = "open"`, `accepted = 0`. Rejected Moments
can't be rebutted anyway. If a later run lifts it back to `sealed`, a fresh round starts at the same number and
threshold, and the voided rebutters may rebut again. Losing the seal is never a way to dodge: the owner loses what
was being challenged. *(Builder-check call.)*

**A revoked seal stays revoked:** every code path that computes or writes a seal (`onMomentWritten`,
`onChunkWritten`, `onClipUploaded`, `expireVideoWaits`, `runLadderModule`) must return early, without writing, when
`seal.revoked` is set. `runLadderModule` refuses with `failed-precondition: overturned`, and also with
`in_review` while `challenge.status == "reviewing"`.

## Data model

### `moments/{id}.challenge` (server-only, like `seal`/`verification`)
```
challenge = { round: number (1..), threshold: number, accepted: number /* this round */,
              status: "open"|"reviewing"|"survived"|"overturned",
              tries: number /* failed review attempts this round */,
              rebutters: string[] /* uids, every round, for the one-per-person rule */,
              rounds: [{ round, threshold, outcome: "survived"|"overturned"|"error"|"moot", summary, at,
                         upheld: number, total: number }] }
```
Absent until the first accepted rebuttal. After Survived, the next accepted rebuttal opens round `n+1` with the
threshold doubled.

### `moments/{id}/rebuttals/{rebuttalId}` (read: same as the parent Moment, which is public once sealed; write: Functions only)
```
{ id, round, uid, by: { name, photoURL|null }, anchor, category, text, draftedOnDevice,
  screen: { accepted: true, reason }, createdAtServer,
  verdict: "pending"|"upheld"|"dismissed"|"unclear"|"void", confidence: number|null, reason: string|null }
```
Only accepted rebuttals are stored.

### `rebutters/{uid}` (public read; Functions only)
`{ name, photoURL, submitted, upheld, dismissed, unclear, overturnedMoments }`. Counts go up when a round
resolves, not at submit. "Rebuttals upheld 4 of 6" = `upheld` of `upheld + dismissed + unclear`.

### `feed/{id}` (Function-only) adds
`challenge: { status, round, accepted, threshold, upheld: number|null, summary: string|null } | null`,
and `status: "rejected"` + `sealReason` "Overturned by challenge…" when overturned.

### Rules delta
| Path | Read | Write |
|---|---|---|
| `moments/{id}` | unchanged | **`challenge` joins the server-only fields** (absent on create, never changed by a client) |
| `moments/{id}/rebuttals/*` | as parent Moment | none (Functions) |
| `rebutters/{uid}` | anyone | none (Functions) |
| `challengeLeases/{id}`, `rebuttalRate/{uid}` | none | none (Functions) |

Tests go in `functions/test/rules.test.ts`, plus contract vectors for the outcome math in
`shared/test-vectors-v5.json`.

## Prompts and hybrid map (additions)

| Prompt | Mode | Runs in | Can it verify? |
|---|---|---|---|
| `rebuttalDraft` | PREFER_ON_DEVICE | client (web; Nano or cloud fallback) | no (drafts) |
| `rebuttalScreen` | ONLY_IN_CLOUD | functions | no (gatekeeper: checkable or not) |
| `challengeReview` | ONLY_IN_CLOUD | functions | proposes; code decides |

## UI words (web; same words if mobile picks it up)

- **Detail, sealed Moment**: under the claims: "**Rebut this Moment**" (guests: "Sign in to rebut") and
  "Rebuttals: 1 of 3 to re-verify". A list of the accepted rebuttals: avatar + name, anchor chip ("frame 14",
  "0:41", "map"), category, text, verdict chip once resolved (**Upheld** / **Dismissed** / **Unclear**).
- **In review**: banner "**Being re-verified** · 3 rebuttals". Ladder buttons disabled ("Paused during
  re-verification").
- **Survived**: badge "**Survived a challenge**" (with ×2 for two rounds), plus the review summary.
- **Overturned**: red banner "**Overturned by the community**" + the fallen claims (or the cheating signal) + the
  holding rebuttals. The
  Verified ✓ badge is replaced by "Not verified · overturned".
- **Feed card**: chip "Challenged 1/3" (open, accepted > 0), "Being re-verified", "Survived a challenge", or
  "Overturned".
- **Screen refused** (toast in the sheet): "Not sent: <reason>". `already_rebutted`: "You've already rebutted this
  Moment." `own_moment`: hidden (no button for owners).
- **Rebutter record**: next to the rebutter's name on each rebuttal, "upheld 4 of 6".
- **Owner, My Moments**: the same chip as the feed card.

## Platforms

- **Web**: full flow (file, draft, screen, see outcomes). Judges browse here.
- **Functions**: `submitRebuttal`, the challenge trigger, the guards on existing seal paths, rules, vectors.
- **iOS / Android**: if time allows, **read-only**: render the `challenge` chip/banner on feed cards and the detail
  page, and the rebuttal list. Old builds already degrade correctly: Overturned shows as `rejected` with the reason.

## Demo

The hero Moment should *survive* a challenge, which proves the point. A second, deliberately weak Moment gets
*overturned*. That needs 3 distinct signed-in accounts (household Google accounts through accounts.mattrickslauer.com).
No emulator or seed data on production, per standing instructions. For local dev, an emulator e2e covers both
outcomes using the fake AI engine (`#ai-fail`-style tags in the rebuttal text to force each outcome).

## Constraints

- Functions run in us-central1; server agents go through `functions/src/ai.ts` (Vertex AI) like `videoReview`.
- Clients never get write access to anything a verdict depends on.
- Prompts live in `shared/prompts.json`; the contract is updated in `docs/ARCHITECTURE.md` (new section v5) before
  code.
- Same words on every platform that renders it.

## Left to the builder

- Exact prompt wording, the model choice for the screen (cheapest text model available via `ai.ts`), and token
  limits.
- How `pickFrames` is extended to force-include anchored frames.
- Visual design of the sheet, chips and banners within the existing web styles.
- Whether the re-verification trigger lives in `onMomentWritten` or its own trigger, as long as it runs once per
  round under a lease.
- The anchored-frame cap when more than 8 frames are anchored (prioritise anchored frames, then pickFrames).
- Mapping a tapped map point to a chain GPS fix (the feed track is downsampled).
- Cleaning up `rebutters/{uid}` counts when an owner deletes a Moment (leave counts as-is is acceptable).
- Pagination of the rebuttal list (a round has ≤ 12 by construction, plus earlier rounds).
