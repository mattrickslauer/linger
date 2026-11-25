// Headless guest-mode check against a running dev server (`npm run dev:fixtures -- --port 5391`):
// the landing renders the app (pitch, Record CTA, feed), a guest records a Moment with a fake camera, it lands in the
// local journal, and Me lists it as "On this device". Screenshots go to OUT. `BASE=… node scripts/guest-check.mjs`
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5391";
const OUT = process.env.OUT || "shots";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const RECORD_MS = Number(process.env.RECORD_MS || 4000);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
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
  const ctx = await browser.newContext({
    ...size,
    reducedMotion: "reduce",
    permissions: ["geolocation", "camera"],
    geolocation: { latitude: 33.6189, longitude: -117.6681, accuracy: 8 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${size.name} ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${size.name} console: ${m.text()}`));

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  if (await page.getByRole("heading", { name: "Proof that it really happened." }).count()) ok(`${size.name}: pitch`);
  else fail(`${size.name}: pitch heading missing`);
  if (await page.getByRole("link", { name: /Record a Moment/ }).count()) ok(`${size.name}: Record a Moment CTA`);
  else fail(`${size.name}: CTA missing`);
  const cards = await page.locator(".grid .card").count();
  cards > 0 ? ok(`${size.name}: feed shows ${cards} cards`) : fail(`${size.name}: feed empty`);
  const wall = await page.getByRole("button", { name: /Sign in with Google|Continue with Google/ }).isVisible().catch(() => false);
  wall ? fail(`${size.name}: sign-in wall visible on landing`) : ok(`${size.name}: no sign-in wall`);
  await page.screenshot({ path: `${OUT}/landing-${size.name}.png`, fullPage: size.name === "desktop" });

  if (size.name === "desktop") {
    await page.getByRole("link", { name: /Record a Moment/ }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/record-setup-${size.name}.png`, fullPage: true });
    // Voice interview, typed (no microphone headless; no model in a sample-data build -> local write-up).
    await page.getByLabel("Type your answer").fill("Going fishing for bass at the lake");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByRole("heading", { name: "Here's your claim." }).waitFor({ timeout: 15_000 });
    ok("interview -> claim card");
    await page.screenshot({ path: `${OUT}/record-claim-${size.name}.png`, fullPage: true });
    const start = page.getByRole("button", { name: /^Start Moment/ });
    if (!(await start.count())) {
      fail("no Start Moment button for a guest");
    } else {
      await start.first().click();
      await page.waitForSelector(".live", { timeout: 10_000 });
      ok("guest started recording");
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: /Proof shot/ }).click();
      await page.waitForTimeout(RECORD_MS);
      await page.screenshot({ path: `${OUT}/record-live-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: /^Finish/ }).click();
      await page.getByRole("heading", { name: "Moment recorded." }).waitFor({ timeout: 10_000 });
      ok("guest finished: local done screen");
      await page.screenshot({ path: `${OUT}/record-done-${size.name}.png`, fullPage: true });
      await page.goto(BASE + "/me", { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      (await page.getByText("On this device · sign in to verify").count()) ? ok("Me lists the guest Moment") : fail("guest Moment missing on Me");
      await page.screenshot({ path: `${OUT}/me-guest-${size.name}.png`, fullPage: true });
      await page.locator(".me-local h3 a").first().click();
      await page.waitForTimeout(1200);
      (await page.locator(".local-banner").count()) ? ok("local detail renders from the journal") : fail("local detail missing");
      await page.screenshot({ path: `${OUT}/detail-local-${size.name}.png`, fullPage: true });
    }
  }
  await ctx.close();
}
await browser.close();
const real = errors.filter((e) => !/Failed to load resource|tile|mapbox|favicon/i.test(e));
if (real.length) {
  console.log("Page errors:\n" + real.join("\n"));
  process.exitCode = 1;
} else ok("no page errors");
