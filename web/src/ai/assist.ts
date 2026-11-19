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

export async function explainParagraph(text: string, cloudModel: string): Promise<Timed<ParagraphHelp>> {
  const t0 = performance.now();
  const res = await readerModel(cloudModel).generateContent(HELP_PROMPT + text + '\n"""');
  const ms = performance.now() - t0;
  const raw = res.response.text();
  return { value: parseHelp(raw), route: routeOf(res.response.inferenceSource), ms };
}

export async function explainFigure(png: string, caption: string, cloudModel: string): Promise<Timed<string>> {
  const t0 = performance.now();
  const res = await figureModel(cloudModel).generateContent([
    `A reader has been staring at this figure. Caption: "${caption}". In 3 short sentences, say what it shows, the single most important takeaway, and how to read its axes. Plain language.`,
    { type: "inlineData", inlineData: { data: png, mimeType: "image/png" } },
  ]);
  return { value: res.response.text().trim(), route: routeOf(res.response.inferenceSource), ms: performance.now() - t0 };
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
