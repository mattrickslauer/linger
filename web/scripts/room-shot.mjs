// One full-page evidence-room screenshot: node scripts/room-shot.mjs <url> <out.png> <width> <height> [click-selector]
// Uses playwright-core with the system Chrome (like shots.mjs). With a selector, clicks it and shoots the viewport.
import { chromium } from "playwright-core";

const [, , url, out, w = "390", h = "844", click] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true });
const mobile = +w < 600;
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, colorScheme: process.env.SCHEME || "dark" });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.goto(url, { waitUntil: "load" });
await p.waitForTimeout(+(process.env.WAIT || 3000));
if (click) {
  if (click !== "-") await p.locator(click).first().click(); // "-": just the viewport
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out });
} else {
  await p.screenshot({ path: out, fullPage: true });
}
console.log(out, await p.evaluate(() => document.documentElement.scrollHeight));
await b.close();
