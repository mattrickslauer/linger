// /download (alias /get): the native apps. iPhone through the TestFlight public beta, Android as a sideloaded
// APK from GitHub Releases. Same account, same feed, same seal as the web app.
import { Glyph } from "../kit";
import { Link } from "../ui";

export const TESTFLIGHT_URL = "https://testflight.apple.com/join/8SGF1Pqr";
const RELEASES = "https://github.com/mattrickslauer/verified/releases";
/** Always the newest release's asset, so the link never needs a redeploy. The release asset must be named Verified.apk. */
export const APK_URL = `${RELEASES}/latest/download/Verified.apk`;

type Platform = "ios" | "android" | "other";
function platform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  // iPadOS reports itself as a Mac; touch points give it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "other";
}

function IosCard({ mine }: { mine: boolean }) {
  return (
    <article className={`dl-card ${mine ? "dl-mine" : ""}`} aria-labelledby="dl-ios">
      <div className="dl-head">
        <span className="dl-glyph" aria-hidden="true">
          <Glyph name="device" />
        </span>
        <div>
          <h2 id="dl-ios">iPhone</h2>
          <p className="muted small">TestFlight public beta · iOS 26+</p>
        </div>
        {mine && <span className="chip">Your device</span>}
      </div>
      <a className="btn btn-primary dl-btn" href={TESTFLIGHT_URL} target="_blank" rel="noopener noreferrer">
        <Glyph name="download" /> Join the TestFlight beta
      </a>
      <ol className="dl-steps small">
        <li>
          Install Apple's{" "}
          <a href="https://apps.apple.com/app/testflight/id899247664" target="_blank" rel="noopener noreferrer">
            TestFlight
          </a>{" "}
          app.
        </li>
        <li>Open the beta link on your iPhone and tap Accept, then Install.</li>
        <li>On-device AI uses Apple Foundation Models where Apple Intelligence is on; otherwise it falls back to the cloud.</li>
      </ol>
    </article>
  );
}

function AndroidCard({ mine }: { mine: boolean }) {
  return (
    <article className={`dl-card ${mine ? "dl-mine" : ""}`} aria-labelledby="dl-android">
      <div className="dl-head">
        <span className="dl-glyph" aria-hidden="true">
          <Glyph name="device" />
        </span>
        <div>
          <h2 id="dl-android">Android</h2>
          <p className="muted small">APK · Android 10+</p>
        </div>
        {mine && <span className="chip">Your device</span>}
      </div>
      <a className="btn btn-primary dl-btn" href={APK_URL} rel="noopener">
        <Glyph name="download" /> Download the APK
      </a>
      <ol className="dl-steps small">
        <li>Download the APK on your phone (or copy it over).</li>
        <li>Open it and allow your browser or file manager to install unknown apps when Android asks.</li>
        <li>On-device AI uses Gemini Nano on supported phones; otherwise it falls back to the cloud.</li>
      </ol>
      <p className="muted small">
        All builds and release notes are on{" "}
        <a href={RELEASES} target="_blank" rel="noopener noreferrer">
          GitHub Releases
        </a>
        .
      </p>
    </article>
  );
}

export default function Download() {
  const p = platform();
  const cards = [<IosCard key="ios" mine={p === "ios"} />, <AndroidCard key="android" mine={p === "android"} />];
  if (p === "android") cards.reverse();
  return (
    <div className="page dl">
      <section className="dl-hero" aria-labelledby="dl-h">
        <h1 id="dl-h">Verified on your phone.</h1>
        <p className="lede">
          The native apps record with the full sensor set and run the coach on device. Same account, same feed, same seal as
          the web.
        </p>
      </section>
      <div className="dl-cards">{cards}</div>
      <p className="muted small dl-web">
        No install needed to try it: <Link to="/record">record a Moment in this browser</Link>. On-device AI on the web runs
        on Gemini Nano in Chrome.
      </p>
    </div>
  );
}
