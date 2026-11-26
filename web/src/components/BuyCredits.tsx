// Buying credits through pay (pay.mattrickslauer.com). <BuyCredits> opens a sheet of packs; picking one asks the
// buyCredits Cloud Function for a pay checkout and goes there. pay sends the buyer back to the same page with
// ?purchase=<id>, where <PurchaseReturn> (mounted once in App) settles it and tells every balance on screen.

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { buyCredits, confirmPurchase, LADDER_DEMO, LadderError } from "../credits";
import { Glyph } from "../kit";
import { CREDIT_PACKS, fmtPrice, reasonText } from "../ladder";
import { isDeclined, requireSignIn } from "../signin";

export function BuyCredits({ label = "Buy credits", primary = false, className = "" }: { label?: string; primary?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function buy(packId: string) {
    setErr(null);
    setDone(null);
    try {
      if (!LADDER_DEMO) await requireSignIn("buy credits");
      setBusy(packId);
      const r = await buyCredits(packId);
      // "redirecting": the browser is leaving for pay; keep the spinner until it does.
      if (r === "simulated") {
        setBusy(null);
        setDone(`Added ${CREDIT_PACKS.find((p) => p.id === packId)?.credits ?? ""} credits (simulated, no payment).`);
      }
    } catch (e) {
      setBusy(null);
      if (isDeclined(e)) return;
      setErr(e instanceof LadderError ? reasonText(e.reason) : String((e as Error)?.message ?? e));
    }
  }

  const close = () => !busy && setOpen(false);
  return (
    <>
      <button type="button" className={`btn btn-small ${primary ? "btn-primary" : "btn-quiet"} ${className}`} onClick={() => (setErr(null), setDone(null), setOpen(true))}>
        <Glyph name="credits" /> {label}
      </button>
      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby="buy-h"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {open && (
          <div className="sheet-box">
            <h2 id="buy-h" className="run-h">
              <span className="offer-glyph" aria-hidden="true">
                <Glyph name="credits" />
              </span>
              Buy credits
            </h2>
            <p className="muted small">Credits run verification checks on your Moments. They don't expire.</p>
            <ul className="pack-list">
              {CREDIT_PACKS.map((p) => (
                <li key={p.id}>
                  <button type="button" className="pack" onClick={() => void buy(p.id)} disabled={!!busy} aria-busy={busy === p.id}>
                    <span className="pack-credits">
                      <strong>{p.credits}</strong> credits
                    </span>
                    <span className="pack-each muted small">{fmtPrice(Math.round(p.priceCents / p.credits))} each</span>
                    <span className="pack-price">{busy === p.id ? "Opening…" : fmtPrice(p.priceCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {LADDER_DEMO && <p className="notice small">Sample data: a purchase adds credits in this browser only. No payment is taken.</p>}
            {done && (
              <p className="notice notice-ok small" role="status">
                {done}
              </p>
            )}
            {err && <p className="notice notice-bad small">{err}</p>}
            <p className="muted small">
              Checkout is on <strong>pay.mattrickslauer.com</strong>: card, ACH or crypto. You come back here when it's done.
            </p>
            <div className="sheet-actions">
              <button type="button" className="btn btn-quiet" onClick={close} disabled={!!busy}>
                {done ? "Done" : "Cancel"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

type ReturnState = { kind: "checking" } | { kind: "ok"; credits: number; balance: number } | { kind: "pending" } | { kind: "bad"; text: string };

/** Pay's success redirect lands with ?purchase=<id>: settle it, say so, and drop the param from the address bar. */
export function PurchaseReturn({ user, ready }: { user: User | null; ready: boolean }) {
  const [purchaseId] = useState(() => new URLSearchParams(location.search).get("purchase"));
  const [state, setState] = useState<ReturnState | null>(purchaseId ? { kind: "checking" } : null);

  useEffect(() => {
    if (!purchaseId || !ready) return;
    const url = new URL(location.href);
    url.searchParams.delete("purchase");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    if (!user) {
      setState({ kind: "bad", text: "Sign in with the account that bought the credits to see them." });
      return;
    }
    let live = true;
    // Card payments are final on return; ACH and crypto take longer, so ask a few times, then leave it to the webhook.
    (async () => {
      for (let i = 0; i < 6 && live; i++) {
        try {
          const r = await confirmPurchase(purchaseId);
          if (!live) return;
          if (r.status === "paid") return setState({ kind: "ok", credits: r.credits, balance: r.balance });
          if (r.status === "refunded") return setState({ kind: "bad", text: "That payment was refunded, so no credits were added." });
        } catch (e) {
          if (!live) return;
          const le = e instanceof LadderError ? e : null;
          if (le?.reason !== "pay_unavailable") return setState({ kind: "bad", text: le ? reasonText(le.reason) : String(e) });
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (live) setState({ kind: "pending" });
    })();
    return () => {
      live = false;
    };
  }, [purchaseId, ready, user]);

  if (!state) return null;
  const text =
    state.kind === "checking"
      ? "Confirming your payment…"
      : state.kind === "ok"
        ? `Payment received: +${state.credits} credits. You now have ${state.balance}.`
        : state.kind === "pending"
          ? "Payment is still processing. Your credits are added automatically once it clears."
          : state.text;
  const tone = state.kind === "ok" ? "notice-ok" : state.kind === "bad" ? "notice-bad" : "";
  return (
    <div className={`notice purchase-toast ${tone}`} role="status" aria-live="polite">
      <Glyph name="credits" />
      <span>{text}</span>
      {state.kind !== "checking" && (
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setState(null)} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}
