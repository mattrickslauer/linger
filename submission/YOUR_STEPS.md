# What only you can do

Everything else is built and tested (`cd web && npm test && npm run test:e2e`, 30/30 end-to-end checks). These steps need your accounts, your face or your voice. In order, with the time each takes.

## Today (about 45 minutes)

1. **Log in to the CLIs** (2 min). In your own terminal:
   ```bash
   cd ~/Code/firebase-hackathon/.claude/worktrees/gaze-reader
   npx --prefix web firebase login
   gcloud auth login            # same Google account
   ```
2. **Run the setup script** (5 min): `./infra/setup-firebase.sh linger-reader` (any free project id). It creates the project, web app, APIs, reCAPTCHA key, App Check debug token and the `.env` files.
3. **Two console clicks** the script prints at the end (5 min): AI Logic → Get started → Gemini Developer API; App Check → register the web app with the printed reCAPTCHA key.
4. **Turn on Gemini Nano in your Chrome** (10 min, mostly download): Chrome 139+ desktop → `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled → restart; check `chrome://settings/ai` is on. In DevTools: `await LanguageModel.availability()` should say `available` (or `downloadable`; Linger starts the download on first click).
5. **Real-world test** (15 min): `cd web && npm run dev`, open http://localhost:5173 in that Chrome.
   - Mouse mode on the benefits letter: settle on a paragraph, move on, come back. The note should say **"Prepared on this device before you needed it"**. If it says "in the cloud", Nano isn't active.
   - Eye mode: calibrate in good light. Write down the accuracy number in the top bar. **Under ~150 px = we're good. Over 200 px = tell me**, and I'll tune features and calibration before anything else.
   - Turn Wi-Fi off mid-reading and ask about a paragraph and the chart: both should still answer on this device.
6. **Tell me what broke.** Paste the accuracy number, anything odd, and a screenshot if you can.

## By Sat 21 Nov

7. **Deploy** (2 min): `cd web && npm run build && cd .. && npx --prefix web firebase deploy --only hosting,remoteconfig`. Test the `.web.app` URL in a clean Chrome profile.
8. **Enforce App Check** for AI Logic in the console once the hosted URL works.
9. **Decide on Android** (my recommendation: yes, a small companion if steps 1–8 are green by Sat). Multi-platform is "preferred" for the Grand Prize and only a handful of entries have it. I need: do you have an Android phone that supports Gemini Nano (recent Pixel or Galaxy S-series), and is Android Studio installed?

## By Wed 25 Nov

10. **Find one real reader** (optional, high value for Impact): someone with dyslexia, low vision or reading in a second language. Let them read the benefits letter with Linger for five minutes; ask permission to quote one sentence (first name or none). Real feedback beats any claim we can write.

## Thu 26 – Sat 28 Nov

11. **Record the video** from `submission/VIDEO_SCRIPT.md` (I'll have the shot list ready). You need: a screen recorder, your webcam visible in a corner for the eye-tracking shots, a quiet room. Upload to YouTube as **Public**, English captions on.
12. **Register on Devpost** (if not already), create the project, paste `submission/DEVPOST.md`, add the repo, hosted URL and video. Select platform **Web/Chrome** (+ Android if built).
13. **Mark PR #1 ready and merge** to `main` (or tell me to): https://github.com/mattrickslauer/linger/pull/1

## Sun 29 Nov (our deadline, one day before the real one)

14. `./scripts/fetch_rules.sh`: exit 0 means the rules are unchanged. Then **Submit**.
