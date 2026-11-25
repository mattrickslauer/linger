# Crowd Rebuttals (v5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in non-owners file screened, anchored rebuttals on sealed Moments; 3 accepted rebuttals trigger one
server re-verification whose deterministic outcome either revokes the seal (Overturned) or confirms it (Survived).

**Architecture:** Pure logic in `functions/src/challenge.ts` (validation, anchors, outcome math, reason text, round
transitions), model calls in `functions/src/challengeAgents.ts`, wiring in `functions/src/index.ts`
(`submitRebuttal` callable, challenge branch in `onMomentWritten` under a lease, `retryChallenges` scheduler, ladder
guards). Web adds `web/src/rebuttal.ts` + `RebutSheet`/`Rebuttals` components on the detail page and feed chips.

**Tech Stack:** Firebase Functions v2 (TS, vitest), Firestore rules (rules-unit-testing), React + Vite web, Gemini
via `functions/src/ai.ts` (fake engine in emulators), Firebase AI Logic on web (`askJson`).

**Spec:** `docs/superpowers/specs/2026-11-25-crowd-rebuttals-design.md`

## Global Constraints

- `REBUTTAL_THRESHOLD = 3`; later rounds double the previous threshold (3, 6, 12).
- One rebuttal per uid per Moment across all rounds (except voided rounds: those rebutters may rebut again).
- Rate limit: ≤ 10 submissions per uid per rolling 24 h; refused-by-screen counts, `unavailable` does not.
- Rebuttal holds: `verdict == "upheld" && confidence ≥ 0.6`. Claim falls: ≥ 1 holding rebuttal on it AND review claim
  verdict `not_backed` with confidence ≥ 0.6. Overturned iff any claim falls OR (`cheating.detected` AND ≥ 1 holds).
- Seal reason: `"Overturned by challenge: " + X + " · " + <first holding rebuttal reason>`; X = first fallen claim
  text, else `"cheating — " + signals[0]` (`"cheating detected"` if none).
- Overturn writes `status = "rejected"`, `seal.sealed = false`, `seal.revoked`, `verification.verified = false`.
- `rebuttal text ≤ 240`, `screen reason ≤ 120`, `review reason ≤ 160`, `summary ≤ 160`.
- Max 3 review tries per round, then the round ends `error` and reopens (same round number + threshold).
- Categories: `staged | edited | wrong_object | wrong_count | wrong_place | wrong_time | reused | other`.
- AI proposes, code decides. Clients never write `challenge`, rebuttals or rebutter records.
- No seed/demo data on production; deploy = rules + functions + hosting to `verified-99e74`.

## Review Focus

1. Two rebutters crossing the threshold at the same instant → exactly one review runs (transaction + lease).
2. Owner runs a ladder module while a round is open and it drops the seal → round becomes moot, rebuttals void.
3. A rebuttal anchored to a frame seq / clip / track index that doesn't exist → `bad_anchor`, nothing stored.
4. Model failure mid-review → status stays `reviewing`, `tries` increments, after 3 → `error` round + reopen.
5. Overturned Moment: ladder refuses (`overturned`), `submitRebuttal` refuses (`not_challengeable`), seal never returns.

---

### Task 1: Contract — prompts, outcome vectors, ARCHITECTURE v5

**Files:**
- Modify: `shared/prompts.json` (add `rebuttalDraft` PREFER_ON_DEVICE/client, `rebuttalScreen` + `challengeReview` ONLY_IN_CLOUD/functions; schemas per spec)
- Create: `shared/make-test-vectors-v5.mjs`, `shared/test-vectors-v5.json` (`outcome[]` cases: upheld+not_backed → overturned; upheld+backed → survived; low-confidence upheld → survived; cheating+1 holding → overturned with cheating reason; cheating+0 holding → survived; unclear only → survived; holding rebuttal on claim c2 but c1 not_backed → survived)
- Modify: `docs/ARCHITECTURE.md` (new `## v5 — crowd rebuttals` section summarising the spec; hybrid-map rows)
- Modify: `functions/scripts/copy-shared.mjs` (no change needed: prompts.json already copied — verify)

