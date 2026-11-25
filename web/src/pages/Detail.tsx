import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useUser } from "../auth";
import { cameFromMe, canDeleteMoment } from "../canDelete";
import ChainViewer from "../components/ChainViewer";
import DeleteMoment from "../components/DeleteMoment";
import MotionChart from "../components/MotionChart";
import { getChunks, getMomentBundle, type MomentBundle } from "../data";
import { FIXTURES } from "../firebase";
import { decodeChunks, downsample, fmtDistance, fmtDuration } from "../geo";
import { recordingMomentId } from "../recorder";
import type { AiOpinion, Chunk, SealChecks } from "../types";
import { ago, Chips, jpegSrc, Link, Stamp } from "../ui";
import "../room.css";

const TrackMap = lazy(() => import("../components/TrackMap"));

const CHECKS: { key: keyof SealChecks; name: string; ok: string; bad: string }[] = [
  { key: "chain", name: "Hash chain", ok: "Every chunk hash recomputed and linked; head hash matches.", bad: "A chunk was changed, removed or reordered." },
  { key: "timing", name: "Timing", ok: "Timestamps only move forward and the session ran at least 20 s.", bad: "Timestamps go backwards or the session is too short." },
  { key: "physics", name: "Physics", ok: "No impossible GPS jumps; the motion sensor was live.", bad: "Location jumped faster than 70 m/s, or motion was flat." },
  { key: "frames", name: "Proof frames", ok: "At least one frame, each matching its fingerprint in the chain.", bad: "Missing frames, or a frame does not match its fingerprint." },
  { key: "ai", name: "AI review", ok: "Judge found it consistent, the skeptic found no fake signal, and the verification score is at least 50%.", bad: "The judge was not convinced, the skeptic found a fake signal, or the verification score is under 50%." },
];

