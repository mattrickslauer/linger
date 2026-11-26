// The verification ladder on a Moment's detail page (docs/ARCHITECTURE.md v3.6).
// Public: every result that ran, with the score before → after. Owner only (seal.ladderEligible): the offer list with
// cost and both previews, run through the runLadderModule Cloud Function. Credits are spent either way.

import { useEffect, useMemo, useRef, useState } from "react";
import { getCredits, LADDER_DEMO, LadderError, newRequestId, runLadderModule, type Credits, type RunResult } from "../credits";
import { evidenceOf, fmtScore, offers, reasonText, type Offer } from "../ladder";
import { isDeclined, requireSignIn } from "../signin";
import type { Chunk, FeedLadderStep, Intention, LadderResult, ModuleId } from "../types";
import { offersV4, type OfferV4 } from "../ladder";
import type { Claim, ClaimScore, Requirement, WitnessFact } from "../v4";
import { Glyph, MODULE_GLYPH, Preview } from "../kit";

type Step = Pick<LadderResult, "module" | "title" | "passed" | "before" | "after" | "reasons"> & Partial<LadderResult>;

/** One rung: what ran, pass/fail, and how it moved the score. */
function Rung({ r, claimText }: { r: Step; claimText?: (id: string) => string | undefined }) {
  const up = r.after >= r.before;
  return (
    <li className={`rung ${r.passed ? "rung-pass" : "rung-fail"}`}>
      <span className="rung-mark" aria-hidden="true">
        <Glyph name={r.passed ? "check" : "close"} />
      </span>
      <div className="rung-body">
        <p className="rung-title">
          <Glyph name={MODULE_GLYPH[r.module] ?? "ladder"} />
          <strong>{r.title}</strong>
          <span className="rung-verdict">{r.passed ? "passed" : "failed"}</span>
          {r.confidence != null && <span className="muted small">confidence {Math.round(r.confidence * 100)}%</span>}
        </p>
        {r.reasons.length > 0 && <p className="small">{r.reasons[0]}</p>}
        {r.claims?.length ? (
          <ul className="rung-claims" aria-label="Per claim">
            {r.claims.map((c) => (
              <li key={c.id}>
                {c.passed ? "✓" : "✗"} {claimText?.(c.id) ?? c.id} {fmtScore(c.before)} → {fmtScore(c.after)}
                {c.verdict === "missing" ? " (no verdict)" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {r.measured?.length ? (
          <ul className="tagrow" aria-label="Measured">
            {r.measured.map((m, i) => (
              <li key={i}>
                {m.metric}: {m.value} {m.unit}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <span className={`rung-delta ${up ? "up" : "down"}`} aria-label={`score ${fmtScore(r.before)} to ${fmtScore(r.after)}`}>
        {fmtScore(r.before)} → <strong>{fmtScore(r.after)}</strong>
      </span>
    </li>
  );
}

export function LadderResults({ steps, claimText }: { steps: Step[]; claimText?: (id: string) => string | undefined }) {
  if (!steps.length) return null;
  return (
    <ol className="rungs" aria-label="Extra checks that ran">
      {steps.map((r, i) => (
        <Rung key={r.runId ?? i} r={r} claimText={claimText} />
      ))}
    </ol>
  );
}

interface Props {
  momentId: string;
  ownerUid: string | null;
  isOwner: boolean;
  eligible: boolean;
  score: number | null;
  baseline: number | null;
  bar: number | null;
  modules: LadderResult[] | null;
  feedLadder: FeedLadderStep[] | undefined;
  chunks: Chunk[] | null;
  intention: Intention;
  onRan: () => void;
  /** v4 Moments: server claims, plan, per-claim scores and the chain's witness facts; null = v3 math. */
  v4?: V4Ladder | null;
  /** A claim row asked to run this module: open its confirm sheet. `n` changes on every ask. */
  requested?: { module: ModuleId; n: number } | null;
}
export interface V4Ladder {
  claims: Claim[];
  requirements: Requirement[];
  scores: ClaimScore[];
  witness: WitnessFact[];
}

/** The public results plus, for the owner, the offers. Hidden entirely on Moments without a bar (pre-v3). */
export default function Ladder(p: Props) {
  const steps: Step[] = p.modules ?? p.feedLadder ?? [];
  const showOffers = p.isOwner && p.eligible && p.score != null && p.bar != null;
  if (p.bar == null || (!steps.length && !showOffers)) return null;
  return (
    <section className="ladder" aria-labelledby="ladder-h">
      <div className="section-head">
        <span className="ladder-title">
          <Glyph name="ladder" />
          <h2 id="ladder-h">Verification ladder</h2>
        </span>
        <p className="muted small">Extra checks; code moves the score</p>
      </div>
      <p className="ladder-head">
        {p.baseline != null && steps.length > 0 && (
          <>
            baseline <strong>{fmtScore(p.baseline)}</strong> ·{" "}
          </>
        )}
        score <strong>{fmtScore(p.score)}</strong> · bar <strong>{fmtScore(p.bar)}</strong>
        {p.score != null && <span className={`ladder-verdict ${p.score >= p.bar ? "ok" : "bad"}`}>{p.score >= p.bar ? "clears the bar" : "below the bar"}</span>}
      </p>
      <LadderResults steps={steps} claimText={(id) => p.v4?.claims.find((c) => c.id === id)?.text} />
      {showOffers && <Offers {...p} score={p.score!} bar={p.bar!} />}
    </section>
  );
}

function Offers(p: Props & { score: number; bar: number }) {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [creditErr, setCreditErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Offer | OfferV4 | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // One idempotency key per module attempt: a retry of the SAME module after a dropped connection reuses it, so it
  // can't charge twice. Keyed by module so an unsettled key is never sent with a different module.
  const requestId = useRef<{ module: string; id: string } | null>(null);

  useEffect(() => {
    let live = true;
    getCredits().then(
      (c) => live && setCredits(c),
      (e) => live && setCreditErr(e instanceof LadderError ? reasonText(e.reason) : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  const ev = useMemo(() => evidenceOf(p.chunks ?? [], p.intention), [p.chunks, p.intention]);
  const list: (Offer | OfferV4)[] = (
    p.v4 ? offersV4({ ...p.v4, modules: p.modules ?? [] }, ev, credits?.balance ?? null) : offers({ score: p.score, modules: p.modules ?? [] }, ev, credits?.balance ?? null)
  )
    .filter((o) => o.state !== "done")
    // v4.6: a module is offered only if it backs >= 1 of this Moment's claims (after backsTargetedOnly).
    .filter((o) => !("claims" in o) || o.claims.length > 0);

  // A claim row's "Run" opens the same confirm sheet.
  useEffect(() => {
    if (!p.requested) return;
    const o = list.find((x) => x.module.id === p.requested!.module);
    if (o && o.state === "ready") {
      setErr(null);
      setConfirm(o);
    } else if (o && o.state === "blocked") setErr(o.reason ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.requested?.n]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (confirm && !d.open) d.showModal();
    if (!confirm && d.open) d.close();
  }, [confirm]);

  async function run(o: Offer | OfferV4) {
    setErr(null);
    setResult(null);
    if (requestId.current?.module !== o.module.id) requestId.current = { module: o.module.id, id: newRequestId() };
    const rid = requestId.current.id;
    try {
      const u = LADDER_DEMO ? { uid: "demo" } : await requireSignIn("run a check");
      setRunning("Starting…");
      const clipSha = o.module.id === "full_video" ? ev.videos[ev.videos.length - 1] : undefined;
      const claimIds = "claims" in o ? o.claims.map((c) => c.id) : undefined;
      const r = await runLadderModule({ uid: u.uid, momentId: p.momentId, module: o.module.id, requestId: rid, clipSha, score: p.score, bar: p.bar, claimIds }, setRunning);
      requestId.current = null;
      setResult(r);
      setCredits((c) => (c ? { ...c, balance: r.balance, spent: c.spent + r.cost } : c));
      setConfirm(null);
      p.onRan();
    } catch (e) {
      if (isDeclined(e)) return setConfirm(null);
      const le = e instanceof LadderError ? e : null;
      // Settled failures were not charged (or were refunded; model_failed keeps answering for its key): a new attempt
      // gets a new key. A dropped connection ("unknown") or a run still in flight ("in_progress") keeps it, so the
      // retry returns that run's result instead of spending again.
      if (le && le.reason !== "unknown" && le.reason !== "in_progress") requestId.current = null;
      setErr(le ? reasonText(le.reason, le.details) : String((e as Error)?.message ?? e));
      if (le?.details.balance != null) setCredits((c) => (c ? { ...c, balance: le.details.balance! } : c));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="offers">
      <div className="offers-head">
        <h3>Raise your score</h3>
        <span className="credits" aria-live="polite">
          <Glyph name="credits" />
          {credits ? (
            <>
              <strong>{credits.balance}</strong> credit{credits.balance === 1 ? "" : "s"}
              {credits.justGranted && <span className="muted small"> · {credits.granted} free to start</span>}
            </>
          ) : creditErr ? (
            <span className="muted small">credits unavailable</span>
          ) : (
            <span className="muted small">loading credits…</span>
          )}
        </span>
      </div>
      {LADDER_DEMO && <p className="notice small">Sample data: runs are simulated in this browser with the real ladder math. No credits are spent.</p>}
      {result && (
        <p className={`notice small ${result.passed ? "notice-ok" : "notice-bad"}`} role="status">
          {result.passed ? "Passed" : "Failed"}: score {fmtScore(result.before)} → {fmtScore(result.after)}.{" "}
          {result.verified ? "It clears the bar." : `Still below the bar (${fmtScore(result.bar)}).`}
        </p>
      )}
      {err && !confirm && <p className="notice notice-bad small">{err}</p>}
      <ul className="offer-list">
        {list.map((o) => (
          <li key={o.module.id} className={`offer offer-${o.state}`}>
            <div className="offer-main">
              <p className="offer-title">
                <span className="offer-glyph" aria-hidden="true">
                  <Glyph name={MODULE_GLYPH[o.module.id] ?? "ladder"} />
                </span>
                <strong>{o.module.title}</strong>
                <span className="offer-cost">
                  <Glyph name="credits" />
                  {o.module.cost} cr
                </span>
              </p>
              <p className="muted small offer-blurb">{o.module.blurb}</p>
              {"claims" in o && o.claims.length > 0 && (
                <p className="small offer-claims">
                  Backs {o.claims.map((c) => `${c.text} ${fmtScore(c.p)} → ${fmtScore(c.pass)} / ${fmtScore(c.fail)}`).join(" · ")}
                </p>
              )}
              {o.state === "blocked" && <p className="small offer-why">{o.reason}</p>}
            </div>
            {o.state === "soon" || o.state === "done" ? (
              <span className="chip">coming soon</span>
            ) : (
              <div className="offer-side">
                <Preview from={p.score} pass={o.pass} fail={o.fail} bar={p.bar} className="offer-preview" />
                <button className="btn btn-small btn-primary" disabled={o.state !== "ready" || !!running || !credits} onClick={() => (setErr(null), setConfirm(o))}>
                  Run
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">Modules that fail lower the score. Credits are spent either way. Each check runs once per Moment.</p>

      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby="run-h"
        onCancel={(e) => {
          e.preventDefault();
          if (!running) setConfirm(null);
        }}
        onClick={(e) => e.target === e.currentTarget && !running && setConfirm(null)}
      >
        {confirm && confirm.state !== "done" && confirm.state !== "soon" && (
          <div className="sheet-box">
            <h2 id="run-h" className="run-h">
              <span className="offer-glyph" aria-hidden="true">
                <Glyph name={MODULE_GLYPH[confirm.module.id] ?? "ladder"} />
              </span>
              Run {confirm.module.title}?
            </h2>
            <Preview from={p.score} pass={confirm.pass} fail={confirm.fail} bar={p.bar} className="run-preview" />
            <p className="muted">{confirm.module.blurb}</p>
            {"claims" in confirm && (
              <ul className="run-claims small">
                {confirm.claims.map((c) => (
                  <li key={c.id}>
                    <strong>{c.text}</strong> {fmtScore(c.p)} → <span className="up">{fmtScore(c.pass)}</span> if it passes ·{" "}
                    <span className="down">{fmtScore(c.fail)}</span> if it fails
                  </li>
                ))}
              </ul>
            )}
            <dl className="run-math">
              <div>
                <dt>cost</dt>
                <dd>
                  {confirm.module.cost} credit{confirm.module.cost > 1 ? "s" : ""}
                </dd>
              </div>
              <div>
                <dt>if it passes</dt>
                <dd className="up">
                  {fmtScore(p.score)} → {fmtScore(confirm.pass)}
                  {confirm.pass >= p.bar && p.score < p.bar ? " ✓ clears" : ""}
                </dd>
              </div>
              <div>
                <dt>if it fails</dt>
                <dd className="down">
                  {fmtScore(p.score)} → {fmtScore(confirm.fail)}
                  {confirm.fail < p.bar && p.score >= p.bar ? " ✗ drops below" : ""}
                </dd>
              </div>
            </dl>
            <p className="small muted">
              The result is public on this Moment. Credits are spent whether it passes or fails.
            </p>
            {err && <p className="notice notice-bad small">{err}</p>}
            <div className="sheet-actions">
              <button className="btn btn-primary" onClick={() => void run(confirm)} disabled={!!running} autoFocus>
                {running ?? `Spend ${confirm.module.cost} credit${confirm.module.cost > 1 ? "s" : ""}`}
              </button>
              <button className="btn btn-quiet" onClick={() => setConfirm(null)} disabled={!!running}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
