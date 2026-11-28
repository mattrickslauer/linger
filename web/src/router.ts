// A 30-line path router: five routes do not need a dependency.
import { useEffect, useState } from "react";

export type Route = { name: "feed" } | { name: "moment"; id: string } | { name: "record" } | { name: "me" } | { name: "embed" } | { name: "download" } | { name: "missing" };

export function parse(path: string): Route {
  if (path === "/" || path === "") return { name: "feed" };
  const m = path.match(/^\/m\/([\w-]+)\/?$/);
  if (m) return { name: "moment", id: m[1] };
  if (/^\/record\/?$/.test(path)) return { name: "record" };
  if (/^\/me\/?$/.test(path)) return { name: "me" };
  if (/^\/embed\/?$/.test(path)) return { name: "embed" };
  if (/^\/(download|get)\/?$/.test(path)) return { name: "download" };
  return { name: "missing" };
}

export function navigate(to: string) {
  if (to === location.pathname) return;
  history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, set] = useState(() => parse(location.pathname));
  useEffect(() => {
    const on = () => set(parse(location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}

/** Intercept plain left-clicks on same-origin links. */
export function linkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = e.currentTarget.getAttribute("href");
  if (!href || !href.startsWith("/")) return;
  e.preventDefault();
  navigate(href);
}