- [ ] Write prompts, vector generator (reference `challengeOutcome` inlined), generate JSON, commit.

### Task 2: `functions/src/challenge.ts` pure logic + tests

**Interfaces (Produces):**
- `type RebuttalCategory`, `interface Anchor { claimId; kind: "frame"|"clip"|"track"|"claim"; frameSeq?; clipSha?; clipMs?; trackIndex? }`
- `interface ChallengeDoc { round; threshold; accepted; status: "open"|"reviewing"|"survived"|"overturned"; tries; rebutters: string[]; rounds: RoundRecord[] }`
- `validateRebuttalRequest(data: unknown): { momentId, anchor, text, category, note, draftedOnDevice }` (throws `fail("invalid-argument","bad_request")`)
- `anchorProblem(anchor, claimIds: string[], facts: ChainFacts, clips: {sha256, durationMs, uploaded}[], trackLen: number): string | null`
- `challengeableWhy(m: MomentDoc, uid: string): string | null` → `not_challengeable | own_moment | already_rebutted`
- `challengeOutcome(input: { rebuttals: {id, claimId}[]; review: ReviewAnswer; claims: {id, text}[] }): { outcome: "overturned"|"survived"; fallen: string[]; holding: string[]; reason: string | null }`
- `nextThreshold(round: number): number` (3·2^(round−1)); `openNextRound(c: ChallengeDoc)`, `voidRound(c, outcome: "error"|"moot")`
- `REBUTTAL_THRESHOLD = 3`, `MAX_REBUTTALS_PER_DAY = 10`, `MAX_CHALLENGE_TRIES = 3`, `CHALLENGE_LEASE_MS = 300_000`

- [ ] Test `functions/test/challenge.test.ts`: every `test-vectors-v5.json` outcome case; anchor checks (bad claim, missing frame seq, clipMs > duration, trackIndex ≥ len, `claim` kind ok); challengeableWhy (rejected → not_challengeable, owner → own_moment, uid in rebutters → already_rebutted, reviewing/overturned → not_challengeable); thresholds 3/6/12; voidRound clears rebutters of that round and resets accepted.
- [ ] Implement, add the test file to `functions` `test` script, run `npm test` → PASS, commit.

### Task 3: `functions/src/challengeAgents.ts` model calls

**Interfaces (Produces):** `runScreen(ctx): Promise<{accepted, reason, category, model}>`,
`runChallengeReview(ctx: { moment, facts, claims, rebuttals, clips: (ReviewClip & {gsUri})[] }): Promise<ReviewAnswer & {model}>`.
Frames: anchored frames first, then `pickFrames` fill, total ≤ 8. Fake engine: screen refuses text with < 12 chars or
containing `#screen-refuse`; review upholds rebuttals whose text contains `#rebut-hold` (confidence 0.85) and marks
their claim `not_backed` 0.85, else dismissed/backed; `#ai-fail` throws (existing behaviour).
- [ ] Tests in `challenge.test.ts` with injected engines (coercion: unknown ids dropped, confidence clamped, reasons trimmed). Implement. PASS. Commit.

### Task 4: Functions wiring in `index.ts`

