# Submission checklist

Mirrors `docs/rules/BIBLE.md` §3. Tick only with evidence (a link or a screenshot path).

## Stage One (pass/fail)
- [ ] Devpost platform: Web/Chrome (add Android if shipped)
- [ ] Text description: Firebase AI Logic usage, features, value proposition
- [ ] Repo public: https://github.com/mattrickslauer/linger
- [ ] Apache-2.0 visible in the About section
- [ ] README: setup instructions + value proposition
- [ ] Firebase AI Logic imported and called at runtime (`web/src/firebase.ts`, `web/src/ai/assist.ts`)
- [ ] App Check enabled and enforced for AI Logic
- [ ] Hosted URL live, tested in a clean Chrome profile, with and without Nano
- [ ] Testing instructions: enabling Gemini Nano, mouse mode for judges without a webcam
- [ ] YouTube video public, ≤ 3:00, English, no third-party logos
- [ ] Disclosure: MediaPipe (Apache-2.0), fonts (OFL), AI coding assistance, all code written in the period

## Stage Two levers
- [ ] Implementation: route badge on every answer, offline demo, prefetch shown, Remote Config tuning shown
- [ ] Design: calibration feels calm, lamp motion smooth, mouse mode is a first-class path
- [ ] Impact: a named audience and a real document type in the video
- [ ] Idea: "the app notices you are stuck" is the hook in the first 15 seconds

## Final day
- [ ] `./scripts/fetch_rules.sh` exits 0 (or BIBLE re-checked against the diff)
- [ ] Submitted before Sun 29 Nov
