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
import type { AiOpinion, Chunk, Moment, SealChecks } from "../types";
import { localChunks, localMoment } from "../vault";
import { claimAndVerify, markClaimPrompted } from "../claim";
import { configured } from "../firebase";
import { isDeclined, requireSignIn } from "../signin";
import { ago, Chips, jpegSrc, Link, Stamp } from "../ui";

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

/** A Moment that exists only in this browser: say so, and offer the one thing that needs an account. */
function LocalBanner({ id, guest, finished, onUploaded }: { id: string; guest: boolean; finished: boolean; onUploaded: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="local-banner" role="status">
      <div>
        <strong>{guest ? "On this device · sign in to verify" : "On this device · waiting to sync"}</strong>
        <p className="muted small">
          {guest
            ? "Recorded as a guest. Nobody else can see it until you upload it; then the cloud review and the seal run as usual."
            : "This browser keeps the raw copy until the server confirms every chunk."}
        </p>
        {err && <p className="notice notice-bad small">{err}</p>}
      </div>
      {guest && finished && configured && (
        <button
          className="btn btn-primary btn-small"
          disabled={!!busy}
          onClick={async () => {
            setErr(null);
            try {
              markClaimPrompted();
              const u = await requireSignIn("upload this Moment and get it verified");
              await claimAndVerify([id], u, setBusy);
              onUploaded();
            } catch (e) {
              if (!isDeclined(e)) setErr(`Upload failed: ${String((e as Error)?.message ?? e)}`);
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy ?? "Upload and verify"}
        </button>
      )}
    </div>
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

  const [local, setLocal] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    // Server (or fixtures) first; a Moment only this browser holds (a guest's, or one not yet synced) comes from the
    // raw-vault journal instead, chunks included.
    const fromVault = async () => {
      const lm = await localMoment(id).catch(() => null);
      if (!lm) return false;
      const lc = await localChunks(id);
      if (!live) return true;
      setLocal(true);
      setBundle({ feed: null, moment: lm as Moment });
      setChunks(lc);
      return true;
    };
    getMomentBundle(id)
      .catch(() => ({ feed: null, moment: null }) as MomentBundle)
      .then(async (b) => {
        if (!live) return;
        if (!b.feed && !b.moment && (await fromVault())) return;
        setLocal(false);
        setBundle(b);
        getChunks(id).then(
          (c) => live && setChunks(c),
          () => live && setChunks([]),
        );
      })
      .catch((e) => live && setErr(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [id, reload]);

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
  const guestLocal = local && moment?.ownerUid == null;
  const owner = moment ? moment.owner : feed!.owner;
  const platform = moment?.platform ?? feed!.platform;
  const mode = moment?.onDevice.mode ?? feed!.onDeviceMode;
  const checks = moment?.seal?.checks ?? feed?.checks ?? null;
  const sealed = moment?.seal ? moment.seal.sealed : feed?.status === "sealed";
  const pending = !moment?.seal && !feed;
  const sealReason = moment?.seal?.reason ?? feed?.sealReason ?? "Waiting for the seal.";
  // Only the owner, only when opened from their own Moments: never from the public feed.
  const deletable = canDeleteMoment({ fixtures: FIXTURES, uid: user?.uid, ownerUid: moment?.ownerUid, fromMe, id, recordingId: recordingMomentId() });

  return (
    <article className="page detail">
      <div className="detail-bar">
        <Link to={fromMe ? "/me" : "/"} className="back">
          {fromMe ? "← My Moments" : "← Feed"}
        </Link>
        {deletable && <DeleteMoment id={id} label={intention.text} className="btn btn-small btn-danger-quiet" />}
      </div>
      {local && (
        <LocalBanner
          id={id}
          guest={guestLocal}
          finished={moment?.status === "submitted"}
          onUploaded={() => setReload((n) => n + 1)}
        />
      )}
      <header className="detail-head">
        <div>
          <p className="cat">{intention.category}</p>
          <h1>{intention.text}</h1>
          <p className="muted">
            {owner?.name ?? "You, as a guest"}, {ago(feed?.sealedAtServer ?? moment?.endedAt ?? null)}
            {moment?.device ? `, ${moment.device.model}` : ""}
          </p>
          <Chips platform={platform} mode={mode} />
        </div>
        {!pending && <Stamp sealed={sealed} size="lg" />}
      </header>

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

      <section className="review" aria-labelledby="ai-h">
        <h2 id="ai-h">What the AIs said</h2>
        <div className="opinions">
          <Opinion who="Judge" o={moment?.judge ?? null} fallback={feed?.judgeReasons} />
          <Opinion who="Skeptic" o={moment?.skeptic ?? null} />
          <ScoreCard
            probability={moment?.score?.probability ?? feed?.verificationScore ?? null}
            reasons={moment?.score?.reasons ?? feed?.scoreReasons ?? []}
          />
        </div>
      </section>

      <section className="seal" aria-labelledby="seal-h">
        <div className="section-head">
          <h2 id="seal-h">Seal</h2>
          <p className="muted small">Written only by a Cloud Function. AI proposes; code decides.</p>
        </div>
        <p className={`seal-reason ${sealed ? "" : "seal-reason-bad"}`}>{sealReason}</p>
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
    </article>
  );
}
