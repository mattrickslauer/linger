// The two things Linger asks a model to do, with timing and routing recorded for the UI.

import { InferenceSource } from "firebase/ai";
import { figureModel, readerModel } from "../firebase";

export type Route = "on-device" | "cloud";

export interface Timed<T> {
  value: T;
  route: Route;
  ms: number;
}

export interface ParagraphHelp {
  plain: string;
  terms: { term: string; meaning: string }[];
}

function routeOf(src: string | undefined): Route {
  return src === InferenceSource.ON_DEVICE ? "on-device" : "cloud";
}

const HELP_PROMPT = `You help a reader who is stuck on a passage. Rewrite it in plain language a 12-year-old could follow, keeping every fact. Then list up to 3 terms from the passage that most likely confused them, each with a one-sentence meaning.
Reply as JSON: {"plain": string, "terms": [{"term": string, "meaning": string}]}.

Passage:
"""
`;

/** Help that arrives after the reader has given up is useless. The SDK default is 180 s. */
export const PARAGRAPH_TIMEOUT_MS = 20_000;
export const FIGURE_TIMEOUT_MS = 30_000;

/** The SDK timeout covers cloud requests; the race also bounds on-device calls. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function explainParagraph(text: string, cloudModel: string): Promise<Timed<ParagraphHelp>> {
  const t0 = performance.now();
  const res = await withTimeout(
    readerModel(cloudModel).generateContent(HELP_PROMPT + text + '\n"""', { timeout: PARAGRAPH_TIMEOUT_MS }),
    PARAGRAPH_TIMEOUT_MS + 1000,
  );
  const ms = performance.now() - t0;
  const raw = res.response.text();
  return { value: parseHelp(raw), route: routeOf(res.response.inferenceSource), ms };
}

export async function explainFigure(png: string, caption: string, cloudModel: string): Promise<Timed<string>> {
  const t0 = performance.now();
  const res = await withTimeout(
    figureModel(cloudModel).generateContent(
      [
        `A reader has been staring at this figure. Caption: "${caption}". In 3 short sentences, say what it shows, the single most important takeaway, and how to read its axes. Plain language.`,
        { type: "inlineData", inlineData: { data: png, mimeType: "image/png" } },
      ],
      { timeout: FIGURE_TIMEOUT_MS },
    ),
    FIGURE_TIMEOUT_MS + 1000,
  );
  return { value: res.response.text().trim(), route: routeOf(res.response.inferenceSource), ms: performance.now() - t0 };
}

/** Turn SDK errors into something a reader can act on. The raw message goes to the console. */
export function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  console.warn("Linger help failed:", raw);
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "You're offline and this browser has no on-device model, so help will come back when you reconnect.";
  if (/timeout|timed out|abort/i.test(raw)) return "This is taking too long. Try again in a moment.";
  if (/app ?check|appCheck/i.test(raw)) return "Linger couldn't verify this browser. Reload the page and try again.";
  if (/genai config not found|API_NOT_ENABLED|PERMISSION_DENIED|403/i.test(raw))
    return "The help service isn't switched on for this site yet.";
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(raw)) return "Too many requests right now. Try again in a minute.";
  if (/fetch|network|Failed to fetch|5\d\d/i.test(raw)) return "Couldn't reach the help service. Check your connection and try again.";
  return "Something went wrong writing this help. Try again.";
}

export function parseHelp(raw: string): ParagraphHelp {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    const j = JSON.parse(cleaned) as Partial<ParagraphHelp>;
    return {
      plain: String(j.plain ?? "").trim() || cleaned,
      terms: Array.isArray(j.terms)
        ? j.terms.filter((t) => t && t.term && t.meaning).slice(0, 3)
        : [],
    };
  } catch {
    return { plain: cleaned, terms: [] };
  }
}

/** Is Gemini Nano usable in this browser right now? Used to decide speculative prefetch. */
export type NanoState = "available" | "downloadable" | "downloading" | "unavailable";

export interface NanoReport {
  state: NanoState;
  /** what Chrome actually said, for the diagnostics panel */
  hasPromptApi: boolean;
  raw: string;
  browser: string;
}

// Same options the reader model uses, so this matches what the Firebase SDK will see.
const NANO_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

function browserName(): string {
  const brands = (navigator as unknown as { userAgentData?: { brands: { brand: string; version: string }[] } }).userAgentData?.brands;
  const real = brands?.find((b) => !/Not.?A.?Brand/i.test(b.brand) && b.brand !== "Chromium");
  const chromium = brands?.find((b) => b.brand === "Chromium");
  if (real) return `${real.brand} ${real.version}`;
  if (chromium) return `Chromium ${chromium.version}`;
  return navigator.userAgent.match(/(Firefox|Safari|Chrome)\/[\d.]+/)?.[0] ?? "unknown";
}

export async function nanoReport(): Promise<NanoReport> {
  const LM = (globalThis as unknown as { LanguageModel?: { availability: (o?: object) => Promise<string> } }).LanguageModel;
  const browser = browserName();
  if (!LM) return { state: "unavailable", hasPromptApi: false, raw: "LanguageModel is not defined", browser };
  try {
    const raw = await LM.availability(NANO_OPTIONS);
    const state: NanoState = raw === "available" || raw === "downloadable" || raw === "downloading" ? raw : "unavailable";
    return { state, hasPromptApi: true, raw, browser };
  } catch (e) {
    return { state: "unavailable", hasPromptApi: true, raw: e instanceof Error ? e.message : String(e), browser };
  }
}

/** Is Gemini Nano usable in this browser right now? Used to decide speculative prefetch. */
export async function onDeviceAvailability(): Promise<NanoState> {
  return (await nanoReport()).state;
}
