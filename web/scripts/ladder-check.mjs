// Headless check of the verification ladder against a sample-data dev server (`npm run dev:fixtures`), using the
// simulated server (`?ladder=demo`): public rungs render, the owner offer list shows costs and previews, a run goes
// through the confirm sheet and the score/rungs update. `BASE=… node scripts/ladder-check.mjs`
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:5391";
const OUT = process.env.OUT || "shots";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const ID = "7c1e4f0a-2b9d-4c3e-8f61-5a0d9b7e2c14";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const fail = (m) => {
  console.error("FAIL", m);
  process.exitCode = 1;
};
const ok = (m) => console.log("ok  ", m);

for (const size of [
  { name: "desktop", viewport: { width: 1360, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
]) {
  const ctx = await browser.newContext({ ...size, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${size.name} ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${size.name} console: ${m.text()}`));

  // Public view: rungs, no offers.
  await page.goto(`${BASE}/m/${ID}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Verification ladder" }).waitFor({ timeout: 10_000 });
  (await page.locator(".rung").count()) === 1 ? ok(`${size.name}: public rung shown`) : fail(`${size.name}: rungs wrong`);
  (await page.getByRole("heading", { name: "Raise your score" }).count()) === 0 ? ok(`${size.name}: no offers for a visitor`) : fail(`${size.name}: offers visible to a visitor`);

  // Owner view (simulated).
  await page.goto(`${BASE}/m/${ID}?ladder=demo`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Raise your score" }).waitFor({ timeout: 10_000 });
  await page.getByText(/10.*credits/).first().waitFor({ timeout: 5_000 });
  ok(`${size.name}: owner offers + 10 free credits`);
  const offers = await page.locator(".offer").count();
  offers === 5 ? ok(`${size.name}: 5 offers (second_look already ran)`) : fail(`${size.name}: ${offers} offers`);
  await page.locator(".ladder").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/ladder-${size.name}.png`, fullPage: false });
  const before = await page.locator(".ladder-head").innerText();
  await page.locator(".offer", { hasText: "Place & time" }).getByRole("button", { name: "Run" }).click();
  await page.getByRole("heading", { name: /Run Place & time check/ }).waitFor();
  await page.screenshot({ path: `${OUT}/ladder-confirm-${size.name}.png` });
  await page.getByRole("button", { name: /Spend 1 credit/ }).click();
  await page.getByText(/Passed: score/).waitFor({ timeout: 10_000 });
  const after = await page.locator(".ladder-head").innerText();
  const rungs = await page.locator(".rung").count();
  rungs === 2 && before !== after ? ok(`${size.name}: run recorded (${before.replace(/\s+/g, " ")} → ${after.replace(/\s+/g, " ")})`) : fail(`${size.name}: run not shown (${rungs} rungs)`);
  await page.getByText(/9.*credits/).first().waitFor({ timeout: 5_000 });
  ok(`${size.name}: balance 9`);
  await page.locator(".ladder").screenshot({ path: `${OUT}/ladder-after-${size.name}.png` });
  await ctx.close();
}
errors.length ? fail("page errors:\n  " + errors.join("\n  ")) : ok("no page errors");
await browser.close();
