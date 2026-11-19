# #BuildHybridAI 2026 entry: Linger

Firebase #BuildHybridAI hackathon (Devpost). **Deadline: Mon 30 Nov 2026, 14:00 PT. Our internal deadline is Sun 29 Nov.** Judging 10–16 Dec; the hosted URL must work through then.

## Sources of truth
- `docs/rules/BIBLE.md`: every requirement, quoted from the archived rules. The archive in `docs/rules/*.md` beats anything else, including this file.
- `./scripts/fetch_rules.sh`: re-fetches the Devpost pages and diffs them against the archive (exit 0 = unchanged). Run it weekly and before submitting.
- `STRATEGY.md` and `docs/winners/` are **git-ignored and must never be committed or quoted in public material**.

## Non-negotiables (from the rules)
- All generative AI goes through **Firebase AI Logic**, imported and called at runtime. Hybrid inference (on-device Gemini Nano + cloud) must be visible in the product.
- **App Check** is on (debug token accepted for judging).
- Public repo, Apache-2.0 detected in the GitHub About section, setup instructions in README.
- Video **≤ 3:00**, public on YouTube, English, shows the app running. No third-party logos.
- Hosted URL, free, no restriction. English UI.
- Never claim anything in the README, Devpost text or video that the app doesn't do.
- Multi-platform is "preferred" for the Grand Prize; Web/Chrome is our primary platform.

## Working method
- Docs first: pitch in README, then video script, then build to the script.
- **`docs/ARCHITECTURE.md` is the single canonical doc for architecture.** Update its "As built" section in the same commit as the code change.
- One worktree and branch per feature, merged into `main`.
- The submission kit lives in `submission/` and is kept current throughout, not written at the end.
- Before using a Firebase AI Logic API, check the installed types in `web/node_modules/@firebase/ai/dist/ai-public.d.ts`; the docs lag the SDK (e.g. `InferenceSource` values are lowercase `on_device`/`in_cloud`, parts need `type: "inlineData"`).

## Commands
- `cd web && npm run dev` (also syncs MediaPipe assets), `npm test`, `npm run build`
- Deploy: `cd web && npm run build && cd .. && npx --prefix web firebase deploy --only hosting,remoteconfig`
