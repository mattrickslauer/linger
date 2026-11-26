// Free demo credits (v3.6): a balance per user plus an append-only ledger, written ONLY by Cloud Functions.
// No Stripe in the hackathon build: 10 credits (ladder.json freeCredits) are granted once, on first use.
import { FieldValue, Firestore, Transaction } from "firebase-admin/firestore";
import { getLadder } from "./shared";

export interface CreditsDoc {
  balance: number;
  granted: number;
  spent: number;
}

export interface LedgerEntry {
  delta: number;
  kind: "grant" | "spend" | "refund" | "purchase" | "purchase_refund";
  reason: string;
  momentId: string | null;
  module: string | null;
  runId: string | null;
  balanceAfter: number;
}

export const creditsRef = (db: Firestore, uid: string) => db.collection("credits").doc(uid);
export const ledgerRef = (db: Firestore, uid: string, entryId: string) => creditsRef(db, uid).collection("ledger").doc(entryId);

/** Pure: the balance a user has, granting the free credits when there is no doc yet. */
export function withGrant(existing: Partial<CreditsDoc> | undefined, free = getLadder().freeCredits): { credits: CreditsDoc; justGranted: boolean } {
  if (existing) {
    return { credits: { balance: Number(existing.balance) || 0, granted: Number(existing.granted) || 0, spent: Number(existing.spent) || 0 }, justGranted: false };
  }
  return { credits: { balance: free, granted: free, spent: 0 }, justGranted: true };
}

/** Pure: debit (positive) or refund (negative) `cost`. Throws nothing; callers check the balance first. */
export function debit(c: CreditsDoc, cost: number): CreditsDoc {
  return { balance: c.balance - cost, granted: c.granted, spent: c.spent + cost };
}

export function entry(e: LedgerEntry) {
  return { ...e, atServer: FieldValue.serverTimestamp() };
}

/**
 * Writes the credits doc once per transaction (after all reads): the grant ledger entry when `justGranted`,
 * then the final balance. Each doc is written at most once per transaction.
 */
export function writeCredits(tx: Transaction, db: Firestore, uid: string, next: CreditsDoc, justGranted: boolean): void {
  const now = FieldValue.serverTimestamp();
  if (justGranted) {
    const free = next.granted;
    tx.set(ledgerRef(db, uid, "grant"), entry({ delta: free, kind: "grant", reason: "Free demo credits", momentId: null, module: null, runId: null, balanceAfter: free }));
    tx.set(creditsRef(db, uid), { ...next, createdAtServer: now, updatedAtServer: now });
  } else {
    tx.update(creditsRef(db, uid), { ...next, updatedAtServer: now });
  }
}
