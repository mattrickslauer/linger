// Security rules tests. Run against the Firestore emulator:
//   npm run test:rules   (from repo root; wraps `firebase emulators:exec --only firestore`)
import { readFileSync } from "node:fs";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT = "demo-verified-rules";
let env: RulesTestEnvironment;

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host, port: Number(port) },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

const alice = () => env.authenticatedContext("alice").firestore();
const bob = () => env.authenticatedContext("bob").firestore();
const anon = () => env.unauthenticatedContext().firestore();

function newMoment(owner = "alice", over: Record<string, unknown> = {}) {
  return {
    ownerUid: owner,
    owner: { name: owner, photoURL: null },
    intention: { text: "Catch a bass", category: "fishing" },
    platform: "web",
    device: { model: "test", os: "test", appVersion: "0" },
    status: "recording",
    startedAt: 1,
    endedAt: null,
    chunkCount: 0,
    headHash: null,
    summary: null,
    onDevice: { mode: "none", checks: 0, retakes: 0 },
    judge: null,
    skeptic: null,
    seal: null,
    ...over,
  };
}
const chunk = (seq: number) => ({ seq, t0: 0, t1: 1, prevHash: "x", payload: "{}", hash: "y", frame: null });

/** Seed bypassing rules. */
async function admin(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe("moments", () => {
  it("owner can create a recording moment", async () => {
    await assertSucceeds(setDoc(doc(alice(), "moments/m1"), newMoment()));
  });
  it("cannot create for someone else, with a seal, or not recording", async () => {
    await assertFails(setDoc(doc(alice(), "moments/m1"), newMoment("bob")));
    await assertFails(setDoc(doc(alice(), "moments/m1"), newMoment("alice", { seal: { sealed: true } })));
    await assertFails(setDoc(doc(alice(), "moments/m1"), newMoment("alice", { status: "sealed" })));
    await assertFails(setDoc(doc(anon(), "moments/m1"), newMoment()));
  });
  it("owner can submit and then write judge/skeptic", async () => {
    await admin("moments/m1", newMoment());
    await assertSucceeds(updateDoc(doc(alice(), "moments/m1"), { status: "submitted", chunkCount: 3, headHash: "h" }));
    await assertSucceeds(updateDoc(doc(alice(), "moments/m1"), { judge: { verdict: "consistent" }, skeptic: { verdict: "consistent" } }));
  });
  it("owner cannot write seal or set status sealed/rejected or go back", async () => {
    await admin("moments/m1", newMoment());
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { seal: { sealed: true } }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { status: "sealed" }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { status: "rejected" }));
    await admin("moments/m2", newMoment("alice", { status: "submitted" }));
    await assertFails(updateDoc(doc(alice(), "moments/m2"), { status: "recording" }));
  });
  it("nobody can update a sealed moment or change owner", async () => {
    await admin("moments/m1", newMoment("alice", { status: "sealed", seal: { sealed: true } }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { intention: { text: "x", category: "other" } }));
    await admin("moments/m2", newMoment());
    await assertFails(updateDoc(doc(alice(), "moments/m2"), { ownerUid: "bob" }));
    await assertFails(updateDoc(doc(bob(), "moments/m2"), { status: "submitted" }));
  });
  it("only the owner can delete a moment, in any status", async () => {
    await admin("moments/m1", newMoment());
    await assertFails(deleteDoc(doc(bob(), "moments/m1")));
    await assertFails(deleteDoc(doc(anon(), "moments/m1")));
    await assertSucceeds(deleteDoc(doc(alice(), "moments/m1")));
    await admin("moments/m3", newMoment("alice", { status: "sealed" }));
    await assertFails(deleteDoc(doc(bob(), "moments/m3")));
    await assertSucceeds(deleteDoc(doc(alice(), "moments/m3")));
  });
  it("deleted/ tombstones: owner reads, others don't, nobody writes; unknown ids are readable as absent", async () => {
    await admin("deleted/m9", { ownerUid: "alice", deletedAt: 1 });
    await assertSucceeds(getDoc(doc(alice(), "deleted/m9")));
    await assertFails(getDoc(doc(bob(), "deleted/m9")));
    await assertSucceeds(getDoc(doc(bob(), "deleted/never-existed")));
    await assertFails(setDoc(doc(alice(), "deleted/m10"), { ownerUid: "alice" }));
    await assertFails(deleteDoc(doc(alice(), "deleted/m9")));
  });
  it("others cannot read a recording/submitted moment; owner can", async () => {
    await admin("moments/m1", newMoment());
    await admin("moments/m2", newMoment("alice", { status: "submitted" }));
    await assertSucceeds(getDoc(doc(alice(), "moments/m1")));
    await assertFails(getDoc(doc(bob(), "moments/m1")));
    await assertFails(getDoc(doc(anon(), "moments/m2")));
  });
  it("public can read sealed and rejected moments", async () => {
    await admin("moments/m1", newMoment("alice", { status: "sealed" }));
    await admin("moments/m2", newMoment("alice", { status: "rejected" }));
    await assertSucceeds(getDoc(doc(anon(), "moments/m1")));
    await assertSucceeds(getDoc(doc(bob(), "moments/m2")));
  });
  it("owner can list own moments by ownerUid + startedAt", async () => {
    await admin("moments/m1", newMoment());
    await assertSucceeds(getDocs(query(collection(alice(), "moments"), where("ownerUid", "==", "alice"), orderBy("startedAt", "desc"))));
    await assertFails(getDocs(query(collection(bob(), "moments"), where("ownerUid", "==", "alice"))));
  });
});

