import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useUser } from "../auth";
import { cameFromMe, canDeleteMoment } from "../canDelete";
import ChainViewer from "../components/ChainViewer";
import DeleteMoment from "../components/DeleteMoment";
import Ladder from "../components/Ladder";
import LocalClips from "../components/LocalClips";
import { MomentVideos } from "../components/SharedVideo";
import { evidenceOf } from "../ladder";
import { LADDER_DEMO } from "../credits";
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
import "../room.css";
import ClaimsPanel from "../components/Claims";
import { claimViews, factsOf, videoStatusText } from "../v4";
import { offersV4 } from "../ladder";
import type { V4Ladder } from "../components/Ladder";
import type { ModuleId } from "../types";

const TrackMap = lazy(() => import("../components/TrackMap"));

const CHECKS: { key: keyof SealChecks; name: string; ok: string; bad: string }[] = [
  { key: "chain", name: "Hash chain", ok: "Every chunk hash recomputed and linked; head hash matches.", bad: "A chunk was changed, removed or reordered." },
  { key: "timing", name: "Timing", ok: "Timestamps only move forward and the session ran at least 20 s.", bad: "Timestamps go backwards or the session is too short." },
  { key: "physics", name: "Physics", ok: "No impossible GPS jumps; the motion sensor was live.", bad: "Location jumped faster than 70 m/s, or motion was flat." },
  { key: "frames", name: "Proof frames", ok: "At least one frame, each matching its fingerprint in the chain.", bad: "Missing frames, or a frame does not match its fingerprint." },
  { key: "ai", name: "AI review", ok: "Judge found it consistent, the skeptic found no fake signal, and the verification score is at least 50%.", bad: "The judge was not convinced, the skeptic found a fake signal, or the verification score is under 50%." },
];
// Seal v3 moved the score gate out of `ai` into its own `bar` check.
const CHECKS_V3: typeof CHECKS = [
  ...CHECKS.slice(0, 4),
  { key: "ai", name: "AI review", ok: "The judge found it consistent and the skeptic found no fake signal.", bad: "The judge was not convinced, or the skeptic found a fake signal." },
  { key: "bar", name: "Score clears the bar", ok: "The final verification score is at or above the bar the AI set for this claim.", bad: "The final verification score is below the bar the AI set for this claim." },
];
// Seal v4 (docs/ARCHITECTURE.md v4.5/v4.6): per-claim bar, and cheating as its own check.
const CHECKS_V4: typeof CHECKS = [
  ...CHECKS.slice(0, 4),
  { key: "ai", name: "AI review", ok: "The judge didn't find the proof frames contradicting the intention.", bad: "The proof frames contradict the intention." },
  { key: "cheating", name: "No cheating", ok: "No broken chain, no fake signal from the skeptic, and the video matches the chain.", bad: "A cheating signal was found (see above)." },
  { key: "bar", name: "Every claim clears the bar", ok: "The minimum evidence for every claim arrived, or extra checks lifted it to the bar.", bad: "At least one claim is still below the bar." },
];

/**
 * v3: the final score against the AI-set bar (docs/ARCHITECTURE.md v3.3/v3.5). The bar is public: how hard the claim
 * is, why, and the line the evidence had to clear. The score is the scorer's baseline after any ladder checks.
 */
