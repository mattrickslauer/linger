// The feed: one Moment a screen, swiped up like TikTok. Every slide is the same template, read top to
// bottom as a thread with three waypoints: what they said they would do (intent), what the phone
// captured (proof), and what the seal decided (result). Tap through to the Moment's evidence room.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeFeed } from "../data";
import { FIXTURES } from "../firebase";
import { fmtDistance, fmtDuration } from "../geo";
import type { User } from "firebase/auth";
import { navigate } from "../router";
import type { FeedEntry } from "../types";
import { ago, jpegSrc, Link, TrackSketch } from "../ui";
import "../feed.css";
import { FeedVideo, feedClip } from "../components/SharedVideo";
import { CheckPips, FitImg, Glyph, GlyphChip, Hybrid, ScoreRing, Stats } from "../kit";

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
        <Glyph name={copied ? "check" : "share"} />
      </span>
      <span aria-live="polite">{copied ? "Copied" : "Share"}</span>
    </button>
  );
}

function Slide({ e, index, active }: { e: FeedEntry; index: number; active: boolean }) {
  const sealed = e.status === "sealed";
  const score = pct(e.verificationScore);
  const reason = e.cheating ? (e.cheatingSignals?.[0] ?? e.sealReason) : sealed ? (e.scoreReasons?.[0] ?? e.judgeReasons?.[0]) : e.sealReason;
  const ladder = e.ladder?.length ?? 0;
  const clip = feedClip(e.video?.clips);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    if (!active) setMuted(true);
  }, [active]);
  const extras = [
    e.claimsTotal ? (
      <GlyphChip key="c" glyph="intent" tone={(e.claimsBacked ?? 0) >= e.claimsTotal ? "ok" : undefined} title="Claims backed by evidence">
        {e.claimsBacked ?? 0}/{e.claimsTotal} claims
      </GlyphChip>
    ) : null,
    ladder ? (
      <GlyphChip key="l" glyph="ladder" title="Extra checks run">
        +{ladder}
      </GlyphChip>
    ) : null,
    e.witness && e.witness.asked > 0 ? (
      <GlyphChip key="w" glyph="witness" title="Witness requests answered">
        {e.witness.answered}/{e.witness.asked}
      </GlyphChip>
    ) : null,
    e.video?.reviewed ? (
      <GlyphChip key="v" glyph="video" title="Video reviewed in the cloud">
        reviewed
      </GlyphChip>
    ) : null,
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
          <FitImg className="slide-photo" src={jpegSrc(e.heroJpegB64)} alt={`Proof shot: ${e.intention.text}`} />
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
              Proof <span>live, {ago(e.sealedAtServer)}</span>
            </p>
            <div className="proof-row">
              {e.track?.length > 1 && (
                <span className="proof-track">
                  <TrackSketch track={e.track} w={64} h={48} />
                </span>
              )}
              <Stats
                className="proof-stats"
                items={[
                  { glyph: "timing", value: fmtDuration(e.summary.durationMs), label: "time" },
                  { glyph: "route", value: fmtDistance(e.summary.distanceM), label: "moved" },
                  { glyph: "frames", value: e.summary.frameCount, label: "shots" },
                ]}
              />
            </div>
            <div className="proof-checks">
              <CheckPips checks={e.checks} />
              <Hybrid mode={e.onDeviceMode} />
            </div>
            {extras.length > 0 && <p className="proof-extra">{extras}</p>}
          </li>
          <li className="wp wp-result">
            <p className="wp-label">Result</p>
            <div className="result-row">
              <span className={`tok-seal ${sealed ? "tok-seal-ok" : "tok-seal-no"}`}>{sealed ? "Verified ✓" : "Not verified"}</span>
              {score != null && <ScoreRing value={e.verificationScore} bar={e.bar} sealed={sealed} size={62} className="result-ring" />}
            </div>
            {e.cheating && (
              <p className="result-cheat">
                <Glyph name="cheating" /> Cheating detected
              </p>
            )}
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
                <Glyph name={muted ? "mute" : "speaker"} />
              </span>
              {muted ? "Muted" : "Sound"}
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
              <Glyph name="search" />
            </span>
            Evidence
          </button>
          <Share e={e} />
        </div>
      </div>
    </section>
  );
}

