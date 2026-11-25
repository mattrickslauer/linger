// The feed: one Moment a screen, swiped up like TikTok. Every slide is the same template, read top to
// bottom as a thread with three waypoints: what they said they would do (intent), what the phone
// captured (proof), and what the seal decided (result). Tap through to the Moment's evidence room.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeFeed } from "../data";
import { FIXTURES } from "../firebase";
import { fmtDistance, fmtDuration } from "../geo";
import type { User } from "firebase/auth";
import { navigate } from "../router";
import type { FeedEntry, SealChecks } from "../types";
import { ago, jpegSrc, Link, TrackSketch } from "../ui";
import "../feed.css";
import { FeedVideo, SpeakerIcon, feedClip } from "../components/SharedVideo";

export const CHECK_ORDER: { key: keyof SealChecks; name: string }[] = [
  { key: "chain", name: "Chain" },
  { key: "timing", name: "Timing" },
  { key: "physics", name: "Physics" },
  { key: "frames", name: "Frames" },
  { key: "ai", name: "AI" },
];

type Filter = "all" | "sealed" | "rejected";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["sealed", "Verified"],
  ["rejected", "Not verified"],
];
const LAST_KEY = "feed.last"; // the slide to come back to from an evidence room

const save = (k: string, v: string) => {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};
const load = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};

export const pct = (p: number | null | undefined) => (p == null ? null : Math.round(p * 100));

// ------------------------------------------------------------------ pieces

/** The five deterministic checks as pips: filled when passed, struck when failed. */
export function Pips({ checks }: { checks: SealChecks }) {
  const passed = CHECK_ORDER.filter((c) => checks[c.key]).length;
  return (
    <div className="pips" role="img" aria-label={`${passed} of 5 seal checks passed`}>
      {CHECK_ORDER.map((c) => (
        <span key={c.key} className={`pip ${checks[c.key] ? "pip-ok" : "pip-bad"}`}>
          <i aria-hidden="true" />
          {c.name}
        </span>
      ))}
    </div>
  );
}

