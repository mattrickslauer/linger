import { useEffect, useMemo, useState } from "react";
import { subscribeFeed } from "../data";
import { FIXTURES } from "../firebase";
import { fmtDistance, fmtDuration } from "../geo";
import type { User } from "firebase/auth";
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

const TRACK = "M-20,250 C80,210 150,260 230,214 S360,150 420,170 S560,120 640,96 S820,60 900,70 S1080,30 1220,44";

/**
 * The landing IS the app (docs/ARCHITECTURE.md v3.1): one line of pitch, one big way in, then the live feed.
 * Behind it, survey contours and a recorded track that draws itself once: the single orchestrated motion.
 */
function Pitch({ user }: { user: User | null }) {
  const lines = useMemo(contours, []);
  return (
    <section className="pitch" aria-labelledby="pitch-h">
      <svg className="pitch-art" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="contours" transform="translate(240 -40) scale(1.1)">
          {lines.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <path className="hero-track" d={TRACK} pathLength={1} />
      </svg>
      <div className="pitch-in">
        <div className="pitch-copy">
          <h1 id="pitch-h">Proof that it really happened.</h1>
          <p className="pitch-sub">Recorded, chained and checked by AI.</p>
        </div>
        <div className="pitch-cta">
          <Link to="/record" className="btn btn-record">
            <span className="rec-dot" aria-hidden="true" />
            Record a Moment
          </Link>
          <p className="pitch-note">
            {user
              ? `Recording as ${user.displayName?.split(" ")[0] ?? "you"}. It syncs when there's signal.`
              : "No account needed. It stays on this device until you choose to upload it."}
          </p>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Say what you're about to do", text: "A short voice interview turns \"going fishing\" into a claim with a place, a goal and numbers, on your device." },
  { title: "Record it live", text: "GPS, motion and proof shots close into SHA-256-chained chunks every 5 seconds. A witness asks for the evidence that matters." },
  { title: "Cloud reviews", text: "A judge, a skeptic hunting for fakes, a scorer that assumes most people cheat, and a free review of your video clip. AI splits the claim into parts and sets the bar." },
  { title: "Code seals it", text: "A Cloud Function re-checks the chain, timing and physics and alone writes the seal. Owners can add stricter checks after." },
];

function How() {
  return (
    <section className="how-wrap" aria-labelledby="how-h">
      <h2 id="how-h">How a Moment gets verified</h2>
      <ol className="how">
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

/** "score 0.83 · bar 0.80": the final score against the bar the AI set for this claim (v3.8). */
export function ScoreLine({ score, bar, sealed }: { score: number | null | undefined; bar: number | null | undefined; sealed: boolean }) {
  if (score == null) return null;
  const has = bar != null;
  return (
    <span className={`scoreline ${sealed ? "" : "scoreline-low"}`}>
      <span className="scoreline-meter" aria-hidden="true">
        <span className="scoreline-fill" style={{ width: `${Math.round(score * 100)}%` }} />
        {has && <span className="scoreline-bar" style={{ left: `${Math.round(bar! * 100)}%` }} />}
      </span>
      <span className="scoreline-text">
        score {score.toFixed(2)}
        {has && <> · bar {bar!.toFixed(2)}</>}
      </span>
    </span>
  );
}

function Card({ e, lead }: { e: FeedEntry; lead?: boolean }) {
  const sealed = e.status === "sealed";
  const extra = e.ladder?.length ?? 0;
  return (
    <Link to={`/m/${e.momentId}`} className={`card ${sealed ? "" : "card-rejected"} ${lead ? "card-lead" : ""}`}>
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
        <ScoreLine score={e.verificationScore} bar={e.bar} sealed={sealed} />
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
        <span className="chips">
          <Chips platform={e.platform} mode={e.onDeviceMode} />
          {e.cheating ? (
            <span className="chip chip-cheat">Not verified · cheating detected</span>
          ) : e.claimsTotal ? (
            <span className={`chip chip-claims ${(e.claimsBacked ?? 0) < e.claimsTotal ? "low" : ""}`}>
              {e.claimsBacked ?? 0}/{e.claimsTotal} claims backed
            </span>
          ) : null}
          {extra > 0 && <span className="chip chip-ladder">+{extra} check{extra > 1 ? "s" : ""}</span>}
          {e.witness && e.witness.answered > 0 && <span className="chip">witness {e.witness.answered}/{e.witness.asked}</span>}
        </span>
      </div>
    </Link>
  );
}

type Filter = "all" | "sealed" | "rejected";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sealed", label: "Verified" },
  { id: "rejected", label: "Not verified" },
];

export default function Feed({ user }: { user: User | null }) {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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
  const shown = entries?.filter((e) => filter === "all" || e.status === filter) ?? null;
  return (
    <>
      <Pitch user={user} />
      <section id="feed" className="feed" aria-labelledby="feed-h">
        <header className="feed-head">
          <h2 id="feed-h">Latest Moments</h2>
          <p className="live">
            <span className="live-dot" aria-hidden="true" />
            {entries ? `${sealedCount} verified, ${entries.length - sealedCount} not` : "Connecting"}
            {FIXTURES ? " (sample data)" : ", updating live"}
          </p>
          <div className="filters" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} className={`cat-chip ${filter === f.id ? "on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
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
        {shown && shown.length > 0 && (
          <div className="grid">
            {shown.map((e, i) => (
              <Card key={e.momentId} e={e} lead={i === 0 && filter === "all"} />
            ))}
          </div>
        )}
        {shown && shown.length === 0 && entries && entries.length > 0 && <p className="muted">No Moments match this filter yet.</p>}
      </section>
      <How />
      <Link to="/record" className="fab">
        <span className="rec-dot" aria-hidden="true" />
        Record
      </Link>
    </>
  );
}
