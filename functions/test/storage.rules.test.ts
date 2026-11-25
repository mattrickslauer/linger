// Cloud Storage rules tests (docs/ARCHITECTURE.md v3.6 + v4.4/v4.9: clip upload at submit). Run against the Storage
// emulator: `npm run test:rules` (from repo root; wraps `firebase emulators:exec --only firestore,storage`).
import { readFileSync } from "node:fs";
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT = "demo-verified-rules";
let env: RulesTestEnvironment;

const [host, port] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199").split(":");

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    storage: { rules: readFileSync(new URL("../../storage.rules", import.meta.url), "utf8"), host, port: Number(port) },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearStorage());

const SHA = "a".repeat(64);
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const alice = () => env.authenticatedContext("alice").storage();
const bob = () => env.authenticatedContext("bob").storage();
const anon = () => env.unauthenticatedContext().storage();
const put = (s: ReturnType<typeof alice>, path: string, contentType = "video/mp4") =>
  s.ref(path).put(bytes, { contentType }) as unknown as Promise<unknown>;

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
