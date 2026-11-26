// Every screen of the fixture build at phone (390×844) and laptop (1280×800), light and dark:
// `npm run dev:fixtures`, then `node scripts/ui-shots.mjs` (BASE, OUT, CHROME as in shots.mjs; ONLY=detail,me to filter).
// Recording screens use Chrome's fake camera and a fixed location.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5173";
const OUT = process.env.OUT || "shots/ui";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const SCHEMES = process.env.SCHEMES ? process.env.SCHEMES.split(",") : ["light", "dark"];
const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: "small", viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "wide", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
].filter((s) => !process.env.SIZES || process.env.SIZES.split(",").includes(s.name));

const FIXTURE = "7c1e4f0a-2b9d-4c3e-8f61-5a0d9b7e2c14";
const REJECTED = "e81f5c27-6a03-4b9d-9e44-c2a7d0b95f16";
const V4 = "c1a9f00d-5e2b-4c7a-9d14-3b8e6f2a0c50";

const feedSlide = (i) => async (page) => {
  await page.waitForSelector(".slide[data-i]");
  await page.evaluate((i) => {
    const r = document.querySelector(".tok-scroll");
    r.scrollTo({ top: r.clientHeight * i });
  }, i);
  await page.waitForTimeout(900);
};
const interview = (text) => async (page) => {
  await page.getByLabel("Type your answer").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("heading", { name: "Here's your claim." }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(300);
};
const live = async (page) => {
  await interview("clap 50 times")(page);
  await page.getByRole("button", { name: /^Start Moment/ }).first().click();
  await page.waitForSelector(".live", { timeout: 10_000 });
  await page.waitForTimeout(2500);
};

const SHOTS = [
  ["feed-intro", "/", feedSlide(0), false],
  ["feed-slide", "/", feedSlide(2), false],
  ["feed-rejected", "/", feedSlide(1), false],
  ["detail", `/m/${FIXTURE}`, null, true],
  ["detail-rejected", `/m/${REJECTED}`, null, true],
  ["detail-v4-owner", `/m/${V4}?ladder=demo`, null, true],
  ["record", "/record", null, true],
  ["record-typed", "/record", async (p) => p.getByRole("button", { name: /Skip, just type it/ }).click(), true],
  ["record-claim", "/record?plan=demo", interview("clap 50 times"), true],
  ["record-live", "/record?plan=demo&witness=demo", live, false],
  ["me", "/me", null, true],
  ["me-demo", "/me?me=demo", null, true],
  ["embed", "/embed", null, true],
  ["missing", "/nope", null, false],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const errors = [];
for (const scheme of SCHEMES) {
  for (const s of SIZES) {
    const ctx = await browser.newContext({
      ...s,
      colorScheme: scheme,
      reducedMotion: "reduce",
      permissions: ["geolocation", "camera"],
      geolocation: { latitude: 33.6189, longitude: -117.6681, accuracy: 8 },
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${s.name} ${e.message}`));
    for (const [name, path, act, full] of SHOTS) {
      if (ONLY && !ONLY.includes(name)) continue;
      try {
        await page.goto(BASE + path, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);
        if (act) await act(page);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (wide > 0) errors.push(`${name} ${s.name} ${scheme}: horizontal overflow ${wide}px`);
        const file = `${OUT}/${name}-${s.name}-${scheme}.png`;
        await page.screenshot({ path: file, fullPage: full });
        console.log(file);
      } catch (e) {
        errors.push(`${name} ${s.name} ${scheme}: ${e.message.split("\n")[0]}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
if (errors.length) {
  console.log("Problems:\n" + errors.join("\n"));
  process.exitCode = 1;
}
