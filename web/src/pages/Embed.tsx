// /embed: "Embed Verified into your app". A public, coming-soon page that lays out the SDK plan in the open,
// so partners can push on it before anything ships. The plan of record is docs/SDK.md; keep the two in step.
import { useState } from "react";
import { Link } from "../ui";

const REPO = "https://github.com/mattrickslauer/linger";
const PARTNER_URL =
  `${REPO}/issues/new?` +
  new URLSearchParams({
    title: "Design partner: Embed Verified into <your app>",
    labels: "sdk",
    body: [
      "**What your app does:**",
      "",
      "**What users would prove (a catch, a workout, a delivery, ...):**",
      "",
      "**Platforms you ship on (web / iOS / Android / other):**",
      "",
      "**What happens when a Moment is sealed (prize, badge, payout, ...):**",
      "",
      "**Anything in the plan you'd change:**",
    ].join("\n"),
  }).toString();

type Layer = { n: string; name: string; pkg: string; what: string; who: string };
const LAYERS: Layer[] = [
  {
    n: "1",
    name: "Badge & verify",
    pkg: "<verified-badge> · GET /v1/moments/{id}",
    what: "Show a sealed Moment inside your app, and check any Moment id server-side: status, score, bar, every seal check and ladder result.",
    who: "Anyone. No recording on your side; your users record in Verified and paste the link.",
  },
  {
    n: "2",
    name: "Drop-in capture",
    pkg: "@verified/web · VerifiedKit (Swift) · verified-android",
    what: "One call opens the full Verified flow (interview, live recording, on-device coach, witness, upload) on top of your app and hands back a Moment id.",
    who: "Apps that want proof without building any capture UI. Closest to a hosted checkout.",
  },
  {
    n: "3",
    name: "Headless core",
    pkg: "@verified/core",
    what: "The hash chain, sensor recorder, raw vault and hybrid coach as plain APIs. You draw every pixel; the chain and the seal rules stay ours.",
    who: "Apps with their own camera or tracking screens (fitness trackers, fishing logbooks).",
  },
];

const SNIPPETS = {
  web: {
    label: "Web",
    code: `import { Verified } from "@verified/web";

const verified = Verified.init({ appId: "app_…" });

const { momentId } = await verified.capture({
  // what the user will prove; they can still edit it in the interview
  intention: "Catch and release a largemouth bass, 4 lb or more",
  template: "bass-derby-2027",   // your rules: evidence, min bar
  externalUserId: user.id,       // opaque to us, echoed in webhooks
});
// The seal arrives later, by webhook. Never trust the client for it.`,
  },
  ios: {
    label: "iOS",
    code: `import VerifiedKit

let verified = Verified(appId: "app_…")

let moment = try await verified.capture(
  intention: "10 km run under 50 minutes",
  template: "spring-10k",
  externalUserId: user.id,
  presentingFrom: self
)
print(moment.id)  // sealed result comes by webhook`,
  },
  android: {
    label: "Android",
    code: `val verified = Verified(context, appId = "app_…")

val launcher = registerForActivityResult(verified.captureContract()) { r ->
  r?.momentId?.let(::onSubmitted)   // seal comes by webhook
}

launcher.launch(
  CaptureRequest(
    intention = "Summit Mount Washington",
    template = "peak-bagger",
    externalUserId = user.id,
  )
)`,
  },
  server: {
    label: "Webhook",
    code: `POST https://your-app.example/hooks/verified
Verified-Signature: t=…,v1=…   // HMAC, check before trusting

{
  "type": "moment.sealed",          // or "moment.rejected", "moment.ladder"
  "momentId": "3f1c…",
  "externalUserId": "u_829",
  "template": "bass-derby-2027",
  "score": 0.91, "bar": 0.80, "verified": true,
  "url": "https://verified-99e74.web.app/m/3f1c…"
}`,
  },
} as const;
type SnippetKey = keyof typeof SNIPPETS;

const STAGES = [
  { tag: "Now", title: "Plan in the open", body: "This page and docs/SDK.md. We pick three to five design partners and shape the API with them." },
  { tag: "Stage 1", title: "Badge & verify API", body: "Read-only. Public Moments are already public; this adds an embeddable badge, oEmbed and a signed verify endpoint." },
  { tag: "Stage 2", title: "Web drop-in", body: "Hosted capture in a popup or redirect, per-app keys, origin allowlist, App Check, webhooks, a small dashboard." },
  { tag: "Stage 3", title: "iOS & Android drop-in", body: "Swift Package and Android library wrapping the existing native flows, with the same on-device coach." },
  { tag: "Stage 4", title: "Headless core & templates", body: "@verified/core for custom UIs, and challenge templates so you set the evidence and the minimum bar." },
];

const RULES = [
  ["AI proposes, code decides.", "Your app never writes a score or a seal. Neither does ours. Only the sealing Cloud Function does, exactly as today."],
  ["The chain binds the Moment, not the user.", "Your user id rides along as an opaque label. A Moment can move between accounts without changing a hash."],
  ["You can raise the bar, never lower it.", "A template can demand more evidence or a higher minimum score. It cannot switch checks off."],
  ["Paying buys scrutiny, never a score.", "Ladder checks billed to your app cost the same whether they pass or fail."],
  ["The image stays on the phone for the coach.", "On-device first through Firebase AI Logic; the cloud is a fallback, and only the final review uploads evidence."],
];

