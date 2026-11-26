// Cloud Storage rules tests (docs/ARCHITECTURE.md v3.6 + v4.4/v4.9: clip upload at submit; v4.12: public clip reads). Run against the Storage
// emulator: `npm run test:rules` (from repo root; wraps `firebase emulators:exec --only firestore,storage`).
import { readFileSync } from "node:fs";
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT = "demo-verified-rules";
let env: RulesTestEnvironment;

const [host, port] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199").split(":");
const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    storage: { rules: readFileSync(new URL("../../storage.rules", import.meta.url), "utf8"), host, port: Number(port) },
    // v4.12: storage.rules reads moments/{id} (cross-service); the tests seed it with rules disabled.
    firestore: { rules: "rules_version = '2'; service cloud.firestore { match /{d=**} { allow read, write: if false; } }", host: fsHost, port: Number(fsPort) },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearStorage();
  await env.clearFirestore();
});

const SHA = "a".repeat(64);
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const alice = () => env.authenticatedContext("alice").storage();
const bob = () => env.authenticatedContext("bob").storage();
const anon = () => env.unauthenticatedContext().storage();
const put = (s: ReturnType<typeof alice>, path: string, contentType = "video/mp4") =>
  s.ref(path).put(bytes, { contentType }) as unknown as Promise<unknown>;

async function moment(id: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`moments/${id}`).set(data);
  });
}

async function seed(path: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref(path).put(bytes, { contentType: "video/mp4" });
  });
}

describe("storage: clips/{uid}/{momentId}/{sha256}.{ext}", () => {
  it("owner uploads a clip named by its sha256, video/* only", async () => {
    await assertSucceeds(put(alice(), `clips/alice/m1/${SHA}.mp4`));
    await assertSucceeds(put(alice(), `clips/alice/m1/${"b".repeat(64)}.webm`, "video/webm"));
    await assertFails(put(alice(), `clips/alice/m1/${"c".repeat(64)}.mp4`, "image/jpeg"));
    await assertFails(put(alice(), `clips/alice/m1/clip.mp4`));
    await assertFails(put(alice(), `clips/alice/m1/${"D".repeat(64)}.mp4`));
  });
  it("nobody else uploads into another user's folder; guests upload nothing", async () => {
    await assertFails(put(bob(), `clips/alice/m1/${SHA}.mp4`));
    await assertFails(put(anon(), `clips/alice/m1/${SHA}.mp4`));
  });
  it("v4: the owner can get its clip's metadata (idempotent re-upload check); others cannot", async () => {
    await seed(`clips/alice/m1/${SHA}.mp4`);
    await assertSucceeds(alice().ref(`clips/alice/m1/${SHA}.mp4`).getMetadata());
    await assertFails(bob().ref(`clips/alice/m1/${SHA}.mp4`).getMetadata());
    await assertFails(anon().ref(`clips/alice/m1/${SHA}.mp4`).getMetadata());
  });
  it("v4.12: anyone (guests too) can get a clip of a public (sealed/rejected) Moment", async () => {
    await seed(`clips/alice/m1/${SHA}.mp4`);
    await seed(`clips/alice/m2/${SHA}.mp4`);
    await moment("m1", { ownerUid: "alice", status: "sealed" });
    await moment("m2", { ownerUid: "alice", status: "rejected" });
    for (const s of [bob(), anon()]) {
      await assertSucceeds(s.ref(`clips/alice/m1/${SHA}.mp4`).getMetadata());
      await assertSucceeds(s.ref(`clips/alice/m2/${SHA}.mp4`).getMetadata());
    }
  });
  it("v4.12: not while the Moment is private, missing, or owned by someone else", async () => {
    await seed(`clips/alice/m1/${SHA}.mp4`);
    await seed(`clips/alice/m3/${SHA}.mp4`);
    await seed(`clips/alice/m4/${SHA}.mp4`);
    await moment("m1", { ownerUid: "alice", status: "submitted" });
    await moment("m4", { ownerUid: "mallory", status: "sealed" }); // the path uid must be the Moment's owner
    for (const id of ["m1", "m3", "m4"]) {
      await assertFails(bob().ref(`clips/alice/${id}/${SHA}.mp4`).getMetadata());
      await assertFails(anon().ref(`clips/alice/${id}/${SHA}.mp4`).getMetadata());
    }
    await assertSucceeds(alice().ref(`clips/alice/m1/${SHA}.mp4`).getMetadata());
  });
  it("v4.12: a public Moment still allows no list, overwrite or delete", async () => {
    await seed(`clips/alice/m1/${SHA}.mp4`);
    await moment("m1", { ownerUid: "alice", status: "sealed" });
    await assertFails(bob().ref(`clips/alice/m1`).listAll());
    await assertFails(put(bob(), `clips/alice/m1/${SHA}.mp4`));
    await assertFails(bob().ref(`clips/alice/m1/${SHA}.mp4`).delete());
  });
  it("clips are create-only: no overwrite, delete or list", async () => {
    await seed(`clips/alice/m1/${SHA}.mp4`);
    await assertFails(put(alice(), `clips/alice/m1/${SHA}.mp4`));
    await assertFails(alice().ref(`clips/alice/m1/${SHA}.mp4`).delete());
    await assertFails(alice().ref(`clips/alice/m1`).listAll());
  });
  it("everything else is closed", async () => {
    await assertFails(put(alice(), `other/alice/${SHA}.mp4`));
    await assertFails(anon().ref(`other/x`).getMetadata());
  });
});
