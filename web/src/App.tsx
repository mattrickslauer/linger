import { lazy, Suspense, useEffect, useState } from "react";
import { useUser } from "./auth";
import { FIXTURES, USE_EMULATORS } from "./firebase";
import Feed from "./pages/Feed";
import { useRoute } from "./router";
import { Link } from "./ui";

const Detail = lazy(() => import("./pages/Detail"));
const Record = lazy(() => import("./pages/Record"));
const Me = lazy(() => import("./pages/Me"));

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
        <button className="theme" onClick={cycleTheme} aria-label={`Theme: ${theme}. Switch theme`} title={`Theme: ${theme}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 1 0 16z" className="half" />
          </svg>
        </button>
      </header>
      {(FIXTURES || USE_EMULATORS) && <p className="modebar">{FIXTURES ? "Sample data mode: nothing here touches Firebase." : "Emulator mode: local Auth and Firestore."}</p>}
      <main id="main">
        <Suspense fallback={<div className="page" aria-busy="true" />}>
          {route.name === "feed" && <Feed />}
          {route.name === "moment" && <Detail id={route.id} />}
          {route.name === "record" && <Record user={user} ready={ready} />}
          {route.name === "me" && <Me user={user} ready={ready} />}
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
          Functions.
        </p>
      </footer>
    </>
  );
}
