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
export async function onDeviceAvailability(): Promise<"available" | "downloadable" | "downloading" | "unavailable"> {
  const LM = (globalThis as unknown as { LanguageModel?: { availability: (o?: object) => Promise<string> } })
    .LanguageModel;
  if (!LM) return "unavailable";
  try {
    return (await LM.availability({ expectedInputs: [{ type: "text", languages: ["en"] }] })) as
      | "available"
      | "downloadable"
      | "downloading"
      | "unavailable";
  } catch {
    return "unavailable";
  }
}
