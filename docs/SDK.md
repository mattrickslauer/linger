# Embed Verified into your app — SDK plan

Status: **coming soon / planning in public.** Public page: [`/embed`](https://verified-99e74.web.app/embed)
(`web/src/pages/Embed.tsx`). Keep the page and this file in step; this file is the plan of record.

Nothing here is built yet. Names (`@verified/web`, `VerifiedKit`, `verified-android`, `@verified/core`) are
working titles.

## Goal

Let another app give its users a "prove it" button: record a Moment inside the host app, get it sealed by the
same Cloud Function that seals Moments today, and tell the host's server the result. The host decides what a seal
means (prize, badge, payout, rank). Verified stays the neutral party that holds the chain and writes the seal.

## Non-negotiables (carried over from `ARCHITECTURE.md`)

1. **AI proposes, code decides.** No client, ours or the host's, writes `seal`, `verification.score` or `feed/*`.
2. **The chain binds the Moment id, never an owner.** The host's user id is an opaque `externalUserId` label.
3. **Templates may raise the bar, never lower it.** A host can require evidence or a higher minimum score; it
   cannot disable seal checks (chain, timing, physics, frame hashes, AI reads).
4. **Paying buys scrutiny, never a score.** Ladder checks billed to a host cost the same pass or fail.
5. **On-device first for the coach.** Firebase AI Logic hybrid, same as the apps.

## Three layers

| # | Layer | Surface | Built from |
|---|---|---|---|
| 1 | Badge & verify | `<verified-badge moment="…">` web component, oEmbed for `/m/{id}`, `GET /v1/moments/{id}` (signed JSON) | `feed/{momentId}` is already public and Function-written; this is a read API over it |
| 2 | Drop-in capture | `@verified/web` (popup/redirect, like a hosted checkout), `VerifiedKit` Swift Package, `verified-android` AAR; one `capture()` call returns a `momentId` | Existing flows: `web/src/pages/Record.tsx` + `components/Interview.tsx`, `ios/`, `android/app` |
| 3 | Headless core | `@verified/core`: chain builder, sensor recorder, raw vault, hybrid coach as plain APIs; host draws the UI | `web/src/chain.ts`, `recorder.ts`, `vault.ts`, `ai.ts`, `witness.ts` (and native equivalents) |

Layer 1 needs no capture on the host side, so it can ship first and is useful alone (a derby site that just needs
to check a link a contestant pasted).

## Planned API (draft)

```ts
const verified = Verified.init({ appId: "app_…" });
const { momentId } = await verified.capture({
  intention: "Catch and release a largemouth bass, 4 lb or more",
  template: "bass-derby-2027",
  externalUserId: user.id,
});
```

Webhook to the host (HMAC-signed, `Verified-Signature: t=…,v1=…`), events `moment.sealed`, `moment.rejected`,
`moment.ladder`:

```json
{ "type": "moment.sealed", "momentId": "…", "externalUserId": "u_829", "template": "bass-derby-2027",
  "score": 0.91, "bar": 0.80, "verified": true, "url": "https://verified-99e74.web.app/m/…" }
```

The client result is only a receipt. Hosts must act on the webhook (or the verify endpoint), never on the client.

## Backend changes this needs

- **Apps:** `apps/{appId}` (server-only): name, owner, allowed web origins, iOS bundle ids, Android package + SHA,
  webhook URL + secret, default template, billing. App Check on every SDK call; origin/bundle checked in Functions.
- **Moments:** add `appId`, `externalUserId`, `templateId` at create (rules: immutable after create, `appId` must
  match the App Check app). Chain format unchanged.
- **Templates:** `apps/{appId}/templates/{id}`: required evidence (witness requests, quantities, video), minimum
  bar (`max(templateBar, aiBar)`), time window, optional geofence. The seal function reads it; it only adds checks.
- **Identity:** default is anonymous Firebase Auth inside the SDK, keyed to `externalUserId`; optional custom tokens
  minted by the host's server for hosts that want one identity. A user does not need a Verified account.
- **Webhooks:** a Firestore-triggered function on seal/ladder writes enqueues deliveries (retries, backoff,
  delivery log per app).
- **Feed visibility:** per template: `public` (in the Verified feed), `unlisted` (link only), `private` (host only).
- **Dashboard:** minimal console page per app: keys, origins, templates, webhook log, usage.

## Stages

| Stage | Ships | Exit check |
|---|---|---|
| Now | `/embed` page, this doc, 3–5 design partners | Partners agree on layer 1 + 2 shapes |
| 1 | Badge, oEmbed, verify endpoint | A partner site shows live seals and verifies ids server-side |
| 2 | `@verified/web` drop-in, apps/keys, webhooks, dashboard | A partner runs a real contest end to end on web |
| 3 | `VerifiedKit` + `verified-android` drop-ins | Same contest on phones, offline capture at the lake still seals |
| 4 | `@verified/core`, templates GA | A partner ships their own capture UI on the core |

Extraction note for stage 2/4: the web code is already split along the right seams (`chain.ts`, `recorder.ts`,
`vault.ts` hold no UI). Move them into a `packages/core` workspace first, have `web/` import it, then publish.

## Open questions (to settle with partners)

1. Evidence storage: our project, or a host-owned bucket with read access granted to us?
2. Default feed visibility for embedded Moments.
3. Anonymous auth vs host custom tokens as the default identity.
4. Pricing unit: per sealed Moment, per ladder check, or monthly tier. Who pays for the free review?
5. Template expressiveness: weight, distance, count, time window, geofence, required witness prompts — what else?
6. Webview hosts (React Native, Flutter): wrap the native SDKs or ship a web-only path first?

## How to join

Open an issue with the "Design partner" template linked from `/embed`
(<https://github.com/mattrickslauer/linger/issues/new?labels=sdk>).
