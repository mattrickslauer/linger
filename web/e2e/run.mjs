// End-to-end test for Linger in a real Chromium, with no cloud account needed.
//
//   npm run test:e2e            build a test bundle, serve it, run every scenario
//   CHROME_PATH=/path/to/chrome npm run test:e2e
//
// What is real: the app bundle, React, the attention engine, MediaPipe (on Chromium's fake
// camera), the Firebase AI Logic SDK and its hybrid routing, the service worker, pdf.js.
// What is stubbed: the Gemini cloud endpoint (Playwright route) and, in the "Nano" context,
// Chrome's Prompt API (window.LanguageModel), so the SDK's on-device path runs end to end.

import { chromium } from "playwright-core";
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, ".e2e-dist");
const shots = join(web, ".e2e-shots");
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
mkdirSync(shots, { recursive: true });

const chromePath =
  process.env.CHROME_PATH ||
  ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!chromePath) throw new Error("Set CHROME_PATH to a Chrome or Chromium binary");

// ------------------------------------------------------------------ build + serve
if (!process.argv.includes("--no-build")) {
  execSync(`node scripts/sync-mediapipe.mjs && npx vite build --outDir ${dist} --emptyOutDir --logLevel warn`, {
    cwd: web,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: "e2e-fake-key",
      VITE_FIREBASE_APP_ID: "1:000:web:e2e",
      VITE_FIREBASE_PROJECT_ID: "linger-e2e",
      VITE_FIREBASE_AUTH_DOMAIN: "linger-e2e.firebaseapp.com",
      VITE_RECAPTCHA_ENTERPRISE_KEY: "",
    },
  });
}
const server = spawn("npx", ["vite", "preview", "--outDir", dist, "--port", String(PORT), "--strictPort"], { cwd: web, stdio: "pipe" });
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && resolve());
  server.on("exit", (c) => reject(new Error(`preview exited ${c}`)));
  setTimeout(() => reject(new Error("preview did not start")), 20000);
});

// ------------------------------------------------------------------ harness
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const until = (p, ms = 8000) => p.waitFor({ timeout: ms }).then(() => true).catch(() => false);

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
});

const PARA_ANSWER = {
  plain: "Your payments are changing because your income went up. You can ask for a hearing if you disagree.",
  terms: [
    { term: "redetermined", meaning: "Checked again and decided again." },
    { term: "allotment", meaning: "The amount you get each month." },
  ],
};
const CHART_ANSWER = "The chart shows demand minus solar across a day. Midday dips deeply, then rises steeply at sunset.";

async function newContext({ nano }) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: ["camera"], serviceWorkers: "allow" });
  const log = { cloud: [], device: [], errors: [] };
  await ctx.exposeBinding("__nanoPrompt", (_src, kind) => log.device.push({ kind, t: Date.now() }));
  if (nano) {
    await ctx.addInitScript(
      ({ para, chart }) => {
        globalThis.LanguageModel = {
          availability: async () => "available",
          create: async () => ({
            prompt: async (messages) => {
              const parts = messages.flatMap((m) => m.content ?? []);
              const image = parts.some((p) => p.type === "image");
              await window.__nanoPrompt(image ? "image" : "text");
              await new Promise((r) => setTimeout(r, 120));
              return image ? chart : JSON.stringify(para);
            },
            promptStreaming() {
              throw new Error("not used");
            },
            destroy() {},
          }),
        };
      },
      { para: PARA_ANSWER, chart: CHART_ANSWER },
    );
  }
  let outage = false;
  let offline = false;
  await ctx.route("https://firebasevertexai.googleapis.com/**", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const parts = body.contents?.[0]?.parts ?? [];
    const image = parts.some((p) => p.inlineData?.mimeType === "image/png" && p.inlineData.data.length > 1000);
    log.cloud.push({ url: route.request().url(), image, text: parts.map((p) => p.text ?? "").join(" "), body });
    await new Promise((r) => setTimeout(r, 350));
    // An outage lasts until the test ends it (the SDK may retry transient errors).
    if (offline) return route.abort("internetdisconnected");
    if (outage) return route.abort("connectionrefused");
    const text = image ? CHART_ANSWER : JSON.stringify(PARA_ANSWER);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }] }),
    });
  });
  // No real project: Remote Config and Installations fail fast and the app must use defaults.
  await ctx.route(/firebase(remoteconfig|installations)\.googleapis\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log.errors.push(e.message));
  const setOffline = async (v) => {
    offline = v; // routed requests bypass the browser's offline flag, so the stub must fail too
    await ctx.setOffline(v);
  };
  return { ctx, page, log, outage: (v) => (outage = v), setOffline };
}

