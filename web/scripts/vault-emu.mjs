// Raw vault against the Emulator Suite (`npm run dev:emu` + auth/firestore emulators running):
//  1. record a short Moment: after submit the vault verifies it from the server and drops the local copy;
//  2. journal a Moment the server never got: the vault re-creates it, uploads every chunk, submits, then drops it;
//  3. journal a chunk that differs from the server's: the vault keeps it and reports a conflict on /me;
//  4. the server loses a chunk: the vault re-uploads it;
//  5. owner delete from /me (confirm dialog): the journal goes, then the server doc; Delete only shows via ?from=me;
//  6. a journal whose id has a deleted/{id} tombstone is dropped and not re-created.
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "http://localhost:5173";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const EMU = process.env.EMU || "127.0.0.1:8080";
const PROJECT = process.env.PROJECT || "verified-99e74";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const ctx = await browser.newContext({
  permissions: ["geolocation", "camera"],
  geolocation: { latitude: 33.6174, longitude: -117.6627, accuracy: 5 },
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
let failed = false;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) failed = true;
};

await page.goto(BASE + "/record", { waitUntil: "networkidle" });
const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Sign in with Google" }).click()]);
await popup.waitForLoadState();
await popup.getByText(/Add new account/i).click();
await popup.getByText(/Auto-generate user information/i).click().catch(() => {});
await popup.getByRole("button", { name: /Sign in with Google\.com/i }).click();
await page.getByText("What are you about to do?").waitFor({ timeout: 15_000 });

// 1. a real recording
await page.getByRole("radio", { name: "fishing" }).click();
await page.getByRole("button", { name: "Start Moment" }).click();
await page.getByRole("button", { name: "Proof shot" }).waitFor();
const journaled = await page.evaluate(async () => Object.keys((await import("/src/vault.ts")).vaultHeld()).length);
check(journaled === 1, `recording Moment is journaled (held=${journaled})`);
await page.waitForTimeout(11_000);
await page.getByRole("button", { name: "Finish" }).click();
await page.getByText("Moment finished.").waitFor();
let n = -1;
for (let i = 0; i < 10 && n !== 0; i++) {
  n = await page.evaluate(async () => {
    const v = await import("/src/vault.ts");
    await v.verifyAll();
    return Object.keys(v.vaultHeld()).length;
  });
  if (n) await page.waitForTimeout(2000);
}
check(n === 0, `recorded Moment verified on server and dropped from the vault (held=${n})`);

// 2 + 3. Moments that exist only in the journal
const res = await page.evaluate(async () => {
  const v = await import("/src/vault.ts");
  const { makeChunk } = await import("/src/chain.ts");
  const { auth } = await import("/src/firebase.ts");
  const id = crypto.randomUUID();
  const t = Date.now() - 60_000;
  const fields = {
    ownerUid: auth.currentUser.uid,
    owner: { name: "Vault test", photoURL: null },
    intention: { text: "vault repair", category: "fishing" },
    platform: "web",
    device: { model: "test", os: "test", appVersion: "1.0.0" },
    status: "recording",
    startedAt: t,
    endedAt: null,
    chunkCount: 0,
    headHash: null,
    summary: null,
    onDevice: { mode: "none", checks: 0, retakes: 0 },
    judge: null,
    skeptic: null,
    seal: null,
    submittedAtServer: null,
  };
  await v.journalMoment(id, fields);
  const chunks = [];
  let prev = null;
  for (let s = 0; s < 3; s++) {
    const p = { gps: [[t + s * 5000, 33.6, -117.6, 5, null, null]], motion: [], events: [], frameSha: null, check: null };
    const c = await makeChunk(id, s, t + s * 5000, t + (s + 1) * 5000, prev, p, s === 1 ? { jpegB64: "AAAA", w: 1, h: 1, t: t + 6000 } : null);
    prev = c.hash;
    chunks.push(c);
    await v.journalChunk(id, c);
  }
  const submit = { status: "submitted", endedAt: t + 15_000, chunkCount: 3, headHash: prev, summary: null, onDevice: { mode: "none", checks: 0, retakes: 0 } };
  await v.journalMomentUpdate(id, submit);
  await v.verifyAll();
  const repairedHeld = v.vaultHeld()[id] ?? null;

  // 3. the server has this Moment now; journal it again with one chunk's payload changed.
  await v.journalMoment(id, fields);
  for (const c of chunks) await v.journalChunk(id, c.seq === 2 ? { ...c, payload: c.payload + " " } : c);
  await v.journalMomentUpdate(id, submit);
  await v.verifyAll();
  return { id, repairedHeld, conflictHeld: v.vaultHeld()[id] ?? null };
});

// Read the server copy through the emulator's admin REST API (bypasses rules and any client cache).
const REST = `http://${EMU}/v1/projects/${PROJECT}/databases/(default)/documents/moments/${res.id}`;
const H = { Authorization: "Bearer owner" };
const md = await (await fetch(REST, { headers: H })).json();
const cd = await (await fetch(REST + "/chunks", { headers: H })).json();
const server = {
  status: md.fields?.status?.stringValue,
  count: Number(md.fields?.chunkCount?.integerValue),
  chunks: cd.documents?.length ?? 0,
  frame: cd.documents?.find((d) => d.fields.seq.integerValue === "1")?.fields.frame?.mapValue?.fields?.jpegB64?.stringValue ?? null,
};
check(res.repairedHeld === null, `Moment missing on server was re-created, verified and dropped (held=${res.repairedHeld})`);
check(server.status === "submitted" && server.count === 3 && server.chunks === 3 && server.frame === "AAAA", `server copy ${JSON.stringify(server)}`);
check(res.conflictHeld === "conflict", `differing chunk kept as conflict (held=${res.conflictHeld})`);

