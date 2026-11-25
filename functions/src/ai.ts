// Server-side Gemini for the agents that run in Cloud Functions (prompt `runsIn: "functions"`, all ONLY_IN_CLOUD):
// the bar agent and the ladder modules. Prompts and JSON schemas come from shared/prompts.json, exactly like the
// clients' Firebase AI Logic calls; the server calls the Gemini API on Vertex AI in the same Firebase project with
// the function's service account, so no key ever reaches a device.
//
// Engines (env VERIFIED_AI):
//   "vertex" (default when deployed)  Gemini on Vertex AI via @google/genai; model from CLOUD_MODEL (default
//                                     gemini-3.5-flash, the contract's `cloud_model` default), VERIFIED_AI_LOCATION
//                                     (default "global").
//   "fake"   (default in the emulator) deterministic answers supplied by each call site, so emulator e2e runs need
//                                     no credentials. Any variable containing "#ai-fail" makes it throw (refund test).
import { getPrompt } from "./shared";

export type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } };

export interface AiCall {
  /** Key in shared/prompts.json; must be `runsIn: "functions"`. */
  prompt: string;
  vars: Record<string, string>;
  /** Images (inlineData) and videos (fileData gs:// URI) after the text. */
  media?: Part[];
  /** Deterministic answer for the fake engine (emulator / tests). */
  fake: () => unknown;
}

export interface AiAnswer {
  data: Record<string, unknown>;
  model: string;
}

export interface AiEngine {
  name: string;
  generateJson(call: AiCall): Promise<AiAnswer>;
}

export const DEFAULT_CLOUD_MODEL = "gemini-3.5-flash";

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (k in vars ? vars[k] : ""));
}

function checkPrompt(key: string) {
  const p = getPrompt(key);
  if (p.runsIn !== "functions" || p.mode !== "ONLY_IN_CLOUD") throw new Error(`prompt ${key} is not a cloud-only functions prompt`);
  return p;
}

export const fakeEngine: AiEngine = {
  name: "fake",
  async generateJson(call) {
    checkPrompt(call.prompt);
    if (Object.values(call.vars).some((v) => v.includes("#ai-fail"))) throw new Error("fake engine: forced model failure");
    const data = call.fake();
    if (!data || typeof data !== "object") throw new Error("fake engine: no answer");
    return { data: data as Record<string, unknown>, model: "fake-emulator" };
  },
};

function vertexEngine(): AiEngine {
  // Lazy import keeps cold starts of the non-AI functions small.
  let client: import("@google/genai").GoogleGenAI | null = null;
  return {
    name: "vertex",
    async generateJson(call) {
      const p = checkPrompt(call.prompt);
      if (!client) {
        const { GoogleGenAI } = await import("@google/genai");
        const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
        client = new GoogleGenAI({ vertexai: true, project, location: process.env.VERIFIED_AI_LOCATION || "global" });
      }
      const model = process.env.CLOUD_MODEL || DEFAULT_CLOUD_MODEL;
      const res = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: fillTemplate(p.user, call.vars) }, ...(call.media ?? [])] }],
        config: {
          systemInstruction: p.system,
          responseMimeType: "application/json",
          responseJsonSchema: p.schema,
          temperature: 0.2,
          httpOptions: { timeout: 90_000 },
        },
      });
      const text = res.text ?? "";
      const data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("model returned no JSON object");
      return { data, model: res.modelVersion || model };
    },
  };
}

let engine: AiEngine | null = null;

export function getEngine(): AiEngine {
  if (engine) return engine;
  const want = process.env.VERIFIED_AI || (process.env.FUNCTIONS_EMULATOR === "true" ? "fake" : "vertex");
  engine = want === "fake" ? fakeEngine : vertexEngine();
  return engine;
}

/** Tests inject an engine. */
export function setEngine(e: AiEngine | null): void {
  engine = e;
}

// ───────────────────────────────── output coercion (the model proposes; code validates)

export const asNumber = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
export const asStrings = (v: unknown, max: number, len = 160): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((s) => s.trim().slice(0, len)).slice(0, max) : [];
