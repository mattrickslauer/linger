// v4 detail (docs/ARCHITECTURE.md v4.11): the overall verdict on top, then one row per claim with its score against
// the bar, the requirements met / not met, which sources and modules back it, and (owner) the modules that can still
// back it with previews. All numbers here were written by Cloud Functions; the client only formats them.
import type { ReactNode } from "react";
import { moduleSpec } from "../ladder";
import type { ModuleId } from "../types";
import { SOURCE_LABEL, type ClaimView } from "../v4";
import { ClaimChips, PlanList } from "./Plan";
import { Glyph } from "../kit";

export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? moduleSpec(s as ModuleId)?.title ?? s;

export function backedByText(backedBy: string[]) {
  return backedBy.length ? `backed by ${backedBy.map(sourceLabel).join(", ")}` : "";
}

export default function ClaimsPanel({
  views,
  bar,
  score,
  verified,
  sealed,
  claimsBacked,
  cheating,
  videoStatus,
  videoSummary,
  offers,
}: {
  views: ClaimView[];
  bar: number | null;
  score: number | null;
  verified: boolean;
  /** a seal exists (verdict known) */
  sealed: boolean;
  claimsBacked: number | null;
  cheating: string[] | null;
  videoStatus: string | null;
  videoSummary: string | null;
  /** owner only: the modules that can still back this claim, with previews (rendered by the ladder) */
  offers?: (claimId: string) => ReactNode;
}) {
  if (!views.length) return null;
  const n = views.length;
  const k = claimsBacked ?? views.filter((v) => v.backed).length;
  return (
    <section className="claims-panel" aria-labelledby="claims-h">
      <header className={`cp-head ${!sealed ? "cp-wait" : verified ? "cp-ok" : "cp-bad"}`}>
        <span className="cp-glyph" aria-hidden="true">
          <Glyph name="intent" />
        </span>
        <div>
          <h2 id="claims-h" className="cp-verdict">
            {!sealed ? "Waiting for the seal" : verified ? "Verified ✓" : "Not verified"}
          </h2>
          <p className="cp-sub">
            {score != null && bar != null && (
              <span>
                score {score.toFixed(2)} · bar {bar.toFixed(2)}
              </span>
            )}
            {sealed && (
              <span className="cp-count">
                {k}/{n} claim{n > 1 ? "s" : ""} backed
              </span>
            )}
            {!sealed && bar != null && <span>bar {bar.toFixed(2)}</span>}
          </p>
        </div>
        {videoStatus && (
          <span className={`gchip cp-video ${videoStatus.startsWith("Video reviewed") ? "gchip-ok" : ""}`}>
            <Glyph name="video" />
            {videoStatus}
          </span>
        )}
      </header>
      {cheating && cheating.length > 0 && (
        <div className="cheat-banner" role="alert">
          <strong>
            <Glyph name="cheating" /> Cheating detected
          </strong>
          <ul>
            {cheating.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {videoSummary && (
        <p className="small cp-summary">
          <Glyph name="video" /> {videoSummary}
        </p>
      )}
      <ol className="claim-rows">
        {views.map((c) => {
          const state = c.p == null ? "wait" : c.backed ? "ok" : "bad";
          return (
            <li key={c.id} className={`claim-row cr-${state}`}>
              <div className="cr-head">
                <ClaimChips claims={[c]} label={`Claim ${c.id}`} />
                <p className="cr-score">
                  {c.p == null ? (
                    <span className="muted">not scored yet</span>
                  ) : c.backed ? (
                    <>
                      <span className="cr-mark" aria-hidden="true">
                        <Glyph name="check" />
                      </span>{" "}
                      {backedByText(c.backedBy) || "backed"}
                      <span className="muted"> · {c.p.toFixed(2)}</span>
                    </>
                  ) : (
                    <>
                      {c.p.toFixed(2)} <span className="muted">/ bar {bar?.toFixed(2) ?? "—"}</span>
                    </>
                  )}
                </p>
              </div>
              {c.p != null && bar != null && (
                <span className="cr-meter" role="img" aria-label={`${c.text}: ${c.p.toFixed(2)} against bar ${bar.toFixed(2)}`}>
                  <span className="cr-fill" style={{ width: `${Math.round(Math.min(1, c.p) * 1000) / 10}%` }} />
                  <span className="cr-bar" style={{ left: `${Math.round(bar * 1000) / 10}%` }} />
                </span>
              )}
              {!c.backed && c.backedBy.length > 0 && <p className="small muted">Partly {backedByText(c.backedBy)}.</p>}
              {c.requirements.length > 0 ? (
                <PlanList compact requirements={c.requirements} state={(r) => {
                  const m = c.requirements.find((x) => x.id === r.id)?.met;
                  return m == null ? "todo" : m ? "met" : "unmet";
                }} />
              ) : (
                <p className="small muted">No minimum evidence was set for this claim, so it can't reach the bar for free.</p>
              )}
              {offers?.(c.id)}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
