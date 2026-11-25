// Headless guest-mode check against a running dev server (`npm run dev:fixtures -- --port 5391`):
// the landing renders the app (pitch, Record CTA, feed), a guest records a Moment with a fake camera, it lands in the
// local journal, and Me lists it as "On this device". Screenshots go to OUT. `BASE=… node scripts/guest-check.mjs`
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:5391"; // vite binds localhost (may be IPv6 only)
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
    // Scripted witness (sample-data builds only) so the toast and the chain events can be checked.
    await page.goto(BASE + "/record?witness=demo", { waitUntil: "networkidle" });
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
      await page.getByText("Show me the water you're fishing").first().waitFor({ timeout: 15_000 });
      ok("witness asked (show)");
      await page.screenshot({ path: `${OUT}/record-witness-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: "Show", exact: true }).click();
      await page.getByText("What lure are you using?").waitFor({ timeout: 20_000 });
      ok("witness answered by frame, asked again (tell)");
      await page.getByRole("button", { name: "Type it" }).click();
      await page.getByPlaceholder("Type your answer").fill("A green crankbait");
      await page.getByRole("button", { name: "Answer", exact: true }).click();
      // A short video clip: chained by hash, bytes kept in the vault.
      await page.getByRole("button", { name: /^Clip/ }).click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/record-clip-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: /^Stop video/ }).click();
      await page.getByRole("button", { name: /^Clip/ }).waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      ok("clip recorded");
      await page.waitForTimeout(RECORD_MS);
      await page.screenshot({ path: `${OUT}/record-live-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: /^Finish/ }).click();
      await page.getByRole("heading", { name: "Moment recorded." }).waitFor({ timeout: 10_000 });
      ok("guest finished: local done screen");
      const ev = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const r = indexedDB.open("verified-vault");
            r.onerror = () => reject(r.error);
            r.onsuccess = () => {
              const t = r.result.transaction(["chunks", "moments", "clips"], "readonly");
              const g = t.objectStore("chunks").getAll();
              const m = t.objectStore("moments").getAll();
              const cl = t.objectStore("clips").getAll();
              t.oncomplete = () =>
                resolve({
                  events: g.result.flatMap((c) => JSON.parse(c.payload).events).filter((e) => String(e.type).startsWith("witness") || e.wid),
                  videos: g.result.flatMap((c) => JSON.parse(c.payload).events).filter((e) => String(e.type).startsWith("video")),
                  clips: cl.result.map((c) => ({ sha256: c.sha256, bytes: c.bytes, size: c.blob.size })),
                  moment: m.result[m.result.length - 1],
                });
            };
          }),
      );
      const types = ev.events.map((e) => `${e.type}:${e.wid}${e.via ? ":" + e.via : ""}`).join(" ");
      const want = ["witness:w1", "frame:w1", "witness_answer:w1:frame", "witness:w2", "witness_answer:w2:text"];
      want.every((w) => types.includes(w)) ? ok(`chain has witness events: ${types}`) : fail(`witness events missing: ${types}`);
      const vid = ev.videos.find((e) => e.type === "video");
      ev.videos.some((e) => e.type === "video_start") && vid && ev.clips.some((c) => c.sha256 === vid.sha256 && c.size === vid.bytes && c.size > 0)
        ? ok(`chain has video_start + video (${vid.bytes} bytes, ${vid.durationMs} ms), clip in vault with matching sha256`)
        : fail(`video evidence wrong: ${JSON.stringify({ videos: ev.videos, clips: ev.clips })}`);
      const m = ev.moment;
      m.guest === true && m.ownerUid === null && m.witness?.asked === 2 && m.witness?.answered === 2
        ? ok(`journal: guest, ownerUid null, witness ${JSON.stringify(m.witness)}, intention v${m.intention?.v}`)
        : fail(`journal moment wrong: ${JSON.stringify({ guest: m.guest, ownerUid: m.ownerUid, witness: m.witness })}`);
      await page.screenshot({ path: `${OUT}/record-done-${size.name}.png`, fullPage: true });
      await page.goto(BASE + "/me", { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      (await page.getByText("On this device · sign in to verify").count()) ? ok("Me lists the guest Moment") : fail("guest Moment missing on Me");
      await page.screenshot({ path: `${OUT}/me-guest-${size.name}.png`, fullPage: true });
      await page.locator(".me-local h3 a").first().click();
      await page.waitForTimeout(1200);
      (await page.locator(".local-banner").count()) ? ok("local detail renders from the journal") : fail("local detail missing");
      await page.screenshot({ path: `${OUT}/detail-local-${size.name}.png`, fullPage: true });

      // v4: claims + evidence plan (`?plan=demo` canned draft), record screen opens in Video, live checklist,
      // witness asks for an unmet requirement (rid), the clip is chained as a `video` event.
      await page.goto(BASE + "/record?plan=demo&witness=demo", { waitUntil: "networkidle" });
      await page.getByLabel("Type your answer").fill("clap 50 times");
      await page.getByRole("button", { name: "Send" }).click();
      await page.getByRole("heading", { name: "To get this verified" }).waitFor({ timeout: 15_000 });
      const chips = await page.locator(".claim-chip").allInnerTexts();
      const reqs = await page.locator(".plan-card .plan-row").count();
      chips.length === 2 && reqs === 3 ? ok(`v4 end card: claims ${chips.map((c) => c.replace(/\s+/g, " ")).join(" | ")}, ${reqs} requirements`) : fail(`v4 end card: ${chips} / ${reqs}`);
      await page.screenshot({ path: `${OUT}/record-plan-card-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: /^Start Moment/ }).first().click();
      await page.waitForSelector(".live", { timeout: 10_000 });
      (await page.getByRole("radio", { name: "Video" }).getAttribute("aria-checked")) === "true" ? ok("record screen opens in Video mode") : fail("not in Video mode");
      const label0 = await page.locator(".live-plan h2").innerText();
      /0\/3 captured/.test(label0) ? ok(`live checklist: ${label0}`) : fail(`live checklist: ${label0}`);
      await page.getByText("Answer the witness once while you clap").first().waitFor({ timeout: 15_000 });
      ok("witness asks for the unmet witness requirement first");
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: /^Record video/ }).click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${OUT}/record-video-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: /^Stop video/ }).click();
      await page.getByRole("button", { name: /^Record video/ }).waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      const label1 = await page.locator(".live-plan h2").innerText();
      const states = await page.locator(".live-plan .plan-row").evaluateAll((rs) => rs.map((r) => r.className.includes("plan-captured")));
      // r1 (any length) and r3 (rid-tagged answer) captured; r2 needs >= 20 s of continuous video.
      JSON.stringify(states) === "[true,false,true]" ? ok(`checklist after a 3 s clip + answer: ${label1}`) : fail(`checklist states ${JSON.stringify(states)} (${label1})`);
      await page.screenshot({ path: `${OUT}/record-checklist-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: /^Finish/ }).click();
      await page.getByRole("heading", { name: "Moment recorded." }).waitFor({ timeout: 10_000 });
      const v4ev = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const r = indexedDB.open("verified-vault");
            r.onerror = () => reject(r.error);
            r.onsuccess = () => {
              const t = r.result.transaction(["chunks", "moments"], "readonly");
              const g = t.objectStore("chunks").getAll();
              const m = t.objectStore("moments").getAll();
              t.oncomplete = () => {
                const mom = m.result.find((x) => x.intention?.v === 4 && x.intention?.claims?.length);
                const evs = g.result.filter((c) => c.momentId === mom?.id).flatMap((c) => JSON.parse(c.payload).events);
                resolve({ intention: mom?.intention, witness: evs.filter((e) => e.type === "witness"), video: evs.filter((e) => e.type === "video") });
              };
            };
          }),
      );
      const w = v4ev.witness[0];
      w && w.rid === "r3" && Object.keys(w).pop() === "rid" ? ok(`witness event carries rid as its last key: ${JSON.stringify(w)}`) : fail(`witness rid: ${JSON.stringify(v4ev.witness)}`);
      v4ev.video.length === 1 && v4ev.video[0].sha256?.length === 64 ? ok(`clip chained as a video event (${v4ev.video[0].durationMs} ms)`) : fail(`video events: ${JSON.stringify(v4ev.video)}`);
      v4ev.intention?.claims?.length === 2 && v4ev.intention?.plan?.recordMode === "video" ? ok("journal intention v4 with claims + plan") : fail(`intention: ${JSON.stringify(v4ev.intention)}`);
      await page.screenshot({ path: `${OUT}/record-done-v4-${size.name}.png`, fullPage: true });
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
