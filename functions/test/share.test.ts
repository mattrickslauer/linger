import { describe, expect, it } from "vitest";
import { IMAGE_PATH, MOMENT_PATH, buildShareMeta, escapeHtml, heroJpeg, injectMeta, scorePct, verdictLine } from "../src/share";

const ORIGIN = "https://verified-99e74.web.app";
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString("base64");
const HTML = `<!doctype html><html><head>
    <meta name="description" content="generic" />
    <title>Verified</title>
  </head><body><div id="root"></div></body></html>`;

const sealed = {
  owner: { name: "Ada" },
  intention: { text: "run 5k along the river" },
  status: "sealed",
  verificationScore: 0.874,
  scoreReasons: ["GPS track matches a 5.1 km loop"],
  claimsBacked: 3,
  claimsTotal: 4,
  heroJpegB64: JPEG_B64,
};

describe("share previews", () => {
  it("matches only Moment and image paths", () => {
    expect("/m/abc-123".match(MOMENT_PATH)?.[1]).toBe("abc-123");
    expect("/m/abc/".match(MOMENT_PATH)?.[1]).toBe("abc");
    expect("/m/a/b".match(MOMENT_PATH)).toBeNull();
    expect("/og/abc.jpg".match(IMAGE_PATH)?.[1]).toBe("abc");
    expect("/og/../x.jpg".match(IMAGE_PATH)).toBeNull();
  });

  it("puts the verdict and score in the title and description", () => {
    const m = buildShareMeta(sealed, ORIGIN, "abc");
    expect(m.title).toBe("✓ Verified · 87% verification score — run 5k along the river");
    expect(m.description).toContain("Ada set out to run 5k along the river.");
    expect(m.description).toContain("87% verification score");
    expect(m.description).toContain("3/4 claims backed by evidence");
    expect(m.description).toContain("GPS track matches");
    expect(m.url).toBe(`${ORIGIN}/m/abc`);
    expect(m.image).toBe(`${ORIGIN}/og/abc.jpg`);
  });

  it("says not verified for rejected or cheating Moments, and omits a missing score/image", () => {
    expect(verdictLine({ status: "rejected", verificationScore: 0.2 })).toBe("✗ Not verified · 20% verification score");
    expect(verdictLine({ status: "sealed", cheating: true, verificationScore: 0.9 })).toMatch(/^✗ Not verified/);
    const m = buildShareMeta({ status: "rejected", sealReason: "No GPS", intention: { text: "x" } }, ORIGIN, "z");
    expect(m.title).toBe("✗ Not verified — x");
    expect(m.description).toContain("No GPS");
    expect(m.image).toBeNull();
    expect(scorePct(null)).toBeNull();
    expect(scorePct(1.3)).toBe(100);
  });

  it("injects escaped OG/Twitter tags and replaces title + description", () => {
    const m = buildShareMeta({ ...sealed, intention: { text: `<script>"x"</script>` } }, ORIGIN, "abc");
    const out = injectMeta(HTML, m);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain('content="generic"');
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain(`<title>${escapeHtml(m.title)}</title>`);
    expect(out).toContain(`<meta property="og:image" content="${ORIGIN}/og/abc.jpg" />`);
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(out).toContain(`<meta property="og:description" content="${escapeHtml(m.description)}" />`);
    expect(out.indexOf("og:title")).toBeLessThan(out.indexOf("</head>"));
  });

  it("decodes only real JPEGs", () => {
    expect(heroJpeg(JPEG_B64)?.[0]).toBe(0xff);
    expect(heroJpeg(`data:image/jpeg;base64,${JPEG_B64}`)?.[1]).toBe(0xd8);
    expect(heroJpeg(Buffer.from("not a jpeg").toString("base64"))).toBeNull();
    expect(heroJpeg(null)).toBeNull();
  });
});