describe("chunks", () => {
  it("owner can create chunks while recording", async () => {
    await admin("moments/m1", newMoment());
    await assertSucceeds(setDoc(doc(alice(), "moments/m1/chunks/000000"), chunk(0)));
    await assertSucceeds(setDoc(doc(alice(), "moments/m1/chunks/000001"), chunk(1)));
  });
  it("doc id must equal seq", async () => {
    await admin("moments/m1", newMoment());
    await assertFails(setDoc(doc(alice(), "moments/m1/chunks/000005"), chunk(4)));
  });
  it("others cannot write chunks", async () => {
    await admin("moments/m1", newMoment());
    await assertFails(setDoc(doc(bob(), "moments/m1/chunks/000000"), chunk(0)));
    await assertFails(setDoc(doc(anon(), "moments/m1/chunks/000000"), chunk(0)));
  });
  it("offline tail: submitted allows seq < chunkCount only", async () => {
    await admin("moments/m1", newMoment("alice", { status: "submitted", chunkCount: 3 }));
    await assertSucceeds(setDoc(doc(alice(), "moments/m1/chunks/000002"), chunk(2)));
    await assertFails(setDoc(doc(alice(), "moments/m1/chunks/000003"), chunk(3)));
  });
  it("chunks are append-only and closed once sealed", async () => {
    await admin("moments/m1", newMoment());
    await admin("moments/m1/chunks/000000", chunk(0));
    await assertFails(setDoc(doc(alice(), "moments/m1/chunks/000000"), chunk(0)));
    await assertFails(deleteDoc(doc(alice(), "moments/m1/chunks/000000")));
    await admin("moments/m2", newMoment("alice", { status: "sealed" }));
    await assertFails(setDoc(doc(alice(), "moments/m2/chunks/000000"), chunk(0)));
  });
  it("chunk reads follow the parent", async () => {
    await admin("moments/m1", newMoment());
    await admin("moments/m1/chunks/000000", chunk(0));
    await admin("moments/m2", newMoment("alice", { status: "sealed" }));
    await admin("moments/m2/chunks/000000", chunk(0));
    await assertSucceeds(getDoc(doc(alice(), "moments/m1/chunks/000000")));
    await assertFails(getDoc(doc(bob(), "moments/m1/chunks/000000")));
    await assertFails(getDocs(collection(anon(), "moments/m1/chunks")));
    await assertSucceeds(getDocs(collection(anon(), "moments/m2/chunks")));
  });
});