/** The scorer: P(claim true | evidence), starting from the assumption that most submissions cheat. */
function ScoreCard({ probability, reasons }: { probability: number | null; reasons: string[] }) {
  const pct = probability == null ? null : Math.round(probability * 100);
  const tone = pct == null ? "meh" : pct >= 50 ? "ok" : pct >= 30 ? "meh" : "bad";
  return (
    <article className={`opinion opinion-${tone}`}>
      <header>
        <h3>Verification score</h3>
        {pct != null && (
          <p className="verdict">
            {pct}% likely true
            <span className="conf" aria-label={`probability ${pct} percent`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </p>
        )}
      </header>
      <p className="muted small">Chance the claim is true given the evidence, assuming most submissions are cheating (prior 20%). Needs 50% to seal.</p>
      {pct == null ? (
        <p className="muted small">Not scored (recorded before the scorer existed).</p>
      ) : reasons.length ? (
        <ul>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function Opinion({ who, o, fallback }: { who: "Judge" | "Skeptic"; o: AiOpinion | null; fallback?: string[] }) {
  const verdict = o?.verdict;
  const tone = who === "Skeptic" ? (verdict === "inconsistent" ? "bad" : "ok") : verdict === "consistent" ? "ok" : verdict === "inconsistent" ? "bad" : "meh";
  const label =
    who === "Skeptic"
      ? verdict === "inconsistent"
        ? "found a fake signal"
        : verdict === "consistent"
          ? "found nothing fake"
          : "not sure"
      : verdict === "consistent"
        ? "consistent with the intention"
        : verdict === "inconsistent"
          ? "not consistent"
          : "uncertain";
  const reasons = o?.reasons ?? fallback ?? [];
  return (
    <article className={`opinion opinion-${tone}`}>
      <header>
        <h3>{who}</h3>
        {o && (
          <p className="verdict">
            {label}
            <span className="conf" aria-label={`confidence ${Math.round(o.confidence * 100)} percent`}>
              <span style={{ width: `${Math.round(o.confidence * 100)}%` }} />
            </span>
            <span className="muted small">{Math.round(o.confidence * 100)}%</span>
          </p>
        )}
      </header>
      {reasons.length ? (
        <ul>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No reasons recorded.</p>
      )}
      {o && <p className="muted small">{o.model}, in the cloud via Firebase AI Logic</p>}
    </article>
  );
}

export default function Detail({ id }: { id: string }) {
  const [bundle, setBundle] = useState<MomentBundle | null>(null);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [pickedSeq, setPickedSeq] = useState<number | null>(null);
  const { user } = useUser();
  const fromMe = cameFromMe(location.search);

  useEffect(() => {
    let live = true;
    getMomentBundle(id).then((b) => live && setBundle(b), (e) => live && setErr(String(e?.message ?? e)));
    getChunks(id).then(
      (c) => live && setChunks(c),
      () => live && setChunks([]),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const decoded = useMemo(() => decodeChunks(chunks ?? []), [chunks]);
  const feed = bundle?.feed ?? null;
  const moment = bundle?.moment ?? null;
  const summary = moment?.summary ?? feed?.summary ?? null;
  const start = moment?.startedAt ?? chunks?.[0]?.t0 ?? 0;
  const duration = summary?.durationMs || (chunks?.length ? chunks[chunks.length - 1].t1 - start : 1);

  // Start on the hero frame, the one the card showed.
  useEffect(() => {
    const hero = decoded.frames.find((f) => f.seq === summary?.heroFrameSeq) ?? decoded.frames[decoded.frames.length - 1];
    if (hero) setT(hero.t - start);
  }, [decoded, summary?.heroFrameSeq, start]);

  const track = useMemo<[number, number][]>(
    () => (decoded.gps.length > 1 ? downsample(decoded.gps.map((g) => [g[1], g[2]] as [number, number]), 600) : (feed?.track ?? [])),
    [decoded, feed],
  );
  const abs = start + t;
  const frame = useMemo(() => {
    const before = decoded.frames.filter((f) => f.t <= abs + 1);
    return before[before.length - 1] ?? decoded.frames[0] ?? null;
  }, [decoded, abs]);
  const cursor = useMemo<[number, number] | null>(() => {
    if (!decoded.gps.length) return null;
    let best = decoded.gps[0];
    for (const g of decoded.gps) if (g[0] <= abs) best = g;
    return [best[1], best[2]];
  }, [decoded, abs]);
  const frameMarkers = useMemo<[number, number][]>(
    () =>
      decoded.frames
        .map((f) => {
          let best: (typeof decoded.gps)[number] | undefined;
          for (const g of decoded.gps) if (g[0] <= f.t) best = g;
          return best ? ([best[1], best[2]] as [number, number]) : null;
        })
        .filter((x): x is [number, number] => !!x),
    [decoded],
  );
  const activeSeq = pickedSeq ?? chunks?.find((c) => c.t0 <= abs && abs <= c.t1)?.seq ?? null;

  if (err) return <p className="notice notice-bad page">Couldn't load this Moment: {err}</p>;
  if (!bundle) return <div className="page detail-skeleton" aria-busy="true" />;
  if (!feed && !moment)
    return (
      <div className="page empty">
        <p>This Moment doesn't exist, or it hasn't been sealed yet.</p>
        <Link to="/" className="btn">
          Back to the feed
        </Link>
      </div>
    );

  const intention = moment?.intention ?? feed!.intention;
  const owner = moment?.owner ?? feed!.owner;
  const platform = moment?.platform ?? feed!.platform;
  const mode = moment?.onDevice.mode ?? feed!.onDeviceMode;
  const checks = moment?.seal?.checks ?? feed?.checks ?? null;
  const sealed = moment?.seal ? moment.seal.sealed : feed?.status === "sealed";
  const pending = !moment?.seal && !feed;
  const sealReason = moment?.seal?.reason ?? feed?.sealReason ?? "Waiting for the seal.";
  // Only the owner, only when opened from their own Moments: never from the public feed.
  const deletable = canDeleteMoment({ fixtures: FIXTURES, uid: user?.uid, ownerUid: moment?.ownerUid, fromMe, id, recordingId: recordingMomentId() });

  const score = moment?.score?.probability ?? feed?.verificationScore ?? null;
  const scorePct = score == null ? null : Math.round(score * 100);
  const passed = checks ? CHECKS.filter((c) => checks[c.key]).length : 0;

  return (
    <article className={`page detail room ${pending ? "" : sealed ? "room-ok" : "room-no"}`}>
      <div className="detail-bar">
        <Link to={fromMe ? "/me" : "/"} className="back">
          {fromMe ? "← My Moments" : "← Feed"}
        </Link>
        <nav className="room-nav" aria-label="Evidence room">
          <a href="#intent">Intent</a>
          <a href="#proof">Proof</a>
          <a href="#result">Result</a>
        </nav>
        {deletable && <DeleteMoment id={id} label={intention.text} className="btn btn-small btn-danger-quiet" />}
      </div>

      <p className="room-title">Evidence room</p>

      {/* ---------------------------------------------------------- intent */}
      <section id="intent" className="room-wp room-intent" aria-labelledby="intent-h">
        <h2 id="intent-h" className="room-label">
          Intent <span>what {owner?.name ?? "they"} said they would do, before starting</span>
        </h2>
        <header className="detail-head">
          <div>
            <p className="cat">{intention.category}</p>
            <h1 className="room-intent-text">{intention.text}</h1>
            <p className="muted">
              {owner?.name}, {ago(feed?.sealedAtServer ?? moment?.endedAt ?? null)}
              {moment?.device ? `, ${moment.device.model}` : ""}
            </p>
            <Chips platform={platform} mode={mode} />
          </div>
        </header>
      </section>

      {/* ---------------------------------------------------------- proof */}
      <section id="proof" className="room-wp room-proof" aria-labelledby="proof-h">
        <h2 id="proof-h" className="room-label">
          Proof <span>captured on the phone as it happened, hashed chunk by chunk</span>
        </h2>
        {summary && (
          <dl className="stats stats-wide">
            <div>
              <dt>time</dt>
              <dd>{fmtDuration(summary.durationMs)}</dd>
            </div>
            <div>
              <dt>distance</dt>
              <dd>{fmtDistance(summary.distanceM)}</dd>
            </div>
            <div>
              <dt>proof frames</dt>
              <dd>{summary.frameCount}</dd>
            </div>
            <div>
              <dt>GPS fixes</dt>
              <dd>{summary.gpsCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>motion samples</dt>
              <dd>{summary.motionCount.toLocaleString()}</dd>
            </div>
            {moment && (
              <div>
                <dt>live checks</dt>
                <dd>
                  {moment.onDevice.checks}
                  {moment.onDevice.retakes ? <span className="dd-sub"> ({moment.onDevice.retakes} retake{moment.onDevice.retakes > 1 ? "s" : ""})</span> : null}
                </dd>
              </div>
            )}
          </dl>
        )}

        <h3 className="room-exhibit">Proof shots, track and motion</h3>
        <section className="viewer">
          <div className="viewer-main">
            <div className="frame-stage">
              {frame ? (
                <>
                  <img src={jpegSrc(frame.jpegB64)} alt={frame.label || "Proof frame"} />
                  <p className="frame-cap">
                    <span>{fmtDuration(frame.t - start)}</span>
                    {frame.label && <span>{frame.label}</span>}
                    {frame.ok === false ? <span className="coach coach-bad">coach: retake</span> : frame.ok ? <span className="coach">coach: keep going</span> : null}
                    {frame.mode !== "none" && <span className="muted">{frame.mode === "on_device" ? "on-device" : "cloud"}</span>}
                  </p>
                </>
              ) : feed?.heroJpegB64 ? (
                <img src={jpegSrc(feed.heroJpegB64)} alt="Hero proof frame" />
              ) : (
                <div className="frame-empty">{chunks ? "No proof frames available." : "Loading frames…"}</div>
              )}
            </div>
            <div className="timeline">
              <div className="thumbs">
                {decoded.frames.map((f) => (
                  <button
                    key={f.seq}
                    className={`thumb ${frame?.seq === f.seq ? "thumb-on" : ""} ${f.ok === false ? "thumb-retake" : ""}`}
                    style={{ left: `${((f.t - start) / duration) * 100}%` }}
                    onClick={() => {
                      setT(f.t - start);
                      setPickedSeq(null);
                    }}
                    aria-label={`Proof shot at ${fmtDuration(f.t - start)}${f.label ? ": " + f.label : ""}`}
                  >
                    <img src={jpegSrc(f.jpegB64)} alt="" />
                  </button>
                ))}
              </div>
              <input
                type="range"
                className="scrub"
                min={0}
                max={duration}
                step={100}
                value={t}
                onChange={(e) => {
                  setT(Number(e.target.value));
                  setPickedSeq(null);
                }}
                aria-label="Scrub through the session"
                aria-valuetext={fmtDuration(t)}
              />
              <div className="scrub-scale">
                <span>0:00</span>
                <span>{fmtDuration(t)}</span>
                <span>{fmtDuration(duration)}</span>
              </div>
            </div>
            <MotionChart
              motion={decoded.motion}
              start={start}
              duration={duration}
              frames={decoded.frames.map((f) => f.t)}
              t={t}
              onSeek={(ms) => {
                setT(ms);
                setPickedSeq(null);
              }}
            />
          </div>
          <aside className="viewer-side">
            <Suspense fallback={<div className="map" />}>
              <TrackMap track={track} cursor={cursor} frames={frameMarkers} />
            </Suspense>
          </aside>
        </section>

        {chunks && chunks.length > 0 && (
          <ChainViewer
            momentId={id}
            chunks={chunks}
            headHash={moment?.headHash ?? null}
            chunkCount={moment?.chunkCount ?? null}
            activeSeq={activeSeq}
            onPick={(seq) => {
              setPickedSeq(seq);
              const c = chunks.find((x) => x.seq === seq);
              if (c) setT(Math.min(duration, (c.frame?.t ?? c.t0) - start));
            }}
          />
        )}
      </section>

      {/* ---------------------------------------------------------- result */}
      <section id="result" className="room-wp room-result" aria-labelledby="result-h">
        <h2 id="result-h" className="room-label">
          Result <span>three AIs propose, a Cloud Function decides</span>
        </h2>
        <div className="room-verdict">
          {!pending && <Stamp sealed={sealed} size="lg" />}
          <div>
            <p className={`seal-reason ${sealed ? "" : "seal-reason-bad"}`}>{sealReason}</p>
            {checks && (
              <p className="muted small">
                {passed} of 5 seal checks passed{scorePct != null ? `, ${scorePct}% likely true` : ""}.
              </p>
            )}
          </div>
        </div>

        <h3 className="room-exhibit">What the AIs said</h3>
        <div className="opinions">
          <Opinion who="Judge" o={moment?.judge ?? null} fallback={feed?.judgeReasons} />
          <Opinion who="Skeptic" o={moment?.skeptic ?? null} />
          <ScoreCard probability={score} reasons={moment?.score?.reasons ?? feed?.scoreReasons ?? []} />
        </div>

        <h3 className="room-exhibit">The seal checks</h3>
        <p className="muted small">Written only by a Cloud Function. AI proposes; code decides.</p>
        {checks ? (
          <ul className="checklist">
            {CHECKS.map((c) => (
              <li key={c.key} className={checks[c.key] ? "pass" : "fail"}>
                <span className="mark" aria-hidden="true">
                  {checks[c.key] ? "✓" : "✗"}
                </span>
                <strong>{c.name}</strong>
                <span>{checks[c.key] ? c.ok : c.bad}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Not sealed yet.</p>
        )}
      </section>
    </article>
  );
}
