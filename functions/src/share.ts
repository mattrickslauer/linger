// Link previews for shared Moments. The web app is a client-rendered SPA, so chat apps and social crawlers (which do
// not run JS) would only ever see the generic <head>. Hosting rewrites /m/:id and /og/:id.jpg to `sharePage`, which
// reads the PUBLIC feed doc (never the owner-only moment) and returns index.html with per-Moment Open Graph / Twitter
// tags, plus the Moment's proof shot as the preview image. Pure helpers live here so they can be tested without
// Firestore.

/** The subset of a feed doc a preview needs (functions/src/index.ts writes these on seal). */
export interface ShareFeed {
  owner?: { name?: string | null } | null;
  intention?: { text?: string | null } | null;
  status?: "sealed" | "rejected" | string;
  verificationScore?: number | null;
  sealReason?: string | null;
  scoreReasons?: string[] | null;
  judgeReasons?: string[] | null;
  claimsBacked?: number | null;
  claimsTotal?: number | null;
  cheating?: boolean | null;
  heroJpegB64?: string | null;
}

export interface ShareMeta {
  title: string;
  description: string;
  url: string;
  image: string | null;
  imageAlt: string | null;
}

/** Matches the web router's `/m/:id` (web/src/router.ts). */
export const MOMENT_PATH = /^\/m\/([\w-]+)\/?$/;
export const IMAGE_PATH = /^\/og\/([\w-]+)\.jpg$/;

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

/** Same rounding as the feed's `pct` (web/src/pages/Feed.tsx). */
export const scorePct = (p: number | null | undefined): number | null =>
  typeof p === "number" && Number.isFinite(p) ? Math.round(Math.min(1, Math.max(0, p)) * 100) : null;

/** One line verdict, e.g. "Verified · 87% verification score". Shared by the title and the share text. */
export function verdictLine(f: ShareFeed): string {
  const pct = scorePct(f.verificationScore);
  const sealed = f.status === "sealed" && !f.cheating;
  const verdict = sealed ? "✓ Verified" : "✗ Not verified";
  return pct == null ? verdict : `${verdict} · ${pct}% verification score`;
}

export function buildShareMeta(f: ShareFeed, origin: string, momentId: string): ShareMeta {
  const intent = clip(f.intention?.text || "a Moment", 120);
  const who = clip(f.owner?.name || "Someone", 40);
  const sealed = f.status === "sealed" && !f.cheating;
  const reason = f.cheating ? f.sealReason : sealed ? (f.scoreReasons?.[0] ?? f.judgeReasons?.[0]) : f.sealReason;
  const claims = f.claimsTotal ? `${f.claimsBacked ?? 0}/${f.claimsTotal} claims backed by evidence` : null;
  const description = [`${who} set out to ${intent}.`, `${verdictLine(f)}.`, claims ? `${claims}.` : null, reason ? clip(reason, 160) : null]
    .filter(Boolean)
    .join(" ");
  const hasImage = typeof f.heroJpegB64 === "string" && f.heroJpegB64.length > 0;
  return {
    title: clip(`${verdictLine(f)} — ${intent}`, 140),
    description: clip(description, 300),
    url: `${origin}/m/${momentId}`,
    image: hasImage ? `${origin}/og/${momentId}.jpg` : null,
    imageAlt: hasImage ? clip(`Proof shot: ${intent}`, 200) : null,
  };
}

/** Rewrites the built index.html: replaces <title> and the description, appends OG/Twitter tags before </head>. */
export function injectMeta(html: string, m: ShareMeta): string {
  const e = escapeHtml;
  const prop = (k: string, v: string) => `<meta property="${k}" content="${e(v)}" />`;
  const name = (k: string, v: string) => `<meta name="${k}" content="${e(v)}" />`;
  const tags = [
    `<link rel="canonical" href="${e(m.url)}" />`,
    prop("og:site_name", "Verified"),
    prop("og:type", "article"),
    prop("og:title", m.title),
    prop("og:description", m.description),
    prop("og:url", m.url),
    ...(m.image ? [prop("og:image", m.image), prop("og:image:type", "image/jpeg"), prop("og:image:alt", m.imageAlt ?? m.title)] : []),
    name("twitter:card", m.image ? "summary_large_image" : "summary"),
    name("twitter:title", m.title),
    name("twitter:description", m.description),
    ...(m.image ? [name("twitter:image", m.image), name("twitter:image:alt", m.imageAlt ?? m.title)] : []),
  ].join("\n    ");
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${e(m.title)}</title>`);
  const desc = name("description", m.description);
  out = /<meta\s+name="description"[^>]*>/i.test(out) ? out.replace(/<meta\s+name="description"[^>]*>/i, desc) : out;
  return out.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

/** Decodes the feed's proof shot (base64 JPEG, optionally a data: URL). */
export function heroJpeg(b64: string | null | undefined): Buffer | null {
  if (!b64) return null;
  const raw = b64.replace(/^data:image\/[\w+.-]+;base64,/, "");
  const buf = Buffer.from(raw, "base64");
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? buf : null;
}
