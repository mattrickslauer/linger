// End-to-end against the Emulator Suite (`npm run dev:emu` + emulators running):
// sign in through the Auth emulator popup, record ~25 s with a fake camera and a fixed GPS position,
// take one proof shot, finish, and check the Moment reached Firestore as "submitted" with all chunks.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:5173";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const PROJECT = process.env.PROJECT || "verified-99e74";
const OUT = process.env.OUT || "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  permissions: ["geolocation", "camera"],
  geolocation: { latitude: 33.6174, longitude: -117.6627, accuracy: 5 },
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log("[console]", m.text().slice(0, 200)));

await page.goto(BASE + "/record", { waitUntil: "networkidle" });
const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Sign in with Google" }).click()]);
await popup.waitForLoadState();
await popup.getByText(/Add new account/i).click();
await popup.getByText(/Auto-generate user information/i).click().catch(() => {});
await popup.getByRole("button", { name: /Sign in with Google\.com/i }).click();
await page.getByText("What are you about to do?").waitFor({ timeout: 15_000 });
console.log("signed in");

await page.getByRole("radio", { name: "fishing" }).click();
await page.getByRole("button", { name: "Start Moment" }).click();
await page.getByRole("button", { name: "Proof shot" }).waitFor();
await page.waitForTimeout(3000);
await page.getByRole("button", { name: "Proof shot" }).click();
await page.locator(".coach-banner:not(.pending)").waitFor({ timeout: 40_000 });
console.log("coach:", await page.locator(".coach-banner").innerText());
// Lose signal for 12 s: chunks keep closing and queue locally, then sync by themselves.
await ctx.setOffline(true);
await page.waitForTimeout(12_000);
await page.screenshot({ path: `${OUT}/e2e-live-offline.png` });
console.log("offline sync badge:", await page.locator(".sync").innerText());
await ctx.setOffline(false);
await page.waitForTimeout(8_000);
await page.screenshot({ path: `${OUT}/e2e-live.png` });
console.log("online sync badge:", await page.locator(".sync").innerText());
await page.getByRole("button", { name: "Finish" }).click();
await page.getByText("Moment finished.").waitFor();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/e2e-done.png` });
console.log("steps:\n" + (await page.locator(".steps").innerText()));

const id = await page.evaluate(() => {
  const a = document.querySelector('a[href^="/m/"]');
  return a ? a.getAttribute("href").slice(3) : null;
});
// Read back through the emulator REST API with the owner bypass token.
const base = `http://127.0.0.1:${process.env.FS_PORT || 8080}/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: "Bearer owner" };
const list = await (await fetch(`${base}/moments?pageSize=300`, { headers: H })).json();
const mine = (list.documents ?? [])
  .filter((d) => d.fields?.platform?.stringValue === "web")
  .sort((a, b) => Number(b.fields.startedAt.integerValue) - Number(a.fields.startedAt.integerValue))[0];
const mid = id ?? mine?.name.split("/").pop();
const m = mine?.fields;
const chunks = await (await fetch(`${base}/moments/${mid}/chunks?pageSize=300`, { headers: H })).json();
console.log(
  JSON.stringify({
    momentId: mid,
    status: m?.status?.stringValue,
    chunkCount: m?.chunkCount?.integerValue,
    chunkDocs: chunks.documents?.length,
    onDevice: m?.onDevice?.mapValue?.fields?.mode?.stringValue,
    judge: m?.judge?.mapValue ? "written" : "null",
    seal: m?.seal?.mapValue ? m.seal.mapValue.fields.sealed : "null",
  }),
);
if (errors.length) console.log("page errors:", errors);
await browser.close();