function ScoreVsBar({
  score,
  baseline,
  bar,
  rationale,
  factors,
  source,
  model,
  reasons,
  difficulty,
}: {
  score: number | null;
  baseline: number | null;
  bar: number;
  rationale: string | null;
  factors: string[];
  source: "ai" | "default" | null;
  model: string | null;
  reasons: string[];
  difficulty: number | null;
}) {
  const clears = score != null && score >= bar;
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  return (
    <article className={`opinion scorebar opinion-${score == null ? "meh" : clears ? "ok" : "bad"}`}>
      <header>
        <h3>Verification score vs the bar</h3>
        <p className="verdict">
          {score == null ? "not scored" : score.toFixed(2)}
          <span className="muted small"> needs {bar.toFixed(2)}</span>
        </p>
      </header>
      <div className="sb-meter" role="img" aria-label={`score ${score?.toFixed(2) ?? "none"}, bar ${bar.toFixed(2)}`}>
        {score != null && <span className="sb-fill" style={{ width: pct(score) }} />}
        {baseline != null && score != null && Math.abs(baseline - score) > 0.004 && <span className="sb-base" style={{ left: pct(baseline) }} title={`baseline ${baseline.toFixed(2)}`} />}
        <span className="sb-bar" style={{ left: pct(bar) }}>
          <span>bar</span>
        </span>
      </div>
      <p className="small">
        {source === "default" ? "Standard bar: no claim-specific bar was set." : rationale || "Set by AI from the structured claim."}
        {difficulty != null && source !== "default" && <span className="muted"> Difficulty {difficulty.toFixed(2)}.</span>}
      </p>
      {factors.length > 0 && (
        <ul className="tagrow" aria-label="What set the bar">
          {factors.map((f) => (
            <li key={f} className="tag tag-static">
              {f}
            </li>
          ))}
        </ul>
      )}
      {baseline != null && score != null && Math.abs(baseline - score) > 0.004 && (
        <p className="muted small">
          Baseline {baseline.toFixed(2)} from the scorer, {score > baseline ? "raised" : "lowered"} by the extra checks below.
        </p>
      )}
      {reasons.length > 0 && (
        <ul>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Score: P(claim true | evidence), assuming most submissions cheat (prior 0.2).{" "}
        {source === "ai" && model ? `Bar set by ${model} in a Cloud Function; code maps difficulty to 0.50–0.95.` : ""}
      </p>
    </article>
  );
}

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
  const [requested, setRequested] = useState<{ module: ModuleId; n: number } | null>(null);
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
  const barValue = moment?.bar?.value ?? moment?.verification?.bar ?? feed?.bar ?? null;
  const finalScore = moment?.verification?.score ?? feed?.verificationScore ?? moment?.score?.probability ?? null;
  const sealV3 = (moment?.seal?.version ?? feed?.sealVersion ?? 0) >= 3 || checks?.bar !== undefined;
  const sealReason = moment?.seal?.reason ?? feed?.sealReason ?? "Waiting for the seal.";
  // v4: claims (server, or the client draft before the seal), per-claim scores, video review.
  const sealV4 = (moment?.seal?.version ?? feed?.sealVersion ?? 0) >= 4;
  const ver = moment?.verification ?? null;
  const draftClaims = !moment?.seal ? intention.claims : null;
  const views = claimViews({
    claims: moment?.claims?.items ?? draftClaims ?? null,
    plan: moment?.plan ?? (draftClaims ? intention.plan : null) ?? null,
    scores: ver?.version === 4 ? ver.claims : null,
    bar: barValue,
    feedClaims: feed?.claims ?? null,
    feedPlan: feed?.plan ?? null,
  });
  const showClaims = views.length > 0 && (sealV4 || !moment?.seal);
  const cheatingSignals =
    moment?.seal?.checks.cheating === false ? (moment.seal.cheatingSignals ?? []) : feed?.cheating ? (feed.cheatingSignals ?? []) : null;
  const vr = moment?.videoReview ?? (feed?.video ? { status: feed.video.status } : null);
  // v4.6: modules back claims. Owner offers per claim, with that claim's previews.
  const isOwner = LADDER_DEMO || (!!user && !!moment && moment.ownerUid === user.uid);
  const eligible = !!moment?.seal?.ladderEligible && (moment.status === "sealed" || moment.status === "rejected");
  const v4Ladder: V4Ladder | null =
    sealV4 && moment?.claims?.items?.length && moment.plan && ver?.version === 4 && ver.claims
      ? { claims: moment.claims.items, requirements: moment.plan.requirements, scores: ver.claims, witness: factsOf(chunks ?? []).witness }
      : null;
  const claimOffers =
    v4Ladder && isOwner && eligible && !local
      ? offersV4({ ...v4Ladder, modules: ver?.modules ?? [] }, evidenceOf(chunks ?? [], intention), null)
      : null;
  // Only the owner, only when opened from their own Moments: never from the public feed.
  const deletable = canDeleteMoment({ fixtures: FIXTURES, uid: user?.uid, ownerUid: moment?.ownerUid, fromMe, id, recordingId: recordingMomentId() });

  const checkList = sealV4 ? CHECKS_V4 : sealV3 ? CHECKS_V3 : CHECKS;
  const passedChecks = checks ? checkList.filter((c) => checks[c.key]).length : 0;
  const shownScore = finalScore ?? moment?.score?.probability ?? feed?.verificationScore ?? null;

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
      {local && (
        <LocalBanner
          id={id}
          guest={guestLocal}
          finished={moment?.status === "submitted"}
          onUploaded={() => setReload((n) => n + 1)}
        />
      )}
      <p className="room-title">Evidence room</p>

      <section id="intent" className="room-wp room-intent" aria-labelledby="intent-h">
        <h2 id="intent-h" className="room-label">
          Intent <span>what {owner?.name ?? "they"} said they would do, before starting</span>
        </h2>
        <header className="detail-head">
          <div>
            <p className="cat">{intention.category}</p>
            <h1 className="room-intent-text">{intention.text}</h1>
            <p className="muted">
              {owner?.name ?? "You, as a guest"}, {ago(feed?.sealedAtServer ?? moment?.endedAt ?? null)}
              {moment?.device ? `, ${moment.device.model}` : ""}
            </p>
            <Chips platform={platform} mode={mode} />
          </div>
        </header>
      </section>

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
            {barValue != null && finalScore != null && (
              <div>
                <dt>score / bar</dt>
                <dd>
                  {finalScore.toFixed(2)}
                  <span className="dd-sub"> / {barValue.toFixed(2)}</span>
                </dd>
              </div>
            )}
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

        <MomentVideos momentId={id} ownerUid={moment?.ownerUid} review={moment?.videoReview} />

        {(local || (!!user && moment?.ownerUid === user.uid)) && <LocalClips momentId={id} chained={evidenceOf(chunks ?? [], null).videos} />}

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

      <section id="result" className="room-wp room-result" aria-labelledby="result-h">
        <h2 id="result-h" className="room-label">
          Result <span>AIs propose, a Cloud Function decides</span>
        </h2>
        <div className="room-verdict">
          {!pending && <Stamp sealed={sealed} size="lg" />}
          <div>
            <p className={`seal-reason ${sealed ? "" : "seal-reason-bad"}`}>{sealReason}</p>
            {checks && (
              <p className="muted small">
                {passedChecks} of {checkList.length} seal checks passed
                {shownScore != null ? `, ${Math.round(shownScore * 100)}% likely true` : ""}.
              </p>
            )}
          </div>
        </div>
        {showClaims && (
          <ClaimsPanel
            views={views}
            bar={barValue}
            score={sealV4 ? finalScore : null}
            verified={sealed}
            sealed={!pending && sealV4}
            claimsBacked={ver?.claimsBacked ?? feed?.claimsBacked ?? null}
            cheating={cheatingSignals}
            videoStatus={vr && vr.status !== "none" ? videoStatusText(vr) : null}
            videoSummary={moment?.videoReview?.summary || feed?.video?.summary || null}
            offers={
              claimOffers
                ? (claimId) => {
                    const rows = claimOffers.flatMap((o) =>
                      (o.state === "ready" || o.state === "blocked") && o.claims.some((c) => c.id === claimId) ? [{ o, c: o.claims.find((c) => c.id === claimId)! }] : [],
                    );
                    if (!rows.length) return null;
                    return (
                      <ul className="claim-offers" aria-label="Checks that can still back this claim">
                        {rows.map(({ o, c }) => (
                          <li key={o.module.id} className="claim-offer">
                            <span>
                              <strong>{o.module.title}</strong> · if it passes → <span className="up">{c.pass.toFixed(2)}</span> · if it fails →{" "}
                              <span className="down">{c.fail.toFixed(2)}</span>
                              {o.state === "blocked" && o.reason && <span className="claim-offer-why"> · {o.reason}</span>}
                            </span>
                            {o.state === "ready" && (
                              <button
                                type="button"
                                className="btn btn-small"
                                onClick={() => {
                                  setRequested((r) => ({ module: o.module.id, n: (r?.n ?? 0) + 1 }));
                                }}
                              >
                                Run · {o.module.cost} cr
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    );
                  }
                : undefined
            }
          />
        )}

        <section className="review" aria-labelledby="ai-h">
          <h2 id="ai-h">What the AIs said</h2>
          <div className="opinions">
            <Opinion who="Judge" o={moment?.judge ?? null} fallback={feed?.judgeReasons} />
            <Opinion who="Skeptic" o={moment?.skeptic ?? null} />
            {barValue != null ? (
              <ScoreVsBar
                score={finalScore}
                baseline={moment?.verification?.baselineUsed ?? moment?.verification?.baseline ?? feed?.baselineScore ?? moment?.score?.probability ?? null}
                bar={barValue}
                rationale={moment?.bar?.rationale ?? feed?.barRationale ?? null}
                factors={moment?.bar?.factors ?? []}
                source={moment?.bar?.source ?? (feed?.bar != null ? "ai" : null)}
                model={moment?.bar?.model ?? null}
                difficulty={moment?.bar?.difficulty ?? feed?.difficulty ?? null}
                reasons={moment?.score?.reasons ?? feed?.scoreReasons ?? []}
              />
            ) : (
              <ScoreCard
                probability={moment?.score?.probability ?? feed?.verificationScore ?? null}
                reasons={moment?.score?.reasons ?? feed?.scoreReasons ?? []}
              />
            )}
          </div>
        </section>

        {!local && (
          <Ladder
            momentId={id}
            ownerUid={moment?.ownerUid ?? null}
            isOwner={isOwner}
            eligible={eligible}
            v4={v4Ladder}
            requested={requested}
            score={finalScore}
            baseline={moment?.verification?.baselineUsed ?? moment?.verification?.baseline ?? feed?.baselineScore ?? null}
            bar={barValue}
            modules={moment?.verification?.modules ?? null}
            feedLadder={feed?.ladder}
            chunks={chunks}
            intention={intention}
            onRan={() => setReload((n) => n + 1)}
          />
        )}

        <section className="seal" aria-labelledby="seal-h">
          <div className="section-head">
            <h2 id="seal-h">Seal</h2>
            <p className="muted small">Written only by a Cloud Function. AI proposes; code decides.</p>
          </div>
          <p className={`seal-reason ${sealed ? "" : "seal-reason-bad"}`}>{sealReason}</p>
          {checks ? (
            <ul className="checklist">
              {(sealV4 ? CHECKS_V4 : sealV3 ? CHECKS_V3 : CHECKS).map((c) => (
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
      </section>
    </article>
  );
}
