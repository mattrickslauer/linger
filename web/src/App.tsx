import { lazy, Suspense, useEffect, useState } from "react";
import { useUser } from "./auth";
import { configured, FIXTURES, USE_EMULATORS } from "./firebase";
import Feed from "./pages/Feed";
import { useRoute } from "./router";
import { requireSignIn, SignInSheet } from "./signin";
import { Link } from "./ui";

const Detail = lazy(() => import("./pages/Detail"));
const Record = lazy(() => import("./pages/Record"));
const Me = lazy(() => import("./pages/Me"));
const Embed = lazy(() => import("./pages/Embed"));
const ClaimSheet = lazy(() => import("./components/ClaimSheet"));

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
      <header className="top">
        <Link to="/" className="brand">
          <Mark />
          <span>Verified</span>
        </Link>
        <nav aria-label="Main">
          <Link to="/" className={tab === "feed" ? "on" : ""} aria-current={tab === "feed" ? "page" : undefined}>
            Feed
          </Link>
          <Link to="/record" className={tab === "record" ? "on" : ""} aria-current={tab === "record" ? "page" : undefined}>
            Record
          </Link>
          <Link to="/me" className={tab === "me" ? "on" : ""} aria-current={tab === "me" ? "page" : undefined}>
            {user?.photoURL ? <img className="nav-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : null}
            Me
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
      {(FIXTURES || USE_EMULATORS) && <p className="modebar">{FIXTURES ? "Sample data mode: nothing here touches Firebase." : "Emulator mode: local Auth and Firestore."}</p>}
      <SignInSheet />
      {configured && (
        <Suspense fallback={null}>
          <ClaimSheet user={user} />
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
              <p>There's nothing at this address.</p>
              <Link to="/" className="btn">
                Back to the feed
              </Link>
            </div>
          )}
        </Suspense>
      </main>
      <footer className="foot">
        <p>
          Built for the Firebase #BuildHybridAI hackathon. On-device and cloud AI through Firebase AI Logic; data in Firestore; seals by Cloud
          Functions.{" "}
          <Link to="/embed">Embed Verified into your app</Link> (coming soon).
        </p>
      </footer>
    </>
  );
}
