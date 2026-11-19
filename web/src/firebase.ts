// Firebase wiring: app, App Check (required by AI Logic), Remote Config, and the two
// hybrid models Linger routes between.
//
// Routing is a product decision, not a fallback afterthought:
//
//   readerModel  PREFER_ON_DEVICE  — paragraph help fires many times per page and reveals what
//                                    a reader struggles with. Gemini Nano keeps that private,
//                                    instant and free; the cloud only answers if Nano is absent.
//   figureModel  PREFER_IN_CLOUD   — explaining a chart is rare, multimodal and benefits from a
//                                    larger model. Offline, it still degrades to Nano (which
//                                    accepts PNG/JPEG), so the reader is never left without help.

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  type GenerativeModel,
} from "firebase/ai";
import { fetchAndActivate, getRemoteConfig, getValue } from "firebase/remote-config";
import { DEFAULT_ATTENTION, type AttentionConfig } from "./gaze/attention";

const env = import.meta.env;

export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_APP_ID);

const app = firebaseConfigured
  ? initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
  : null;

if (app) {
  // Debug token for local dev and for judges' testing builds (accepted by the rules).
  const debug = env.VITE_APPCHECK_DEBUG === "true";
  if (debug) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  // In debug mode the provider is never consulted, but App Check must still be initialised so
  // every AI Logic request carries a token once enforcement is on.
  if (env.VITE_RECAPTCHA_ENTERPRISE_KEY || debug) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_KEY || "debug-mode"),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

// ---------------------------------------------------------------- Remote Config

export interface Tuning {
  attention: AttentionConfig;
  cloudModel: string;
  prefetch: boolean;
}

const DEFAULT_TUNING: Tuning = {
  attention: DEFAULT_ATTENTION,
  cloudModel: "gemini-3.5-flash-lite",
  prefetch: true,
};

/** Reading thresholds are tuned live from the console, without shipping a build. */
export async function loadTuning(): Promise<Tuning> {
  if (!app) return DEFAULT_TUNING;
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 10 * 60 * 1000;
    rc.defaultConfig = {
      dwell_ms: DEFAULT_ATTENTION.dwellMs,
      stuck_factor: DEFAULT_ATTENTION.stuckFactor,
      min_stuck_ms: DEFAULT_ATTENTION.minStuckMs,
      max_stuck_ms: DEFAULT_ATTENTION.maxStuckMs,
      reading_wpm: DEFAULT_ATTENTION.wpm,
      cloud_model: DEFAULT_TUNING.cloudModel,
      prefetch_on_device: true,
    };
    await fetchAndActivate(rc);
    return {
      attention: {
        ...DEFAULT_ATTENTION,
        dwellMs: getValue(rc, "dwell_ms").asNumber(),
        stuckFactor: getValue(rc, "stuck_factor").asNumber(),
        minStuckMs: getValue(rc, "min_stuck_ms").asNumber(),
        maxStuckMs: getValue(rc, "max_stuck_ms").asNumber(),
        wpm: getValue(rc, "reading_wpm").asNumber(),
      },
      cloudModel: getValue(rc, "cloud_model").asString(),
      prefetch: getValue(rc, "prefetch_on_device").asBoolean(),
    };
  } catch (err) {
    console.warn("Remote Config unavailable, using defaults", err);
    return DEFAULT_TUNING;
  }
}

// ---------------------------------------------------------------- Models

/** Structured answer for a paragraph. Supported both on-device and in the cloud. */
export const helpSchema = Schema.object({
  properties: {
    plain: Schema.string({ description: "The passage rewritten in plain language, same meaning, shorter sentences." }),
    terms: Schema.array({
      items: Schema.object({
        properties: {
          term: Schema.string(),
          meaning: Schema.string({ description: "One short sentence." }),
        },
      }),
    }),
  },
});

/** The same shape as plain JSON Schema, for the Chrome Prompt API's responseConstraint. */
const helpJsonSchema = {
  type: "object",
  properties: {
    plain: { type: "string" },
    terms: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { term: { type: "string" }, meaning: { type: "string" } },
        required: ["term", "meaning"],
      },
    },
  },
  required: ["plain", "terms"],
};

let reader: GenerativeModel | null = null;
let figure: GenerativeModel | null = null;

export function readerModel(cloudModel: string): GenerativeModel {
  if (!app) throw new Error("Firebase is not configured (see web/.env.example)");
  if (!reader) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    reader = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
        promptOptions: { responseConstraint: helpJsonSchema },
      },
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: "application/json", responseSchema: helpSchema },
      },
    });
  }
  return reader;
}

export function figureModel(cloudModel: string): GenerativeModel {
  if (!app) throw new Error("Firebase is not configured (see web/.env.example)");
  if (!figure) {
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    figure = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_IN_CLOUD,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
      },
      inCloudParams: { model: cloudModel },
    });
  }
  return figure;
}