describe("v3: server-only fields, frozen intention, guest claim", () => {
  const structured = {
    text: "Catch a 10 lb largemouth bass at Lake Mission Viejo",
    category: "fishing",
    v: 3,
    activity: "fishing",
    goal: "catch a largemouth bass",
    quantities: [{ metric: "weight", value: 10, unit: "lb", measuredBy: "scale" }],
    place: { name: "Lake Mission Viejo", lat: 33.6, lng: -117.6, region: "California", country: "US" },
    window: { start: 1, expectedMinutes: 120 },
    conditions: ["autumn"],
    assumptions: ["species from local lake"],
    interview: { turns: 2, mode: "on_device" },
    preview: { bar: 0.73, difficulty: 0.5, mode: "on_device" },
  };
  it("create may carry bar/verification only as null; a structured intention is fine", async () => {
    await assertSucceeds(setDoc(doc(alice(), "moments/m1"), newMoment("alice", { intention: structured, bar: null, verification: null })));
    await assertFails(setDoc(doc(alice(), "moments/m2"), newMoment("alice", { bar: { value: 0.5 } })));
    await assertFails(setDoc(doc(alice(), "moments/m3"), newMoment("alice", { verification: { score: 1 } })));
  });
  it("owner can never write bar or verification", async () => {
    await admin("moments/m1", newMoment());
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { bar: { value: 0.5, difficulty: 0 } }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { verification: { score: 0.99 } }));
    await admin("moments/m2", newMoment("alice", { status: "submitted", bar: { value: 0.8 } }));
    await assertFails(updateDoc(doc(alice(), "moments/m2"), { bar: { value: 0.5 } }));
    await assertFails(updateDoc(doc(alice(), "moments/m2"), { bar: null }));
  });
  it("intention is editable while recording, may ride the submit update, then is frozen", async () => {
    await admin("moments/m1", newMoment());
    await assertSucceeds(updateDoc(doc(alice(), "moments/m1"), { intention: structured }));
    await assertSucceeds(updateDoc(doc(alice(), "moments/m1"), { status: "submitted", chunkCount: 1, headHash: "h", intention: { ...structured, conditions: ["dusk"] } }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { intention: { text: "x", category: "other" } }));
    // judge/skeptic/score after submit still work
    await assertSucceeds(updateDoc(doc(alice(), "moments/m1"), { judge: { verdict: "consistent" }, skeptic: { verdict: "consistent" }, score: { probability: 0.6, reasons: [] } }));
  });
  it("guests (signed out) cannot write moments or chunks, but can read the public feed and sealed posts", async () => {
    await assertFails(setDoc(doc(anon(), "moments/g1"), newMoment("guest")));
    await admin("moments/m1", newMoment("alice", { status: "sealed", bar: { value: 0.8 }, verification: { score: 0.83 } }));
    await admin("moments/m1/chunks/000000", chunk(0));
    await admin("feed/m1", { status: "sealed", bar: 0.8, finalScore: 0.83 });
    await assertSucceeds(getDoc(doc(anon(), "moments/m1")));
    await assertSucceeds(getDocs(collection(anon(), "moments/m1/chunks")));
    await assertSucceeds(getDoc(doc(anon(), "feed/m1")));
  });
  it("claim on upload: a guest Moment recorded earlier uploads through the normal path under the new uid", async () => {
    const claimed = newMoment("alice", { startedAt: 1000, recordedAsGuest: true, claimedAt: 999999, intention: structured });
    await assertSucceeds(setDoc(doc(alice(), "moments/g1"), claimed));
    await assertSucceeds(setDoc(doc(alice(), "moments/g1/chunks/000000"), chunk(0)));
    await assertSucceeds(setDoc(doc(alice(), "moments/g1/chunks/000001"), chunk(1)));
    await assertSucceeds(updateDoc(doc(alice(), "moments/g1"), { status: "submitted", chunkCount: 2, headHash: "h", endedAt: 2000 }));
    await assertFails(setDoc(doc(bob(), "moments/g2"), newMoment("alice", { recordedAsGuest: true })));
  });
});