- `submitRebuttal` (onCall): steps 1–8 of the spec in order; rate doc `rebuttalRate/{uid}` (`times: number[]`); rebuttal doc id = auto; transaction re-checks `challengeableWhy` and writes rebuttal + `challenge` (creates round 1 / opens next round after survived) + `reviewing` on crossing; response `{accepted, reason, rebuttalId, count, threshold, reviewing}`; also merges `feed/{id}.challenge`.
- `onMomentWritten`: before the existing guard, if `after.challenge?.status === "reviewing"` → `runChallenge(id)`.
- `runChallenge(id)`: `takeLease("challengeLeases")`; load round rebuttals, chunks, clips (uploaded + hashOk from `videoReview.clips`); call review; on failure increment `tries` (≥3 → `voidRound(c,"error")`, rebuttals `void`); on success apply outcome in one transaction (seal/verification/status on overturn, rebuttal verdicts, `rebutters/{uid}` increments, `rounds[]`, feed `challenge` + status/sealReason).
- `retryChallenges` (onSchedule every 30 min): `where("challenge.status","==","reviewing")` → `runChallenge`.
- `eligibility()` in `callable.ts`: `seal.revoked` → `overturned`; `challenge.status == "reviewing"` → `in_review`.
- Ladder record paths (v3 + v4): if new status is `rejected` and challenge is `open` with `accepted > 0` → `voidRound(c,"moot")` in the same transaction (+ rebuttal docs `void` after commit); if lifted back to `sealed` nothing else needed (voided rebutters were removed from `rebutters`).
- `onMomentDeleted`: recursive delete `rebuttals`, drop `challengeLeases`.
- Export new functions; `npm run build` clean.
- [ ] Unit-test `eligibility` additions in `functions/test/ladder.test.ts`. Build + `npm test` PASS. Commit.

### Task 5: Rules

- `moments`: add `challenge` to `serverOnlyKeys()` and `serverFieldsUnsetOnCreate()`.
- `moments/{id}/rebuttals/{rid}`: read = parent public or owner; write false.
- `rebutters/{uid}`: read true; write false. (`challengeLeases`, `rebuttalRate`: no match → denied.)
- [ ] Tests in `functions/test/rules.test.ts`: client can't create Moment with `challenge`; anyone reads a sealed Moment's rebuttals; nobody writes rebuttals/rebutters; guest reads rebutters. `npm run test:rules` PASS. Commit.

### Task 6: Emulator end-to-end check

- Create `functions/scripts/challenge-check.mjs`: against emulators (fake AI), seeds a sealed v4 Moment (Admin SDK),
  calls `submitRebuttal` as 3 users with `#rebut-hold` texts → expects `rejected` + `seal.revoked` + feed
  "Overturned…"; second Moment with plain texts → `survived`, round 2 threshold 6; owner → `own_moment`; repeat →
  `already_rebutted`; `#screen-refuse` → `screened_out`; ladder on overturned → `overturned`.
- [ ] Run under `firebase emulators:exec --only firestore,functions,auth,storage`. PASS. Commit.

### Task 7: Web

**Files:** `web/src/types.ts` (ChallengeView, Rebuttal, feed `challenge`), `web/src/rebuttal.ts`
(`draftRebuttal(...)` via `askJson("rebuttalDraft")`, `submitRebuttal(...)` callable, `challengeChip(feedChallenge)`,
`reasonText` for `own_moment|already_rebutted|rate_limited|bad_anchor|screened_out|not_challengeable`),
`web/src/components/RebutSheet.tsx`, `web/src/components/Rebuttals.tsx`, `web/src/data.ts` (live rebuttals + rebutter
records), `web/src/pages/Detail.tsx` (section under claims, ⚑ on frame caption / map / clip time, banners, ladder
paused/overturned), `web/src/pages/Feed.tsx` + `Me.tsx` (chip), `web/src/fixtures.ts` (one challenged fixture),
`web/src/rebuttal.test.ts` (chip text per status; reason texts).
- Words exactly as spec "UI words".
- [ ] Test, implement, `npm test` + `npm run build` PASS, screenshot via fixtures dev server. Commit.

### Task 8: Review, merge, deploy

- [ ] Whole-branch review by a fresh reviewer; fix real findings.
- [ ] Merge to main (user asked for deploy; repo convention: feature branch merged to main), push.
- [ ] Deploy: `firebase deploy --only firestore:rules,functions,hosting` (web built with `config/web.env.production` copied to `web/.env.production.local`). Verify live: feed loads, a sealed Moment's detail shows "Rebut this Moment", `submitRebuttal` returns `unauthenticated` for guests.
