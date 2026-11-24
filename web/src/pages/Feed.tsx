import { useEffect, useMemo, useState } from "react";
import { subscribeFeed } from "../data";
import { FIXTURES } from "../firebase";
import { fmtDistance, fmtDuration } from "../geo";
import type { FeedEntry } from "../types";
import { ago, Chips, jpegSrc, Link, Stamp, TrackSketch } from "../ui";

// ------------------------------------------------------------------ hero art

/** Contour lines around two summits, deterministic so the page never shifts between loads. */
function contours(): string[] {
  const peaks = [
    { x: 300, y: 150, r0: 18, n: 11, wob: 0.16, ph: 0.4 },
    { x: 520, y: 300, r0: 14, n: 8, wob: 0.2, ph: 2.1 },
  ];
  const out: string[] = [];
  for (const p of peaks) {
    for (let i = 0; i < p.n; i++) {
      const r = p.r0 + i * 26;
      let d = "";
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * Math.PI * 2;
        const k = 1 + p.wob * Math.sin(th * 3 + p.ph + i * 0.35) + 0.07 * Math.sin(th * 7 - i);
        const x = p.x + Math.cos(th) * r * k * 1.25;
        const y = p.y + Math.sin(th) * r * k * 0.85;
        d += `${a ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      out.push(d + "Z");
    }
  }
  return out;
}

const TRACK = "M60,330 C110,300 130,340 170,300 S230,250 250,262 S300,230 290,200 S330,170 360,184 S420,150 430,120";
const FRAMES = [
  { x: 170, y: 300 },
  { x: 290, y: 200 },
  { x: 430, y: 120 },
];

function HeroArt() {
  const lines = useMemo(contours, []);
  return (
    <svg className="hero-art" viewBox="0 0 640 400" role="img" aria-label="A recorded track crossing contour lines, with three proof shots and a seal at the end">
      <g className="contours">
        {lines.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <path className="hero-track-shadow" d={TRACK} />
      <path className="hero-track" d={TRACK} pathLength={1} />
      {FRAMES.map((f, i) => (
        <g key={i} className="hero-frame" style={{ animationDelay: `${0.5 + i * 0.55}s` }} transform={`translate(${f.x} ${f.y})`}>
          <rect x="-15" y="-34" width="30" height="24" rx="3" />
          <circle cx="0" cy="0" r="5" />
          <line x1="0" y1="-10" x2="0" y2="-5" />
        </g>
      ))}
      <g className="hero-seal" transform="translate(470 92) rotate(-8)">
        <rect x="-4" y="-22" width="128" height="44" rx="6" />
        <rect className="inner" x="1" y="-17" width="118" height="34" rx="4" />
        <text x="60" y="6" textAnchor="middle">
          Verified ✓
        </text>
      </g>
    </svg>
  );
}

const STEPS = [
  { title: "On-device coach", text: "Gemini Nano looks at each proof shot on your device and says keep going or retake. It can never verify." },
  { title: "Offline sync", text: "No signal at the lake? Every 5-second chunk is hashed and queued on the phone, then syncs itself." },
  { title: "Cloud judge + skeptic", text: "One model weighs the evidence. A second hunts for screens, stock photos and staging." },
  { title: "Deterministic seal", text: "A Cloud Function re-hashes the chain, checks timing and physics, and alone writes the seal." },
];

function Hero() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>Proof it happened.</h1>
        <p className="lede">
          Record a moment as it happens. An AI on your phone coaches the proof, two AIs in the cloud argue about it, and plain code
          seals it so nothing can be changed afterwards.
        </p>
        <div className="hero-actions">
          <Link to="/record" className="btn btn-primary">
            Record a Moment
          </Link>
          <a href="#feed" className="btn btn-quiet">
            Browse sealed Moments
          </a>
        </div>
      </div>
      <HeroArt />
      <ol className="how" aria-label="How it works">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="how-n">{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ feed

function Card({ e }: { e: FeedEntry }) {
  const sealed = e.status === "sealed";
  return (
    <Link to={`/m/${e.momentId}`} className={`card ${sealed ? "" : "card-rejected"}`}>
      <div className="card-media">
        {e.heroJpegB64 ? <img src={jpegSrc(e.heroJpegB64)} alt={`Proof shot: ${e.intention.text}`} /> : <div className="card-noimg" />}
        <Stamp sealed={sealed} />
        {e.track?.length > 1 && (
          <span className="card-track">
            <TrackSketch track={e.track} />
          </span>
        )}
      </div>
      <div className="card-body">
        <h3>{e.intention.text}</h3>
        <p className="card-meta">
          {e.owner?.name ?? "Someone"}, {ago(e.sealedAtServer)}
        </p>
        <dl className="stats">
          <div>
            <dt>time</dt>
            <dd>{fmtDuration(e.summary.durationMs)}</dd>
          </div>
          <div>
            <dt>distance</dt>
            <dd>{fmtDistance(e.summary.distanceM)}</dd>
          </div>
          <div>
            <dt>frames</dt>
            <dd>{e.summary.frameCount}</dd>
          </div>
        </dl>
        <Chips platform={e.platform} mode={e.onDeviceMode} />
      </div>
    </Link>
  );
}

export default function Feed() {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      subscribeFeed(
        (e) => {
          setEntries(e);
          setError(null);
        },
        (err) => setError(err.message),
      ),
    [],
  );
  const sealedCount = entries?.filter((e) => e.status === "sealed").length ?? 0;
  return (
    <>
      <Hero />
      <section id="feed" className="feed">
        <header className="feed-head">
          <h2>Sealed Moments</h2>
          <p className="live">
            <span className="live-dot" aria-hidden="true" />
            {entries ? `${sealedCount} verified, ${entries.length - sealedCount} not` : "Connecting"}
            {FIXTURES ? " (sample data)" : ", updating live"}
          </p>
        </header>
        {error && <p className="notice notice-bad">Couldn't load the feed: {error}</p>}
        {entries && entries.length === 0 && (
          <div className="empty">
            <p>Nothing sealed yet. Record the first Moment and it will appear here within a minute of syncing.</p>
            <Link to="/record" className="btn btn-primary">
              Record a Moment
            </Link>
          </div>
        )}
        {!entries && !error && <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="card card-skeleton" />)}</div>}
        {entries && entries.length > 0 && (
          <div className="grid">
            {entries.map((e) => (
              <Card key={e.momentId} e={e} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