describe("v3: credits", () => {
  it("owner reads their balance and ledger; nobody else; nobody writes", async () => {
    await admin("credits/alice", { balance: 10, granted: 10, spent: 0 });
    await admin("credits/alice/ledger/e1", { delta: 10, kind: "grant", reason: "free demo credits", balanceAfter: 10 });
    await assertSucceeds(getDoc(doc(alice(), "credits/alice")));
    await assertSucceeds(getDocs(collection(alice(), "credits/alice/ledger")));
    await assertFails(getDoc(doc(bob(), "credits/alice")));
    await assertFails(getDocs(collection(bob(), "credits/alice/ledger")));
    await assertFails(getDoc(doc(anon(), "credits/alice")));
    await assertFails(setDoc(doc(alice(), "credits/alice"), { balance: 1000 }));
    await assertFails(updateDoc(doc(alice(), "credits/alice"), { balance: 1000 }));
    await assertFails(setDoc(doc(alice(), "credits/alice/ledger/e2"), { delta: 1000, kind: "grant" }));
    await assertFails(deleteDoc(doc(alice(), "credits/alice/ledger/e1")));
    await assertFails(setDoc(doc(alice(), "credits/bob"), { balance: 10 }));
  });
  it("credit purchases (pay): owner reads, nobody writes (only the functions mark a pack paid)", async () => {
    await admin("credits/alice/purchases/p1", { pack: "pack_10", credits: 10, amountCents: 500, checkoutId: "co_1", status: "open" });
    await assertSucceeds(getDoc(doc(alice(), "credits/alice/purchases/p1")));
    await assertSucceeds(getDocs(collection(alice(), "credits/alice/purchases")));
    await assertFails(getDoc(doc(bob(), "credits/alice/purchases/p1")));
    await assertFails(getDoc(doc(anon(), "credits/alice/purchases/p1")));
    await assertFails(updateDoc(doc(alice(), "credits/alice/purchases/p1"), { status: "paid" }));
    await assertFails(setDoc(doc(alice(), "credits/alice/purchases/p2"), { pack: "pack_100", credits: 100, amountCents: 1, status: "open" }));
    await assertFails(deleteDoc(doc(alice(), "credits/alice/purchases/p1")));
  });
  it("barLeases (server-only bar-agent lease): no client reads or writes, guests included", async () => {
    await admin("barLeases/m1", { at: 1 });
    await assertFails(getDoc(doc(alice(), "barLeases/m1")));
    await assertFails(getDoc(doc(anon(), "barLeases/m1")));
    await assertFails(setDoc(doc(alice(), "barLeases/m2"), { at: 1 }));
    await assertFails(deleteDoc(doc(alice(), "barLeases/m1")));
  });
  it("guests write nothing anywhere a signed-in user could", async () => {
    await assertFails(setDoc(doc(anon(), "credits/x"), { balance: 10 }));
    await assertFails(setDoc(doc(anon(), "users/x"), { displayName: "Guest" }));
    await assertFails(setDoc(doc(anon(), "moments/g1"), { ownerUid: null, status: "recording", guest: true }));
    await assertFails(setDoc(doc(anon(), "feed/g1"), { status: "sealed" }));
  });
});

