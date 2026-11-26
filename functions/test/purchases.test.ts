import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PayCheckout, PurchaseDoc, checkReturnUrl, packOf, planSettle, verifyPaySignature } from "../src/purchases";
import catalog from "../../shared/ladder.json";

const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("verifyPaySignature", () => {
  const body = JSON.stringify({ type: "checkout.completed" });
  it("accepts pay's sha256= HMAC of the raw body", () => {
    expect(verifyPaySignature(body, sign(body, "s3cret"), "s3cret")).toBe(true);
    expect(verifyPaySignature(Buffer.from(body), sign(body, "s3cret"), "s3cret")).toBe(true);
  });
  it("rejects a wrong secret, a changed body, a missing header or an empty secret", () => {
    expect(verifyPaySignature(body, sign(body, "other"), "s3cret")).toBe(false);
    expect(verifyPaySignature(body + " ", sign(body, "s3cret"), "s3cret")).toBe(false);
    expect(verifyPaySignature(body, undefined, "s3cret")).toBe(false);
    expect(verifyPaySignature(body, sign(body, ""), "")).toBe(false);
  });
});

describe("checkReturnUrl", () => {
  it("allows the project's Hosting origins and local dev, dropping a stale purchase param and the hash", () => {
    expect(checkReturnUrl("https://verified-99e74.web.app/m/abc?purchase=old#x", "verified-99e74")?.toString()).toBe("https://verified-99e74.web.app/m/abc");
    expect(checkReturnUrl("https://verified-99e74.firebaseapp.com/me", "verified-99e74")).not.toBeNull();
    expect(checkReturnUrl("http://localhost:5173/me", "verified-99e74")).not.toBeNull();
    expect(checkReturnUrl("https://app.example.com/me", "verified-99e74", "https://app.example.com")).not.toBeNull();
  });
  it("refuses other origins (no open redirect)", () => {
    expect(checkReturnUrl("https://evil.example/me", "verified-99e74")).toBeNull();
    expect(checkReturnUrl("https://verified-99e74.web.app.evil.example/", "verified-99e74")).toBeNull();
    expect(checkReturnUrl("http://verified-99e74.web.app/", "verified-99e74")).toBeNull();
    expect(checkReturnUrl("javascript:alert(1)", "verified-99e74")).toBeNull();
    expect(checkReturnUrl(42, "verified-99e74")).toBeNull();
  });
});

describe("packOf", () => {
  it("finds catalog packs only", () => {
    expect(catalog.creditPacks.length).toBeGreaterThan(0);
    for (const p of catalog.creditPacks) expect(packOf(p.id, catalog.creditPacks)).toEqual(p);
    expect(packOf("pack_free", catalog.creditPacks)).toBeNull();
    expect(packOf(undefined, catalog.creditPacks)).toBeNull();
  });
});

describe("planSettle", () => {
  const p = (over: Partial<PurchaseDoc> = {}): PurchaseDoc => ({ pack: "pack_10", credits: 10, amountCents: 500, checkoutId: "co_1", checkoutUrl: null, status: "open", ...over });
  const co = (over: Partial<PayCheckout> = {}): PayCheckout => ({ id: "co_1", status: "completed", amount_cents: 500, metadata: { app: "verified", uid: "u1", purchase_id: "p1" }, ...over });

  it("credits an open purchase once its checkout is completed", () => {
    expect(planSettle(p(), co(), "u1", "p1").action).toBe("credit");
    expect(planSettle(p(), co({ status: "partially_refunded" }), "u1", "p1").action).toBe("credit");
  });
  it("never credits twice", () => {
    expect(planSettle(p({ status: "paid" }), co(), "u1", "p1")).toEqual({ action: "none", reason: "already_paid" });
    expect(planSettle(p({ status: "refunded" }), co(), "u1", "p1").action).toBe("none");
  });
  it("does nothing until pay says it's paid", () => {
    for (const status of ["open", "awaiting_confirmation", "expired"]) expect(planSettle(p(), co({ status }), "u1", "p1").action).toBe("none");
  });
  it("takes a refunded pack back only if it was credited", () => {
    expect(planSettle(p({ status: "paid" }), co({ status: "refunded" }), "u1", "p1").action).toBe("claw_back");
    expect(planSettle(p(), co({ status: "refunded" }), "u1", "p1")).toEqual({ action: "none", reason: "refunded_unpaid" });
  });
  it("refuses a checkout that isn't this purchase's", () => {
    expect(planSettle(undefined, co(), "u1", "p1").reason).toBe("unknown_purchase");
    expect(planSettle(p(), co(), "u2", "p1").reason).toBe("metadata_mismatch");
    expect(planSettle(p(), co(), "u1", "p2").reason).toBe("metadata_mismatch");
    expect(planSettle(p(), co({ id: "co_other" }), "u1", "p1").reason).toBe("checkout_mismatch");
    expect(planSettle(p(), co({ amount_cents: 1 }), "u1", "p1").reason).toBe("amount_mismatch");
  });
});
