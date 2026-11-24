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
  it("no deletes", async () => {
    await admin("moments/m1", newMoment());
    await assertFails(deleteDoc(doc(alice(), "moments/m1")));
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