const QUESTIONS = [
  "Where should evidence live: our Firebase project, or a bucket you own and grant us read access to?",
  "Should sealed Moments from your app appear in the public Verified feed, stay unlisted, or be your choice per template?",
  "Does your user need a Verified account at all, or is your sign-in enough (custom tokens)?",
  "Pricing: per sealed Moment, per ladder check, or a flat monthly tier?",
  "What else must a template express? Weight, distance, count, time window, place fence, required witness requests?",
];

export default function Embed() {
  const [tab, setTab] = useState<SnippetKey>("web");
  return (
    <div className="page embed">
      <section className="embed-hero" aria-labelledby="embed-h">
        <p className="embed-kicker">
          <span className="chip chip-warn">Coming soon</span>
          <span className="muted small">SDK plan, written in public</span>
        </p>
        <h1 id="embed-h">Embed Verified into your app.</h1>
        <p className="lede">
          Your users already say “trust me, it happened.” Give them a button that records it, chains it and gets it sealed, without
          leaving your app. Fishing derbies, fitness challenges, outdoor badges, bounties: anywhere a payout or a ranking hangs on a
          photo.
        </p>
        <div className="embed-cta">
          <a className="btn btn-primary" href={PARTNER_URL} target="_blank" rel="noopener noreferrer">
            Become a design partner
          </a>
          <a className="btn btn-quiet" href={`${REPO}/blob/main/docs/SDK.md`} target="_blank" rel="noopener noreferrer">
            Read the full plan
          </a>
        </div>
        <p className="muted small">Nothing here is installable yet. Names and shapes below are the proposal we want to argue about with you.</p>
      </section>

      <section className="embed-sec" aria-labelledby="layers-h">
        <h2 id="layers-h">Three ways in, from lightest to deepest</h2>
        <ol className="embed-layers">
          {LAYERS.map((l) => (
            <li key={l.n} className="embed-layer">
              <span className="embed-num" aria-hidden="true">
                {l.n}
              </span>
              <div>
                <h3>{l.name}</h3>
                <p className="mono embed-pkg">{l.pkg}</p>
                <p>{l.what}</p>
                <p className="muted small">For: {l.who}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="embed-sec" aria-labelledby="code-h">
        <h2 id="code-h">What it could look like</h2>
        <p className="muted">Planned API. It will change once partners use it.</p>
        <div className="embed-tabs" role="tablist" aria-label="Platform">
          {(Object.keys(SNIPPETS) as SnippetKey[]).map((k) => (
            <button
              key={k}
              role="tab"
              id={`tab-${k}`}
              aria-selected={tab === k}
              aria-controls="embed-code"
              className={tab === k ? "on" : ""}
              onClick={() => setTab(k)}
            >
              {SNIPPETS[k].label}
            </button>
          ))}
        </div>
        <pre id="embed-code" className="embed-code" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
          <code>{SNIPPETS[tab].code}</code>
        </pre>
      </section>

      <section className="embed-sec" aria-labelledby="flow-h">
        <h2 id="flow-h">What happens between your app and the seal</h2>
        <ol className="embed-flow">
          <li>
            <b>Your app</b> calls <span className="mono">capture()</span> with an intention and, optionally, a template.
          </li>
          <li>
            <b>The SDK</b> runs the interview, records GPS, motion and proof shots, and chains every 5 s chunk with SHA-256. The coach
            runs on the device.
          </li>
          <li>
            <b>Firestore</b> syncs it, offline-first. Nothing is lost at a lake with no signal.
          </li>
          <li>
            <b>Cloud Functions</b> recompute the chain, physics and timing, read the judge, skeptic and scorer, apply the bar and
            write the seal.
          </li>
          <li>
            <b>Your server</b> gets a signed webhook and decides what a seal means for you: a prize, a badge, a payout.
          </li>
        </ol>
      </section>

      <section className="embed-sec" aria-labelledby="rules-h">
        <h2 id="rules-h">What does not change when you embed it</h2>
        <dl className="embed-rules">
          {RULES.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="embed-sec" aria-labelledby="stages-h">
        <h2 id="stages-h">How we get there</h2>
        <ol className="embed-stages">
          {STAGES.map((s, i) => (
            <li key={s.tag} className={i === 0 ? "now" : ""}>
              <span className="chip">{s.tag}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="embed-sec" aria-labelledby="q-h">
        <h2 id="q-h">Open questions we want to answer with you</h2>
        <ul className="embed-q">
          {QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
        <div className="embed-cta">
          <a className="btn btn-primary" href={PARTNER_URL} target="_blank" rel="noopener noreferrer">
            Tell us what you'd build
          </a>
          <Link to="/record" className="btn">
            Try a Moment first
          </Link>
        </div>
      </section>
    </div>
  );
}
