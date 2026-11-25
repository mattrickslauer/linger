// Screenshots of the swipe feed and the evidence room against the fixture build:
// `npm run dev:fixtures`, then `node scripts/feed-shots.mjs` (BASE, OUT, CHROME as in shots.mjs).
// Steps through every slide with the keyboard, as a judge on a laptop would.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5173";
const OUT = process.env.OUT || "shots/feed";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const sizes = [
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "desktop", viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 },
];
const errors = [];
for (const s of sizes) {
  const ctx = await browser.newContext({ ...s, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${s.name} ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${s.name} console: ${m.text()}`));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector(".slide[data-i]");
  const n = await page.locator(".slide[data-i]").count();
  await page.screenshot({ path: `${OUT}/${s.name}-0-intro.png` });
  for (let i = 1; i <= n; i++) {
    await page.evaluate((i) => {
      const root = document.querySelector(".tok-scroll");
      root.scrollTo({ top: root.clientHeight * i });
    }, i);
    await page.waitForTimeout(1600); // let the one reveal finish
    await page.screenshot({ path: `${OUT}/${s.name}-${i}-slide.png` });
  }
  // Open the room from the second slide, then come back to it.
  await page.evaluate(() => document.querySelector(".tok-scroll").scrollTo({ top: document.querySelector(".tok-scroll").clientHeight * 2 }));
  await page.waitForTimeout(800);
  const id = await page.locator(".slide-on").getAttribute("data-id");
  await page.locator(".slide-on .rail-primary").click();
  await page.waitForURL(/\/m\//);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${s.name}-room.png`, fullPage: true });
  await page.goBack();
  await page.waitForSelector(".slide[data-i]");
  await page.waitForTimeout(900);
  const back = await page.locator(".slide-on").getAttribute("data-id");
  if (back !== id) errors.push(`${s.name}: came back to ${back}, expected ${id}`);
  await ctx.close();
}
await browser.close();
console.log(`wrote ${OUT}`);
if (errors.length) {
  console.log("Errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
