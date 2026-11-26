// Buying credits through pay (pay.mattrickslauer.com, the operator's own payments harness: card, ACH, crypto…).
//
// buyCredits      → writes credits/{uid}/purchases/{purchaseId} (status "open") and opens a pay checkout whose
//                   metadata carries { app: "verified", uid, purchase_id, pack }. The buyer pays on pay's hosted page.
// payWebhook      → pay POSTs signed events (X-Pay-Signature: sha256=HMAC(raw body)); checkout.completed credits
//                   the pack, checkout.refunded takes it back.
// confirmCreditPurchase → the success_url lands back with ?purchase=<id>; the client asks the function to look the
//                   checkout up on pay (server to server, API key), so credits arrive even if the webhook is late.
//
// Both paths go through settlePurchase, one transaction keyed by purchaseId: a pack is credited at most once and
// taken back at most once, whichever path gets there first. Clients can read purchases but never write them.
import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue, Firestore } from "firebase-admin/firestore";
import { CreditsDoc, creditsRef, entry, ledgerRef, withGrant, writeCredits } from "./credits";
import { CreditPack, getLadder } from "./shared";

export const DEFAULT_PAY_BASE = "https://pay.mattrickslauer.com";

export type PurchaseStatus = "open" | "paid" | "refunded";

export interface PurchaseDoc {
  pack: string;
  credits: number;
  amountCents: number;
  checkoutId: string | null;
  checkoutUrl: string | null;
  status: PurchaseStatus;
}

/** The fields of pay's public checkout view (GET /api/v1/checkouts/:id and webhook data.checkout) used here. */
export interface PayCheckout {
  id: string;
  url?: string;
  status: string;
  amount_cents: number;
  metadata?: Record<string, string>;
}

export const purchaseRef = (db: Firestore, uid: string, purchaseId: string) => creditsRef(db, uid).collection("purchases").doc(purchaseId);

export function packOf(id: unknown, packs: CreditPack[] = getLadder().creditPacks ?? []): CreditPack | null {
  return packs.find((p) => p.id === id) ?? null;
}

