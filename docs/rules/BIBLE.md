# The Bible — #BuildHybridAI 2026

**The archived pages beside this file are the only authority.** Where anything in our own
documents, plans, or conversations disagrees with them, the archive wins. Every claim
below is traceable to a quoted line in `rules.md` or `overview.md`.

| File | What it is |
|---|---|
| [`rules.md`](rules.md) | Official Rules. The binding document |
| [`overview.md`](overview.md) | Public overview: requirements, prizes, criteria |
| [`resources.md`](resources.md) | Resources tab: docs, Build Session recording, quota accounts |
| [`updates.md`](updates.md) | Organiser announcements |
| `raw/*.html` | Byte-for-byte source, in case an extraction dropped something |

Archived **2026-11-18** from `firebasehybridaihackathon.devpost.com`. Re-fetch with
`./scripts/fetch_rules.sh` (exit 0 = unchanged) weekly and before submission.

---

## 1. Hard dates

| Event | When |
|---|---|
| Submission Period | 11 Nov 2026 13:30 PT → **30 Nov 2026 14:00 PT** |
| Quota account Sprint 3 (final) | request by Wed 25 Nov 10:00 PT, sent Fri 27 Nov |
| Judging Period | 10 Dec 09:00 PT – 16 Dec 14:00 PT |

> "ends at 2:00 P.M. PT on Nov 30, 2026"

**Our internal deadline: Sun 29 Nov.** The hosted URL must keep working through 16 Dec.

## 2. Mandatory stack — Stage One is pass/fail on this

> "Build a Gen AI application using Firebase AI Logic along with supported firebase products such as: AppCheck, RemoteConfig, Firestore and Authentication."

> "Must use at least one of the following platforms: (multi-platform solution is preferred)
> Web (Chrome): Integrating with Gemini Nano 4 via Firebase AI Logic; The build must support Web applications or Chrome extensions"

> "Firebase AI Logic requires App Check; debug tokens are accepted in submissions."

> "as long as your app's AI runs on Firebase AI Logic"

- Generative AI goes through Firebase AI Logic only. Gaze tracking (MediaPipe Tasks Vision, Apache-2.0) is a third-party SDK, allowed under "Third-Party Integrations" ("Entrants must be authorized to use these third-party tools"). Disclose it in the README.
- The repo must "demonstrate the use of Firebase AI Logic at runtime in your code — imported and actually called … not just named in the README."

## 3. Submission checklist (Stage One)

- [ ] Platform selected on the form (Web/Chrome; add Android if we ship it)
- [ ] Text description: how we used Firebase AI Logic, features, value proposition
- [ ] Public GitHub repo with all source, assets and setup instructions; value proposition in README
- [ ] Open-source LICENSE detected in the GitHub About section (Apache-2.0 ✔)
- [ ] YouTube video, public, **≤ 3:00** ("only the first 3 minutes may be evaluated"), English, shows the app running on the platform
- [ ] No third-party logos, trademarks or advertising in the video
- [ ] Hosted URL for judges ("A hosted project is highly encouraged"), free, unrestricted; credentials in testing instructions if gated
- [ ] English UI
- [ ] Disclose pre-existing code ("must disclose any other pre-existing code or work") and summarise what was built in the period

## 4. Judging — Stage Two

> "equally weighted criteria … a score from 1 to 5 per criterion … averaged"

1. **Technological Implementation**: "how effectively does it use Firebase AI Logic hybrid inference as part of the solution?"
2. **Design**: "a complete, coherent product experience, not just a technical proof of concept"
3. **Potential Impact**: "a credible, specific case for solving a real problem for a real audience … based on what's demonstrated"
4. **Quality of the Idea**: "a creative, non-obvious use of Firebase AI Logic … genuine understanding of the problem space"

> "The highest-scoring Submission across all categories will win the Grand Prize. Ties will be broken by comparing scores on each criterion in the order listed"

Tie-break order is Implementation, then Design, so those two get the extra hours.

> "Apps that run across multiple platforms will be given strong consideration for the Grand Prize … An outstanding single-platform app can still win."

## 5. Prizes

Grand $10,000 · 1st runner-up $7,000 · 2nd runner-up $4,000 · Best iOS / Android / Web-Chrome $3,000 each.

## 6. Platform facts (Firebase docs, not the rules; re-verify before relying)

- Web hybrid: `firebase` JS SDK ≥ 12.5.0, `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })`, call `model.initializeDeviceModel()` on a user gesture, read `response.inferenceSource` (`"ON_DEVICE"` | `"IN_CLOUD"`).
- On-device (desktop Chrome ≥ 139, flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`): single-turn text, text + PNG/JPEG, structured output. No chat, tools, PDF or audio.
- The mode is fixed per `GenerativeModel` instance; use separate instances for different routing.
- Default cloud model `gemini-3.5-flash-lite`.
