// Headless screenshots of the fixture build: `npm run shots` (needs a running `npm run dev:fixtures`
// or pass BASE=http://host:port). Uses playwright-core with the system Chrome.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5173";
const OUT = process.env.OUT || "shots";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const FIXTURE = "7c1e4f0a-2b9d-4c3e-8f61-5a0d9b7e2c14";
const REJECTED = "e81f5c27-6a03-4b9d-9e44-c2a7d0b95f16";
const V4 = "c1a9f00d-5e2b-4c7a-9d14-3b8e6f2a0c50"; // seal v4: claims, plan, video review, per-claim offers

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const sizes = [
  { name: "desktop", viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 },
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const pages = [
  ["feed", "/"],
  ["detail", `/m/${FIXTURE}`],
  ["rejected", `/m/${REJECTED}`],
  ["claims-v4", `/m/${V4}?ladder=demo`],
];
const errors = [];
for (const scheme of ["light", "dark"]) {
  for (const s of sizes) {
    const ctx = await browser.newContext({ ...s, colorScheme: scheme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${s.name} ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${s.name} console: ${m.text()}`));
    for (const [name, path] of pages) {
      if (scheme === "dark" && name === "rejected") continue;
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(name === "feed" ? 600 : 1500);
      if (name === "detail" && process.env.REVERIFY !== "0") {
        const b = page.getByRole("button", { name: /Re-verify chain/ });
        if (await b.count()) {
          await b.click();
          await page.getByRole("status").first().waitFor({ timeout: 10_000 }).catch(() => {});
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const file = `${OUT}/${name}-${s.name}-${scheme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
    }
    await ctx.close();
  }
}
await browser.close();
if (errors.length) {
  console.log("Page errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