describe("v4: claims, plan, videoReview server-only; draft claims/plan inside the intention", () => {
  const claims = [
    { id: "c1", kind: "action", text: "clapping" },
    { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
  ];
  const plan = {
    requirements: [
      { id: "r1", claimId: "c1", evidence: "video", ask: "Clap on camera" },
      { id: "r2", claimId: "c2", evidence: "video", ask: "One continuous video of all 50 claps", minSeconds: 20 },
    ],
    recordMode: "video",
    note: "One continuous clip is enough.",
  };
  const v4intention = { text: "Clap 50 times", category: "fitness", v: 4, claims, plan };

  it("create may carry claims/plan/videoReview only as null; draft claims + plan in the intention are fine", async () => {
    await assertSucceeds(setDoc(doc(alice(), "moments/m1"), newMoment("alice", { intention: v4intention, claims: null, plan: null, videoReview: null })));
    await assertFails(setDoc(doc(alice(), "moments/m2"), newMoment("alice", { claims: { items: claims } })));
    await assertFails(setDoc(doc(alice(), "moments/m3"), newMoment("alice", { plan })));
    await assertFails(setDoc(doc(alice(), "moments/m4"), newMoment("alice", { videoReview: { status: "done" } })));
  });
  it("owner can never write claims, plan or videoReview, before or after submit", async () => {
    await admin("moments/m1", newMoment());
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { claims: { items: claims } }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { plan }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { videoReview: { status: "none" } }));
    await admin("moments/m2", newMoment("alice", { status: "submitted", claims: { items: claims }, plan, videoReview: { status: "waiting" } }));
    await assertFails(updateDoc(doc(alice(), "moments/m2"), { claims: null }));
    await assertFails(updateDoc(doc(alice(), "moments/m2"), { plan: { ...plan, requirements: [] } }));
    await assertFails(updateDoc(doc(alice(), "moments/m2"), { videoReview: { status: "expired" } }));
    // the cloud review still works after submit
    await assertSucceeds(updateDoc(doc(alice(), "moments/m2"), { judge: { verdict: "consistent", claims: [{ id: "c1", verdict: "backed", confidence: 0.8 }] }, skeptic: { verdict: "consistent" } }));
  });
  it("intention.claims / intention.plan are writable while recording (and on the submit update), frozen after", async () => {
    await admin("moments/m1", newMoment());
    await assertSucceeds(updateDoc(doc(alice(), "moments/m1"), { intention: v4intention }));
    await assertSucceeds(updateDoc(doc(alice(), "moments/m1"), { status: "submitted", chunkCount: 1, headHash: "h", intention: { ...v4intention, plan: { ...plan, note: "tightened" } } }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { intention: { ...v4intention, claims: [] } }));
    await assertFails(updateDoc(doc(alice(), "moments/m1"), { "intention.plan": null }));
  });
  it("draft claims ≤ 5, plan requirements ≤ 6, recordMode video|photo", async () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `c${n}`, kind: "action", text: "x" }));
    const seven = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `r${n}`, claimId: "c1", evidence: "frames", ask: "x" }));
    await assertFails(setDoc(doc(alice(), "moments/m1"), newMoment("alice", { intention: { ...v4intention, claims: six } })));
    await assertFails(setDoc(doc(alice(), "moments/m2"), newMoment("alice", { intention: { ...v4intention, plan: { ...plan, requirements: seven } } })));
    await assertFails(setDoc(doc(alice(), "moments/m3"), newMoment("alice", { intention: { ...v4intention, plan: { ...plan, recordMode: "audio" } } })));
    await assertFails(setDoc(doc(alice(), "moments/m4"), newMoment("alice", { intention: { ...v4intention, claims: "c1" } })));
    await assertSucceeds(setDoc(doc(alice(), "moments/m5"), newMoment("alice", { intention: { ...v4intention, plan: null } })));
    await admin("moments/m6", newMoment());
    await assertFails(updateDoc(doc(alice(), "moments/m6"), { intention: { ...v4intention, claims: six } }));
    await assertSucceeds(updateDoc(doc(alice(), "moments/m6"), { intention: { ...v4intention, claims: six.slice(0, 5) } }));
  });
  it("public reads of a sealed v4 Moment include its claims, plan and video review; videoLeases are server-only", async () => {
    await admin("moments/m1", newMoment("alice", { status: "sealed", claims: { items: claims }, plan, videoReview: { status: "done" } }));
    await assertSucceeds(getDoc(doc(anon(), "moments/m1")));
    await admin("moments/m2", newMoment("alice", { status: "submitted", videoReview: { status: "waiting" } }));
    await assertSucceeds(getDoc(doc(alice(), "moments/m2")));
    await assertFails(getDoc(doc(bob(), "moments/m2")));
    await admin("videoLeases/m1", { at: 1 });
    await assertFails(getDoc(doc(alice(), "videoLeases/m1")));
    await assertFails(getDoc(doc(anon(), "videoLeases/m1")));
    await assertFails(setDoc(doc(alice(), "videoLeases/m2"), { at: 1 }));
  });
});

describe("feed and users", () => {
  it("public can read the feed; nobody can write it", async () => {
    await admin("feed/m1", { status: "sealed" });
    await assertSucceeds(getDoc(doc(anon(), "feed/m1")));
    await assertSucceeds(getDocs(query(collection(anon(), "feed"), orderBy("sealedAtServer", "desc"))));
    await assertFails(setDoc(doc(alice(), "feed/m2"), { status: "sealed" }));
    await assertFails(updateDoc(doc(alice(), "feed/m1"), { status: "rejected" }));
  });
  it("users: public read, self write", async () => {
    await assertSucceeds(setDoc(doc(alice(), "users/alice"), { displayName: "Alice" }));
    await assertFails(setDoc(doc(bob(), "users/alice"), { displayName: "Mallory" }));
    await assertSucceeds(getDoc(doc(anon(), "users/alice")));
  });
});