const TILES: { k: "intent" | "proof" | "result"; glyph: "intent" | "proof" | "seal"; name: string; line: string }[] = [
  { k: "intent", glyph: "intent", name: "Intent", line: "Said before starting" },
  { k: "proof", glyph: "proof", name: "Proof", line: "Captured live, hash-chained" },
  { k: "result", glyph: "seal", name: "Result", line: "AI weighs it, code seals" },
];

function Intro({ count, sealed, user }: { count: number | null; sealed: number; user: User | null }) {
  return (
    <section className="slide slide-intro" aria-label="About Verified">
      <div className="slide-frame intro">
        <h1>Proof it happened.</h1>
        <p className="intro-sub">Every post was recorded live and sealed by code. Each reads the same way:</p>
        <ol className="intro-tiles">
          {TILES.map((t) => (
            <li key={t.k} className={`itile itile-${t.k}`}>
              <span className="itile-glyph">
                <Glyph name={t.glyph} />
              </span>
              <strong>{t.name}</strong>
              <span>{t.line}</span>
            </li>
          ))}
        </ol>
        <p className="intro-hybrid">
          <Hybrid mode="on_device" label="on-device coach" />
          <Hybrid mode="cloud" label="cloud judges" />
          <GlyphChip glyph="seal">code seals</GlyphChip>
        </p>
        {count == null ? (
          <p className="intro-count">Connecting…</p>
        ) : (
          <dl className="intro-tally" aria-label={`${sealed} verified, ${count - sealed} not verified${FIXTURES ? ", sample data" : ""}`}>
            <div className="tally-ok">
              <dt>verified</dt>
              <dd>{sealed}</dd>
            </div>
            <div className="tally-no">
              <dt>not verified</dt>
              <dd>{count - sealed}</dd>
            </div>
          </dl>
        )}
        <div className="intro-actions">
          <Link to="/record" className="btn btn-primary">
            <Glyph name="record" /> Record a Moment
          </Link>
          <span className="swipe-hint" aria-hidden="true">
            Swipe up
          </span>
        </div>
        <p className="intro-note">{user ? `Recording as ${user.displayName?.split(" ")[0] ?? "you"}` : "No account needed to record"}</p>
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
        <span className="tok-seg">
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
        </span>
      </div>
      <div className="tok-scroll" ref={scroller} tabIndex={-1}>
        <Intro count={entries ? entries.length : null} sealed={sealedCount} user={user} />
        {error && (
          <section className="slide slide-msg">
            <div className="end">
              <span className="end-glyph" aria-hidden="true">
                <Glyph name="offline" />
              </span>
              <p className="notice notice-bad">Couldn't load the feed: {error}</p>
            </div>
          </section>
        )}
        {!entries && !error && <section className="slide slide-msg slide-skeleton" aria-busy="true" />}
        {shown.map((e, i) => (
          <Slide key={e.momentId} e={e} index={i} active={active === e.momentId} />
        ))}
        {entries && (
          <section className="slide slide-msg" data-id="end">
            <div className="end">
              <span className="end-glyph" aria-hidden="true">
                <Glyph name={shown.length ? "seal" : "record"} />
              </span>
              <h2>{shown.length ? "That's every Moment." : "Nothing here yet."}</h2>
              <p>{shown.length ? "Yours appears here once it's sealed." : "Record the first one."}</p>
              <div className="intro-actions">
                <Link to="/record" className="btn btn-primary">
                  <Glyph name="record" /> Record a Moment
                </Link>
                {shown.length > 0 && (
                  <button className="btn" onClick={() => scroller.current?.scrollTo({ top: 0 })}>
                    <Glyph name="up" /> Back to the top
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      <div className="tok-nav" aria-hidden="true">
        <button tabIndex={-1} onClick={() => go(-1)} title="Previous (k)">
          <Glyph name="up" />
        </button>
        <button tabIndex={-1} onClick={() => go(1)} title="Next (j)">
          <Glyph name="down" />
        </button>
      </div>
    </div>
  );
}