/** pay's webhook signature: `sha256=<hex HMAC-SHA256(raw body, endpoint secret)>`, compared in constant time. */
export function verifyPaySignature(rawBody: Buffer | string, header: unknown, secret: string): boolean {
  if (!secret) return false;
  const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(String(header ?? ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Where pay may send the buyer back to. Only this app's own origins (Hosting for the project, local dev, plus any
 * PAY_RETURN_ORIGINS), so a caller can't turn the checkout into an open redirect. Returns the URL without its
 * `purchase` param, or null.
 */
export function checkReturnUrl(raw: unknown, project: string | undefined, extra = ""): URL | null {
  if (typeof raw !== "string" || raw.length > 1500) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const allowed = new Set(
    [project ? `https://${project}.web.app` : "", project ? `https://${project}.firebaseapp.com` : "", ...extra.split(",")].map((s) => s.trim()).filter(Boolean),
  );
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (!allowed.has(u.origin) && !local) return null;
  u.searchParams.delete("purchase");
  u.hash = "";
  return u;
}

export type SettleAction = { action: "credit" | "claw_back" | "none"; reason: string };

/** Pure: what a pay checkout state means for this purchase. Never credits twice, never takes back what wasn't given. */
export function planSettle(p: PurchaseDoc | undefined, co: PayCheckout, uid: string, purchaseId: string): SettleAction {
  if (!p) return { action: "none", reason: "unknown_purchase" };
  const md = co.metadata ?? {};
  if (md.uid !== uid || md.purchase_id !== purchaseId) return { action: "none", reason: "metadata_mismatch" };
  if (p.checkoutId && co.id !== p.checkoutId) return { action: "none", reason: "checkout_mismatch" };
  if (co.amount_cents !== p.amountCents) return { action: "none", reason: "amount_mismatch" };
  const refunded = co.status === "refunded";
  const paid = co.status === "completed" || co.status === "partially_refunded";
  if (paid && p.status === "open") return { action: "credit", reason: "paid" };
  if (refunded && p.status === "paid") return { action: "claw_back", reason: "refunded" };
  // Refunded before we ever saw it paid: mark it closed so a late "completed" can't credit it.
  if (refunded && p.status === "open") return { action: "none", reason: "refunded_unpaid" };
  return { action: "none", reason: p.status === "open" ? `checkout_${co.status}` : `already_${p.status}` };
}

export interface SettleResult {
  status: PurchaseStatus;
  credited: boolean;
  balance: number;
  reason: string;
}

/** One transaction: applies planSettle to the purchase, the balance and the ledger. Idempotent per purchaseId. */
export async function settlePurchase(db: Firestore, uid: string, purchaseId: string, co: PayCheckout): Promise<SettleResult> {
  return db.runTransaction(async (tx) => {
    const pRef = purchaseRef(db, uid, purchaseId);
    const [ps, cs] = await Promise.all([tx.get(pRef), tx.get(creditsRef(db, uid))]);
    const p = ps.exists ? (ps.data() as PurchaseDoc) : undefined;
    const plan = planSettle(p, co, uid, purchaseId);
    const { credits, justGranted } = withGrant(cs.exists ? (cs.data() as CreditsDoc) : undefined);
    const now = FieldValue.serverTimestamp();
    if (!p || plan.action === "none") {
      if (p && plan.reason === "refunded_unpaid") tx.update(pRef, { status: "refunded", checkoutStatus: co.status, updatedAtServer: now });
      return { status: plan.reason === "refunded_unpaid" ? "refunded" : (p?.status ?? "open"), credited: false, balance: credits.balance, reason: plan.reason };
    }
    const delta = plan.action === "credit" ? p.credits : -p.credits;
    // Purchased credits count as granted (granted - spent = balance stays true); a claw-back may leave it negative.
    const next: CreditsDoc = { balance: credits.balance + delta, granted: credits.granted + delta, spent: credits.spent };
    writeCredits(tx, db, uid, next, justGranted);
    tx.set(
      ledgerRef(db, uid, plan.action === "credit" ? `purchase_${purchaseId}` : `purchase_refund_${purchaseId}`),
      entry({
        delta,
        kind: plan.action === "credit" ? "purchase" : "purchase_refund",
        reason: plan.action === "credit" ? `Bought ${p.credits} credits` : `Refund of ${p.credits} credits`,
        momentId: null,
        module: null,
        runId: co.id,
        balanceAfter: next.balance,
      }),
    );
    const status: PurchaseStatus = plan.action === "credit" ? "paid" : "refunded";
    tx.update(pRef, { status, checkoutId: co.id, checkoutStatus: co.status, updatedAtServer: now, ...(status === "paid" ? { paidAtServer: now } : { refundedAtServer: now }) });
    return { status, credited: plan.action === "credit", balance: next.balance, reason: plan.reason };
  });
}

// ───────────────────────────────── pay App API (README "App API" in the pay repo)

export class PayError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function payFetch<T>(base: string, key: string, path: string, init: { method: string; body?: unknown }): Promise<T> {
  const r = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new PayError(r.status, err?.code ?? "PAY_HTTP", err?.message ?? `pay answered ${r.status}`);
  }
  return json as T;
}

export function createPayCheckout(
  base: string,
  key: string,
  b: { amount_cents: number; description: string; success_url: string; cancel_url: string; metadata: Record<string, string> },
): Promise<PayCheckout & { url: string }> {
  return payFetch(base, key, "/api/v1/checkouts", { method: "POST", body: b });
}

export function getPayCheckout(base: string, key: string, id: string): Promise<PayCheckout> {
  return payFetch(base, key, `/api/v1/checkouts/${encodeURIComponent(id)}`, { method: "GET" });
}
