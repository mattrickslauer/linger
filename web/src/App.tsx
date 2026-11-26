import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useUser } from "./auth";
import { configured, FIXTURES, USE_EMULATORS } from "./firebase";
import Feed from "./pages/Feed";
import { useRoute } from "./router";
import { requireSignIn, SignInSheet } from "./signin";
import { Link } from "./ui";
import { Glyph } from "./kit";

const Detail = lazy(() => import("./pages/Detail"));
const Record = lazy(() => import("./pages/Record"));
const Me = lazy(() => import("./pages/Me"));
const Embed = lazy(() => import("./pages/Embed"));
const ClaimSheet = lazy(() => import("./components/ClaimSheet"));
const PurchaseReturn = lazy(() => import("./components/BuyCredits").then((m) => ({ default: m.PurchaseReturn })));

type Theme = "system" | "light" | "dark";
function useTheme(): [Theme, () => void] {
  const [theme, set] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  const order: Theme[] = ["system", "dark", "light"];
  return [theme, () => set(order[(order.indexOf(theme) + 1) % order.length])];
}

function Mark() {
  // A seal ring with a check, drawn as a track that closes on itself.
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" />
      <path d="M9.5 16.5l4.2 4.2 8.8-9.4" />
    </svg>
  );
}

export default function App() {
  const route = useRoute();
  const { user, ready } = useUser();
  const [theme, cycleTheme] = useTheme();
  const tab = route.name === "moment" ? "feed" : route.name;
  const immersive = route.name === "feed";
  // --topbar: the measured height of the top bar (safe-area inset and font scaling included), so every
  // sticky bar and full-height screen below it uses one number instead of a hardcoded 61px.
  const topRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const set = () => document.documentElement.style.setProperty("--topbar", `${el.getBoundingClientRect().height}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el, { box: "border-box" });
    set();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    document.body.classList.toggle("immersive", immersive);
  }, [immersive]);
  useEffect(() => {
    document.body.dataset.route = route.name;
  }, [route.name]);
  // Browser chrome (theme-color) follows the page: always dark on the feed, else the paper colour.
  useEffect(() => {
    const m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!m) return;
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    m.content = immersive ? "#071419" : dark ? "#0f2127" : "#e8ece4";
  }, [immersive, theme]);
  useEffect(() => {
    document.title = route.name === "embed" ? "Embed Verified into your app" : "Verified";
  }, [route.name]);
  // Raw vault: verify on start, on sign-in and every 30 s (no-op in fixture mode).
  useEffect(() => {
    if (configured) void import("./vault").then((v) => v.startVault());
  }, []);

  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header className="top" ref={topRef}>
        <Link to="/" className="brand">
          <Mark />
          <span>Verified</span>
        </Link>
        {(FIXTURES || USE_EMULATORS) && (
          <span className="modepill" title={FIXTURES ? "Sample data mode: nothing here touches Firebase." : "Emulator mode: local Auth and Firestore."}>
            {FIXTURES ? "Sample data" : "Emulators"}
          </span>
        )}
        <nav aria-label="Main" className="tabs">
          <Link to="/" className={tab === "feed" ? "on" : ""} aria-current={tab === "feed" ? "page" : undefined}>
            <Glyph name="feed" />
            <span>Feed</span>
          </Link>
          <Link to="/record" className={`tab-record ${tab === "record" ? "on" : ""}`} aria-current={tab === "record" ? "page" : undefined}>
            <Glyph name="record" />
            <span>Record</span>
          </Link>
          <Link to="/me" className={tab === "me" ? "on" : ""} aria-current={tab === "me" ? "page" : undefined}>
            {user?.photoURL ? <img className="nav-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" width={22} height={22} /> : <Glyph name="me" />}
            <span>Me</span>
          </Link>
        </nav>
        {ready && !user && configured && (
          <button className="btn btn-quiet btn-small signin-top" onClick={() => requireSignIn("sync your Moments").catch(() => {})}>
            Sign in
          </button>
        )}
        <button className="theme" onClick={cycleTheme} aria-label={`Theme: ${theme}. Switch theme`} title={`Theme: ${theme}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 1 0 16z" className="half" />
          </svg>
        </button>
      </header>
      <SignInSheet />
      {configured && (
        <Suspense fallback={null}>
          <ClaimSheet user={user} />
          <PurchaseReturn user={user} ready={ready} />
        </Suspense>
      )}
      <main id="main">
        <Suspense fallback={<div className="page" aria-busy="true" />}>
          {route.name === "feed" && <Feed user={user} />}
          {route.name === "moment" && <Detail id={route.id} />}
          {route.name === "record" && <Record user={user} ready={ready} />}
          {route.name === "me" && <Me user={user} ready={ready} />}
          {route.name === "embed" && <Embed />}
          {route.name === "missing" && (
            <div className="page empty">
              <Glyph name="gps" className="empty-glyph" />
              <p>Nothing at this address.</p>
              <Link to="/" className="btn">
                Back to the feed
              </Link>
            </div>
          )}
        </Suspense>
      </main>
      <footer className="foot" hidden={immersive}>
        <p>
          <span>#BuildHybridAI · AI on device and in the cloud, sealed by Cloud Functions</span>
          <Link to="/embed">
            <Glyph name="code" /> Embed Verified (soon)
          </Link>
        </p>
      </footer>
    </>
  );
}
