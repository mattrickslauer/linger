# Verified — setup (human console steps + commands)

Firebase project: **verified-99e74** (`.firebaserc`). Everything below the line "Local" works with no console
steps at all, against the Emulator Suite.

## Console steps (one-time, needs the project owner)

1. **Firestore** — Console → Build → Firestore Database → *Create database* → **Native mode**, location
   `nam5 (us-central)` (matches the functions' default region `us-central1`), start in *production mode*
   (our `firestore.rules` get deployed over it).
2. **Google sign-in** — Console → Build → Authentication → *Get started* → Sign-in method → **Google** → Enable,
   set the support email. Then Settings → *Authorized domains*: keep `localhost`, add
   `verified-99e74.web.app` and `verified-99e74.firebaseapp.com` (added automatically on first hosting deploy).
   - Android: add the debug + release **SHA-1/SHA-256** of the signing keys to the Android app
     (Project settings → Your apps → `com.mattricks.verified`), then re-download `google-services.json`.
     `cd android && ./gradlew signingReport` prints them.
   - iOS: the `REVERSED_CLIENT_ID` from `GoogleService-Info.plist` must be a URL scheme in the app target
     (re-download the plist after enabling Google sign-in so it contains `CLIENT_ID`).
3. **Upgrade to Blaze** (pay-as-you-go) — required to deploy Cloud Functions (Firestore triggers run on
   Cloud Run + Eventarc). Set a budget alert (e.g. $10). Without Blaze: rules, indexes and hosting still deploy;
   Moments stay `submitted` because nothing seals them.
   On the first `npm run deploy`, accept enabling the APIs it asks for (Cloud Functions, Cloud Build,
   Artifact Registry, Eventarc, Cloud Run, Pub/Sub). If the first deploy fails with an Eventarc service-agent
   permission error, wait 2–5 minutes and deploy again (known first-deploy propagation delay).
4. **Firebase AI Logic** — Console → Build → AI Logic → *Get started* → choose the **Gemini Developer API**
   (works on Spark). The wizard enables the Firebase AI Logic API and the Gemini API the clients call.
5. **Remote Config** (optional) — parameter `cloud_model` = `gemini-3.5-flash` (clients default to it anyway).
6. **App Check** (recommended before going public, optional for the demo)
   - Register providers: Web → reCAPTCHA Enterprise site key; Android → Play Integrity; iOS → App Attest
     (DeviceCheck fallback).
   - Debug tokens for development: run each app once in debug with the App Check debug provider, copy the
     token it logs (`App Check debug token: ...` / web: `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` prints it
     in the console), and add it under App Check → Apps → ⋮ → *Manage debug tokens*.
   - Turn **enforcement on for AI Logic** first (protects the Gemini quota); leave Firestore enforcement off
     until all three clients send tokens.
7. **Deploy** — `npx firebase-tools@15 login`, then `npm run deploy` (rules + indexes + functions + hosting).
   Hosting serves `web/dist` (build the web app first: `npm --prefix web run build`).
8. **Seed production** (optional, after Blaze + deploy) — `gcloud auth application-default login`, then
   `npm run seed:prod`. It writes the 4 demo Moments with the Admin SDK; the deployed function seals them.

## Local (no console steps)

Requirements: Node 22, a JDK **21+** (firebase-tools 15 refuses Java 17; `infra/fb.sh` picks
`/usr/lib/jvm/java-21+` automatically when the default `java` is older).

```bash
npm run setup          # installs functions/ deps
npm test               # unit + rules + e2e (all below)
npm run test:unit      # seal unit tests against shared/test-vectors.json
npm run test:rules     # 17 security-rules tests on a throwaway firestore emulator
npm run test:e2e       # boots firestore+functions emulators, seeds 4 Moments, waits for the seal, prints the feed
                       # last line: counts: moments 4 {"sealed":3,"rejected":1} · feed 4 (sealed 3, rejected 1)
npm run emulators      # auth 9099 · firestore 8080 · functions 5001 · hosting 5000 · UI http://127.0.0.1:4000
npm run seed           # (in another terminal, emulators running) writes the 4 demo Moments; function seals them
npm run feed           # print the public feed + counts from the emulator
```

Hosting emulator serves `web/dist`: run `npm --prefix web run build` first to see the app on :5000
(or use the Vite dev server pointed at the emulators).

Emulator mode for clients: connect Auth to `127.0.0.1:9099`, Firestore to `127.0.0.1:8080`
(Android emulator: `10.0.2.2`), project id `verified-99e74`. Google sign-in against the Auth emulator shows the
emulator's fake account picker.

## What the backend does

- `functions/src/seal.ts` — pure, deterministic seal (chain, timing, physics, frames, ai) + feed summary/track.
- `functions/src/index.ts` — `onMomentWritten` (moments/{id}) and `onChunkWritten` (moments/{id}/chunks/{seq})
  both call the idempotent `trySeal(id)`: it no-ops unless `status == "submitted" && judge && skeptic && !seal`
  and every chunk has arrived, then in one transaction writes `seal`, `status` and `feed/{id}`.
- `feed/{id}.track` is an array of `{lat, lng}` maps (≤200 points). Firestore cannot store nested arrays, so the
  contract's `[[lat,lng], ...]` is not representable; clients read `p.lat` / `p.lng`.
  `feed/{id}` also carries `skepticReasons: string[]` (additive).
- `firestore.rules` — contract in `docs/ARCHITECTURE.md`; tests in `functions/test/rules.test.ts`.