// 4. the server loses chunk 0 of a submitted Moment: the vault puts it back (still a conflict because of chunk 2).
await fetch(REST + "/chunks/000000", { method: "DELETE", headers: H });
await page.evaluate(async () => (await import("/src/vault.ts")).verifyAll());
const c0 = await (await fetch(REST + "/chunks/000000", { headers: H })).json();
check(c0.fields?.seq?.integerValue === "0", `lost chunk 0 re-uploaded from the journal (${c0.fields ? "present" : "missing"})`);

await page.goto(BASE + "/me", { waitUntil: "load" });
const shown = await page
  .locator(".vault-line", { hasText: "differ from the server" })
  .waitFor({ timeout: 20_000 })
  .then(
    () => true,
    () => false,
  );
check(shown, `/me says: ${await page.locator(".vault-line").innerText()}`);

// 5. owner delete. The res.id Moment is on the server and still held in the journal (conflict) - the worst case.
const inJournal = (id) =>
  page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("verified-vault", 1);
        r.onsuccess = () => {
          const t = r.result.transaction(["moments", "chunks"], "readonly");
          const m = t.objectStore("moments").count(id);
          const c = t.objectStore("chunks").count(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
          t.oncomplete = () => resolve(m.result + c.result);
        };
        r.onerror = () => reject(r.error);
      }),
    id,
  );
const delBtn = page.getByRole("button", { name: "Delete Moment: vault repair" });
await page.goto(`${BASE}/m/${res.id}`, { waitUntil: "load" });
await page.locator(".detail-head").waitFor({ timeout: 15_000 });
check((await delBtn.count()) === 0, "detail opened from the feed shows no Delete");
await page.goto(`${BASE}/m/${res.id}?from=me`, { waitUntil: "load" });
check(await delBtn.waitFor({ timeout: 15_000 }).then(() => true, () => false), "detail opened from /me shows Delete for the owner");

await page.goto(BASE + "/me", { waitUntil: "load" });
await delBtn.waitFor({ timeout: 15_000 });
check((await inJournal(res.id)) > 0, "before delete: Moment is in the journal");
await delBtn.click();
const dialog = page.getByRole("alertdialog");
check(
  (await dialog.getByText("Delete this Moment? Its recording, proof shots and feed entry are removed for good.").count()) === 1,
  "confirm dialog uses the contract wording",
);
await dialog.getByRole("button", { name: "Cancel" }).click();
check((await inJournal(res.id)) > 0 && (await delBtn.count()) === 1, "Cancel keeps the Moment");
await delBtn.click();
await dialog.getByRole("button", { name: "Delete Moment" }).click();
const gone = await delBtn.waitFor({ state: "detached", timeout: 15_000 }).then(() => true, () => false);
check(gone, "deleted Moment's row disappears from /me");
check((await inJournal(res.id)) === 0, "journal for the deleted Moment is gone");
let status = 0;
for (let i = 0; i < 10 && status !== 404; i++) {
  status = (await fetch(REST, { headers: H })).status;
  if (status !== 404) await page.waitForTimeout(1000);
}
check(status === 404, `server moments/${res.id} deleted (HTTP ${status})`);
const heldAfter = await page.evaluate(async (id) => {
  const v = await import("/src/vault.ts");
  await v.verifyAll();
  return v.vaultHeld()[id] ?? null;
}, res.id);
check(heldAfter === null && (await fetch(REST, { headers: H })).status === 404, "a vault pass after the delete does not re-create it");

// 6. deleted on another device: a journal whose id has a deleted/{id} tombstone is dropped, not re-created.
// The tombstone is written through the admin REST API (what onMomentDeleted would write), so no functions emulator.
const tomb = await page.evaluate(async () => {
  const v = await import("/src/vault.ts");
  const { auth } = await import("/src/firebase.ts");
  const id = crypto.randomUUID();
  const t = Date.now() - 60_000;
  await v.journalMoment(id, {
    ownerUid: auth.currentUser.uid,
    owner: { name: "Vault test", photoURL: null },
    intention: { text: "deleted elsewhere", category: "fishing" },
    platform: "web",
    device: { model: "test", os: "test", appVersion: "1.0.0" },
    status: "recording",
    startedAt: t,
    endedAt: null,
    chunkCount: 0,
    headHash: null,
    summary: null,
    onDevice: { mode: "none", checks: 0, retakes: 0 },
    judge: null,
    skeptic: null,
    seal: null,
    submittedAtServer: null,
  });
  await v.journalMomentUpdate(id, { status: "submitted", endedAt: t + 15_000, chunkCount: 0, headHash: null, summary: null });
  return { id, uid: auth.currentUser.uid };
});
const TOMB = `http://${EMU}/v1/projects/${PROJECT}/databases/(default)/documents/deleted?documentId=${tomb.id}`;
const tw = await fetch(TOMB, {
  method: "POST",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ fields: { ownerUid: { stringValue: tomb.uid }, deletedAt: { timestampValue: new Date().toISOString() } } }),
});
check(tw.ok, `tombstone deleted/${tomb.id} written (HTTP ${tw.status})`);
const tombHeld = await page.evaluate(async (id) => {
  const v = await import("/src/vault.ts");
  await v.verifyAll();
  return v.vaultHeld()[id] ?? null;
}, tomb.id);
const REST2 = `http://${EMU}/v1/projects/${PROJECT}/databases/(default)/documents/moments/${tomb.id}`;
check(tombHeld === null && (await inJournal(tomb.id)) === 0, `tombstoned journal dropped (held=${tombHeld})`);
check((await fetch(REST2, { headers: H })).status === 404, "tombstoned Moment was NOT re-created on the server");

await browser.close();
process.exit(failed ? 1 : 0);
