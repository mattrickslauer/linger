// v4 claims and evidence plan (docs/ARCHITECTURE.md v4.1, v4.2, v4.11): the claim chips, the "To get this verified"
// checklist (interview end card, record screen, detail) and the evidence icons. Same words on every platform.
import type { Claim, EvidenceKind, Plan, Requirement } from "../v4";
import { EVIDENCE_LABEL, minText } from "../v4";
import { Glyph, KIND_GLYPH } from "../kit";

export function EvidenceIcon({ kind }: { kind: EvidenceKind }) {
  return (
    <svg viewBox="0 0 24 24" className="ev-icon" aria-hidden="true">
      {kind === "video" && (
        <>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10.5 21 7.5v9l-5-3z" />
        </>
      )}
      {kind === "frames" && (
        <>
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </>
      )}
      {kind === "gps" && (
        <>
          <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
          <circle cx="12" cy="10" r="2.3" />
        </>
      )}
      {kind === "motion" && <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />}
      {kind === "witness" && (
        <>
          <path d="M4 5h16v10H9l-5 4z" />
          <path d="M9 10h.01M12 10h.01M15 10h.01" />
        </>
      )}
    </svg>
  );
}

/** Claims as chips: `clapping` · `50 claps`. Removable on the interview end card. */
export function ClaimChips({ claims, onRemove, label = "Claims" }: { claims: Pick<Claim, "id" | "kind" | "text">[]; onRemove?: (id: string) => void; label?: string }) {
  if (!claims.length) return null;
  return (
    <ul className="claim-chips" aria-label={label}>
      {claims.map((c) => (
        <li key={c.id} className={`claim-chip kind-${c.kind}`}>
          <span className="claim-kind" title={c.kind}>
            <Glyph name={KIND_GLYPH[c.kind] ?? "intent"} />
            <span className="sr-only">{c.kind}</span>
          </span>
          <span>{c.text}</span>
          {onRemove && claims.length > 1 && (
            <button type="button" aria-label={`Remove ${c.text}`} onClick={() => onRemove(c.id)}>
              <Glyph name="close" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export type ReqState = "todo" | "captured" | "met" | "unmet";

/**
 * One row per requirement: evidence icon, `ask`, "≥ 20 s". `state` ticks it: the record screen says "captured"
 * (never "verified"), the detail says "met" / "not met" (the server decided).
 */
export function PlanList({
  requirements,
  state,
  claims,
  compact,
}: {
  requirements: Pick<Requirement, "id" | "claimId" | "evidence" | "ask" | "minSeconds">[];
  state?: (r: Pick<Requirement, "id">) => ReqState;
  claims?: Pick<Claim, "id" | "text">[];
  compact?: boolean;
}) {
  return (
    <ul className={`plan-list ${compact ? "plan-compact" : ""}`}>
      {requirements.map((r) => {
        const s = state?.(r) ?? "todo";
        const done = s === "captured" || s === "met";
        const claim = claims?.find((c) => c.id === r.claimId);
        return (
          <li key={r.id} className={`plan-row plan-${s}`}>
            <span className="plan-mark" aria-hidden="true">
              {done ? <Glyph name="check" /> : s === "unmet" ? <Glyph name="close" /> : null}
            </span>
            <EvidenceIcon kind={r.evidence} />
            <span className="plan-ask">
              {r.ask || EVIDENCE_LABEL[r.evidence]}
              {(minText(r) || claim) && (
                <span className="plan-sub">
                  {[EVIDENCE_LABEL[r.evidence], minText(r), claim ? `for “${claim.text}”` : ""].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            {state && (
              <span className={`plan-state ${done ? "ok" : ""}`}>
                {s === "captured" ? "captured" : s === "met" ? "✓ met" : s === "unmet" ? "not met" : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The interview end card's "To get this verified" block (also the typed path's preview). */
export function PlanCard({ claims, plan, onRemoveClaim }: { claims: Claim[]; plan: Plan | null | undefined; onRemoveClaim?: (id: string) => void }) {
  if (!claims.length) return null;
  return (
    <section className="plan-card" aria-labelledby="plan-h">
      <ClaimChips claims={claims} onRemove={onRemoveClaim} />
      <h2 id="plan-h" className="plan-h">
        To get this verified
      </h2>
      {plan?.requirements.length ? (
        <PlanList requirements={plan.requirements} claims={claims.length > 1 ? claims : undefined} />
      ) : (
        <p className="muted small">The Cloud Function adds the minimum evidence for each claim when you finish.</p>
      )}
      {plan?.note && <p className="small plan-note">{plan.note}</p>}
      {plan && (
        <p className="plan-mode small">
          <Glyph name={plan.recordMode === "video" ? "video" : "camera"} /> Records in <strong>{plan.recordMode === "video" ? "Video" : "Photo"}</strong> · free if nothing looks faked
        </p>
      )}
    </section>
  );
}