async function hover(page, i, ms) {
  const el = page.locator(".block").nth(i);
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.mouse.move(b.x + Math.min(b.width / 2, 300), b.y + Math.min(b.height / 2, 120), { steps: 4 });
  if (ms) await page.waitForTimeout(ms);
}

async function chooseDoc(page, label) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
}

try {
  // ================================================================ A. no Nano: cloud path
  {
    const { ctx, page, log, outage } = await newContext({ nano: false });
    await page.goto(BASE, { waitUntil: "networkidle" });
    check("A1 intro renders with a document library", (await page.locator(".doc-choice").count()) === 6);
    check("A1 device pill explains the cloud fallback", /cloud/.test(await page.locator(".pill").first().textContent()));
    await page.screenshot({ path: join(shots, "a1-intro.png") });

    await page.getByRole("button", { name: "Read with the mouse" }).click();
    await page.waitForTimeout(1200);
    await hover(page, 0, 900);
    check("A2 lamp lights the paragraph being read", (await page.locator(".block").nth(0).getAttribute("class")).includes("lit"));

    await hover(page, 1, 1100);
    const t0 = Date.now();
    await hover(page, 0, 0);
    const note = page.locator(".row").nth(0).locator(".note");
    const ok = await until(note.locator(".route"));
    check("A3 coming back to a paragraph opens help", ok, `${Date.now() - t0} ms`);
    check("A3 note says why it appeared", (await note.locator(".why").textContent()) === "You came back to this.");
    check("A3 answer labelled as cloud", /Answered in the cloud in/.test(await note.locator(".route").textContent()));
    check("A3 key terms shown", (await note.locator("dt").count()) === 2);
    const req = log.cloud[0];
    check("A3 request carries the paragraph, schema output", req?.text.includes("periodic review") && !!req.body.generationConfig?.responseSchema);
    await page.screenshot({ path: join(shots, "a3-reread.png") });

    const t1 = Date.now();
    await hover(page, 3, 0);
    const okDwell = await until(page.locator(".row").nth(3).locator(".note"), 16000);
    const dwell = (Date.now() - t1) / 1000;
    check("A4 staring opens help within the 12 s ceiling", okDwell && dwell < 13.5, `${dwell.toFixed(1)} s`);

    outage(true);
    const r2 = page.locator(".row").nth(2);
    await r2.hover();
    await r2.getByRole("button", { name: "Explain this" }).click();
    check("A5 an outage shows a clear error", await until(r2.locator(".note .error"), 20000));
    outage(false);
    await r2.getByRole("button", { name: "Close note" }).click();
    await r2.hover();
    await r2.getByRole("button", { name: "Explain this" }).click();
    check("A5 retry after an outage works", await until(r2.locator(".note .route")));

    await page.getByRole("button", { name: "Text" }).click();
    await page.getByRole("button", { name: "Largest" }).click();
    const size = await page.locator(".block p").first().evaluate((el) => getComputedStyle(el).fontSize);
    check("A6 text size control works", parseFloat(size) >= 26, size);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Stop reading" }).click();
    await chooseDoc(page, "An explainer with a chart");
    await page.getByRole("button", { name: "Read with the mouse" }).click();
    const fig = page.locator(".row").filter({ has: page.locator(".block.figure") });
    await fig.scrollIntoViewIfNeeded();
    await fig.hover();
    await fig.getByRole("button", { name: "Explain this chart" }).click();
    check("A7 chart help sends a PNG to the cloud", (await until(fig.locator(".note .route"))) && log.cloud.some((r) => r.image));
    await page.screenshot({ path: join(shots, "a7-chart.png") });

    await page.reload({ waitUntil: "networkidle" });
    const sizeAfter = await page.locator(".block p").first().evaluate((el) => getComputedStyle(el).fontSize);
    check("A6 text size is remembered", sizeAfter === size, sizeAfter);

    // PDF: generate a real PDF with Chromium, open it through the file input.
    const pdfPage = await ctx.newPage();
    await pdfPage.setContent(
      `<h1>Notice of rent increase</h1><p>Pursuant to clause 4 the monthly rent shall be adjusted with effect from the renewal date by an amount not exceeding the permitted percentage.</p><p style="margin-top:40px">You may serve written notice of non-renewal not less than sixty days prior to expiry.</p>`,
    );
    const pdfPath = join(shots, "sample.pdf");
    await pdfPage.pdf({ path: pdfPath });
    await pdfPage.close();
    await page.locator('input[type="file"]').setInputFiles(pdfPath);
    const pdfOk = await until(page.getByText("The file never left this device"), 15000);
    check("A8 PDF opens as paragraphs, locally", pdfOk && (await page.locator(".block").count()) >= 2, `${await page.locator(".block").count()} blocks, title "${await page.locator(".title").textContent()}"`);

    await page.getByRole("button", { name: /Paste text/ }).click();
    await page.locator("#paste").fill("My lease\n\nThe tenant shall indemnify the landlord.\n\nRent is due on the first.");
    await page.getByRole("button", { name: "Read this text" }).click();
    check("A9 pasted text becomes paragraphs", (await page.locator(".block").count()) === 2);

    // Eye setup on Chromium's fake camera (a test pattern, so no face).
    const t2 = Date.now();
    await page.getByRole("button", { name: "Start eye reading" }).click();
    const setupShown = await until(page.locator(".setup"), 3000);
    check("A10 setup screen appears immediately", setupShown, `${Date.now() - t2} ms`);
    const ready = await until(page.getByRole("heading", { name: /Move into view|We can see your eyes/ }), 60000);
    check("A10 face tracker and camera ready", ready, `${((Date.now() - t2) / 1000).toFixed(1)} s`);
    check("A10 calibration waits for a face", await page.getByRole("button", { name: "Begin calibration" }).isDisabled());
    await page.screenshot({ path: join(shots, "a10-setup.png") });
    await page.getByRole("button", { name: "Cancel" }).click();

    // Offline: the service worker must serve the app shell.
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
    await page.reload({ waitUntil: "networkidle" });
    await ctx.setOffline(true);
    const offlineOk = await page.reload({ waitUntil: "load" }).then(() => true).catch(() => false);
    check("A11 app loads with no network (service worker)", offlineOk && (await page.locator(".brand").isVisible()));
    await ctx.setOffline(false);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE, { waitUntil: "networkidle" });
    check("A12 no sideways scroll on a phone", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await page.screenshot({ path: join(shots, "a12-mobile.png") });
    check("A13 no uncaught page errors", log.errors.length === 0, log.errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // ================================================================ B. with Nano: on-device path
  {
    const { ctx, page, log, setOffline } = await newContext({ nano: true });
    await page.goto(BASE, { waitUntil: "networkidle" });
    check("B1 Nano detected", (await page.locator(".pill").first().textContent()) === "Gemini Nano ready on this device");

    await page.getByRole("button", { name: "Read with the mouse" }).click();
    await page.waitForTimeout(1200);
    await hover(page, 0, 1200);
    check("B2 settling on a paragraph prepares help on-device in advance", log.device.length === 1, `${log.device.length} on-device prompt(s)`);
    await hover(page, 1, 1200);
    await hover(page, 0, 0);
    const note = page.locator(".row").nth(0).locator(".note");
    await until(note.locator(".route"));
    check("B3 help is already waiting when the reader comes back", (await note.locator(".route").textContent()) === "Prepared on this device before you needed it");
    check("B3 footer counts it", await page.getByText("ready before you needed it").isVisible());
    check("B4 no paragraph text was sent to the cloud", log.cloud.length === 0);
    await page.screenshot({ path: join(shots, "b3-prefetched.png") });

    const r3 = page.locator(".row").nth(3);
    await r3.hover();
    await r3.getByRole("button", { name: "Explain this" }).click();
    await until(r3.locator(".note .route"));
    check("B5 asking directly is answered on-device", /^Answered on this device in \d+ ms$/.test(await r3.locator(".note .route").textContent()));

    await page.getByRole("button", { name: "Stop reading" }).click();
    await chooseDoc(page, "An explainer with a chart");
    await page.getByRole("button", { name: "Read with the mouse" }).click();
    await setOffline(true);
    const fig = page.locator(".row").filter({ has: page.locator(".block.figure") });
    await fig.scrollIntoViewIfNeeded();
    await fig.hover();
    await fig.getByRole("button", { name: "Explain this chart" }).click();
    const figOk = await until(fig.locator(".note .route"));
    const figBadge = figOk ? await fig.locator(".note .route").textContent() : await fig.locator(".note").textContent();
    check("B6 offline, the chart is still explained on-device", figOk && /on this device/.test(figBadge), figBadge);
    await setOffline(false);
    await page.screenshot({ path: join(shots, "b6-offline-chart.png") });
    check("B7 no uncaught page errors", log.errors.length === 0, log.errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
} catch (e) {
  check("harness", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  server.kill();
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(join(shots, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${passed}/${results.length} passed. Screenshots in web/.e2e-shots/`);
process.exit(passed === results.length ? 0 : 1);