function Share({ e }: { e: FeedEntry }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/m/${e.momentId}`;
  return (
    <button
      className="rail-btn"
      onClick={async (ev) => {
        ev.stopPropagation();
        try {
          if (navigator.share) await navigator.share({ title: e.intention.text, url });
          else {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }
        } catch {
          /* dismissed */
        }
      }}
      aria-label="Share this Moment"
    >
      <span className="disc" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5" />
        </svg>
      </span>
      {copied ? "Copied" : "Share"}
    </button>
  );
}

function Slide({ e, index, active }: { e: FeedEntry; index: number; active: boolean }) {
  const sealed = e.status === "sealed";
  const score = pct(e.verificationScore);
  const bar = pct(e.bar);
  const reason = e.cheating ? (e.cheatingSignals?.[0] ?? e.sealReason) : sealed ? (e.scoreReasons?.[0] ?? e.judgeReasons?.[0]) : e.sealReason;
  const ladder = e.ladder?.length ?? 0;
  const clip = feedClip(e.video?.clips);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    if (!active) setMuted(true);
  }, [active]);
  const extras = [
    e.claimsTotal ? `${e.claimsBacked ?? 0}/${e.claimsTotal} claims backed` : null,
    ladder ? `+${ladder} check${ladder > 1 ? "s" : ""}` : null,
    e.witness && e.witness.asked > 0 ? `witness ${e.witness.answered}/${e.witness.asked}` : null,
    e.video?.reviewed ? "video reviewed" : null,
  ].filter(Boolean);
  const open = () => {
    save(LAST_KEY, e.momentId);
    navigate(`/m/${e.momentId}`);
  };
  return (
    <section
      className={`slide ${sealed ? "slide-ok" : "slide-no"} ${active ? "slide-on" : ""}`}
      data-id={e.momentId}
      data-i={index}
      aria-label={`${e.intention.text}, ${sealed ? "verified" : "not verified"}`}
    >
      <div className="slide-back" aria-hidden="true">
        {e.heroJpegB64 && <img src={jpegSrc(e.heroJpegB64)} alt="" />}
      </div>
      <div className="slide-frame">
        {e.heroJpegB64 ? (
          <img className="slide-photo" src={jpegSrc(e.heroJpegB64)} alt={`Proof shot: ${e.intention.text}`} />
        ) : (
          <div className="slide-photo slide-nophoto" />
        )}
        {clip && <FeedVideo clip={clip} active={active} muted={muted} />}
        <div className="slide-shade" aria-hidden="true" />
        {/* The whole slide opens the room; the buttons below stop the click. */}
        <button className="slide-hit" onClick={open} aria-label={`Inspect the evidence for: ${e.intention.text}`} tabIndex={-1} />

        <ol className="thread">
          <li className="wp wp-intent">
            <p className="wp-label">
              Intent <span>{e.owner?.name ?? "Someone"} set out to</span>
            </p>
            <h2 className="intent-text">{e.intention.text}</h2>
          </li>
          <li className="wp wp-proof">
            <p className="wp-label">
              Proof <span>captured live, {ago(e.sealedAtServer)}</span>
            </p>
            <div className="proof-row">
              {e.track?.length > 1 && (
                <span className="proof-track">
                  <TrackSketch track={e.track} w={64} h={48} />
                </span>
              )}
              <dl className="proof-stats">
                <div>
                  <dt>time</dt>
                  <dd>{fmtDuration(e.summary.durationMs)}</dd>
                </div>
                <div>
                  <dt>moved</dt>
                  <dd>{fmtDistance(e.summary.distanceM)}</dd>
                </div>
                <div>
                  <dt>shots</dt>
                  <dd>{e.summary.frameCount}</dd>
                </div>
              </dl>
            </div>
            <Pips checks={e.checks} />
            {extras.length > 0 && <p className="proof-extra">{extras.join(", ")}</p>}
          </li>
          <li className="wp wp-result">
            <p className="wp-label">Result</p>
            <div className="result-row">
              <span className={`tok-seal ${sealed ? "tok-seal-ok" : "tok-seal-no"}`}>{sealed ? "Verified ✓" : "Not verified"}</span>
              {score != null && (
                <span className="result-score">
                  <b>{score}%</b> likely true
                  {bar != null && <span className="result-bar">, bar {bar}%</span>}
                </span>
              )}
            </div>
            {e.cheating && <p className="result-cheat">Cheating detected</p>}
            {reason && <p className="result-why">{reason}</p>}
          </li>
        </ol>

        <div className="rail">
          {clip && (
            <button
              className="rail-btn"
              aria-pressed={!muted}
              onClick={(ev) => {
                ev.stopPropagation();
                setMuted((m) => !m);
              }}
            >
              <span className="disc" aria-hidden="true">
                <SpeakerIcon muted={muted} />
              </span>
              {muted ? "Sound off" : "Sound on"}
            </button>
          )}
          <button
            className="rail-btn rail-primary"
            onClick={(ev) => {
              ev.stopPropagation();
              open();
            }}
          >
            <span className="disc" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="M15 15l5 5" />
              </svg>
            </span>
            Evidence
          </button>
          <Share e={e} />
        </div>
      </div>
    </section>
  );
}

function Intro({ count, sealed, user }: { count: number | null; sealed: number; user: User | null }) {
  return (
    <section className="slide slide-intro" aria-label="About Verified">
      <div className="slide-frame intro">
        <h1>Proof it happened.</h1>
        <p className="lede">Every post here was recorded live, argued over by AI, and sealed by code. Each one reads the same way:</p>
        <ol className="thread thread-static">
          <li className="wp wp-intent">
            <p className="wp-label">Intent</p>
            <p>What they said they would do, before starting. A short voice interview turns it into claims with a place, a goal and numbers.</p>
          </li>
          <li className="wp wp-proof">
            <p className="wp-label">Proof</p>
            <p>GPS, motion, proof shots and video, hashed into a chain every 5 seconds. A witness asks for the evidence that matters; it can never verify.</p>
          </li>
          <li className="wp wp-result">
            <p className="wp-label">Result</p>
            <p>A judge, a skeptic and a scorer weigh it in the cloud against a bar the AI sets. Then a Cloud Function checks the chain and alone writes the seal.</p>
          </li>
        </ol>
        <p className="intro-count">
          {count == null ? "Connecting…" : `${sealed} verified, ${count - sealed} not${FIXTURES ? " (sample data)" : ""}`}
        </p>
        <p className="intro-count">
          {user ? `Recording as ${user.displayName?.split(" ")[0] ?? "you"}.` : "No account needed to record. It stays on this device until you upload it."}
        </p>
        <div className="intro-actions">
          <Link to="/record" className="btn btn-primary">
            Record a Moment
          </Link>
          <span className="swipe-hint" aria-hidden="true">
            Swipe up
          </span>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ page

export default function Feed({ user }: { user: User | null }) {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

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

  const shown = useMemo(() => (entries ?? []).filter((e) => filter === "all" || e.status === filter), [entries, filter]);
  const sealedCount = entries?.filter((e) => e.status === "sealed").length ?? 0;

  // Which slide is on screen: drives the one reveal and the keyboard.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (items) => {
        for (const it of items) if (it.isIntersecting) setActive((it.target as HTMLElement).dataset.id ?? "intro");
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll(".slide").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [shown]);

  // Coming back from an evidence room: land on the slide you left.
  useEffect(() => {
    if (restored.current || !entries) return;
    restored.current = true;
    const last = load(LAST_KEY);
    const node = last ? scroller.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(last)}"]`) : null;
    if (node) scroller.current!.scrollTop = node.offsetTop;
  }, [entries]);

  const go = useCallback((dir: 1 | -1) => {
    const root = scroller.current;
    if (!root) return;
    root.scrollBy({ top: dir * root.clientHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Enter" && active && active !== "intro" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
        save(LAST_KEY, active);
        navigate(`/m/${active}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, active]);

  return (
    <div className="tok">
      <div className="tok-tabs" role="group" aria-label="Show">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            className="tok-tab"
            aria-pressed={filter === k}
            onClick={() => {
              setFilter(k);
              scroller.current?.scrollTo({ top: 0 });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tok-scroll" ref={scroller} tabIndex={-1}>
        <Intro count={entries ? entries.length : null} sealed={sealedCount} user={user} />
        {error && (
          <section className="slide slide-msg">
            <p className="notice notice-bad">Couldn't load the feed: {error}</p>
          </section>
        )}
        {!entries && !error && <section className="slide slide-msg slide-skeleton" aria-busy="true" />}
        {shown.map((e, i) => (
          <Slide key={e.momentId} e={e} index={i} active={active === e.momentId} />
        ))}
        {entries && (
          <section className="slide slide-msg" data-id="end">
            <div className="end">
              <h2>{shown.length ? "That's every Moment." : "Nothing here yet."}</h2>
              <p>{shown.length ? "Record one of your own and it shows up here once it's sealed." : "Record the first one and it shows up here once it's sealed."}</p>
              <div className="intro-actions">
                <Link to="/record" className="btn btn-primary">
                  Record a Moment
                </Link>
                {shown.length > 0 && (
                  <button className="btn" onClick={() => scroller.current?.scrollTo({ top: 0 })}>
                    Back to the top
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      <div className="tok-nav" aria-hidden="true">
        <button tabIndex={-1} onClick={() => go(-1)} title="Previous (k)">
          ↑
        </button>
        <button tabIndex={-1} onClick={() => go(1)} title="Next (j)">
          ↓
        </button>
      </div>
    </div>
  );
}
