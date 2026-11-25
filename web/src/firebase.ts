// Firebase wiring: app, App Check (AI Logic), Auth, offline-first Firestore, Remote Config and the
// four Firebase AI Logic models Verified routes between.
//
//   liveCheck  PREFER_ON_DEVICE  every proof frame, many per session, often at a lake with no signal.
//                                Gemini Nano in Chrome answers instantly and privately; cloud otherwise.
//   judge      ONLY_IN_CLOUD     once per Moment, multimodal, needs the larger model.
//   skeptic    ONLY_IN_CLOUD     a second, adversarial opinion from a separate prompt.
//   scorer     ONLY_IN_CLOUD     P(claim true | evidence), assuming most submissions cheat (prior 0.2).
// v3 (docs/ARCHITECTURE.md v3.10), all through the same hybrid API:
//   interviewTurn       PREFER_ON_DEVICE  short spoken follow-ups; fast, private, works with no signal
//   structureIntention  ONLY_IN_CLOUD     one final pass that normalises the claim into the shared structure
//   barPreview          PREFER_ON_DEVICE  a preview only; the binding bar is set server-side by a Cloud Function
//   witnessDraft        PREFER_ON_DEVICE  the witness drafts its next request on the device, offline too
//   witnessRefine       ONLY_IN_CLOUD     with signal, a cloud model sees the latest frames and may improve it
//
// Modes:  VITE_FIXTURES=true      no Firebase at all; feed + detail render built-in sample data
//         VITE_USE_EMULATORS=true Auth + Firestore talk to the local Emulator Suite

import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema, type GenerativeModel } from "firebase/ai";
import { fetchAndActivate, getRemoteConfig, getValue } from "firebase/remote-config";
import prompts from "../../shared/prompts.json";

const env = import.meta.env;

export const FIXTURES = env.VITE_FIXTURES === "true";
export const USE_EMULATORS = env.VITE_USE_EMULATORS === "true";
export const configured = !FIXTURES && Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_APP_ID);

export const app: FirebaseApp | null = configured
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
  const debug = env.VITE_APPCHECK_DEBUG === "true";
  if (debug) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  if (env.VITE_RECAPTCHA_ENTERPRISE_KEY || debug) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_KEY || "debug-mode"),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

const emuHost = env.VITE_EMULATOR_HOST || "127.0.0.1";

export const auth: Auth | null = app ? getAuth(app) : null;
if (auth && USE_EMULATORS) connectAuthEmulator(auth, `http://${emuHost}:${env.VITE_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });

// Offline-first: every write lands in IndexedDB immediately and syncs when the network returns.
export const db: Firestore | null = app
  ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
  : null;
if (db && USE_EMULATORS) connectFirestoreEmulator(db, emuHost, Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080));

// ---------------------------------------------------------------- Remote Config

const DEFAULT_CLOUD_MODEL = "gemini-3.5-flash";
let cloudModelName = DEFAULT_CLOUD_MODEL;

/** Contract: the cloud model name comes from Remote Config key `cloud_model`. */
export async function loadCloudModel(): Promise<string> {
  if (!app || !navigator.onLine || USE_EMULATORS) return cloudModelName;
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 10 * 60 * 1000;
    rc.defaultConfig = { cloud_model: DEFAULT_CLOUD_MODEL };
    await fetchAndActivate(rc);
    const name = getValue(rc, "cloud_model").asString() || DEFAULT_CLOUD_MODEL;
    if (name !== cloudModelName) {
      cloudModelName = name;
      // Models built before Remote Config answered hold the old name; rebuild them on next use.
      live = judge = skeptic = scorer = null;
      v3models.clear();
    }
  } catch (err) {
    console.warn("Remote Config unavailable, using default model", err);
  }
  return cloudModelName;
}
export const cloudModel = () => cloudModelName;

// ---------------------------------------------------------------- Models

const opinionSchema = Schema.object({
  properties: {
    verdict: Schema.enumString({ enum: ["consistent", "inconsistent", "uncertain"] }),
    confidence: Schema.number(),
    reasons: Schema.array({ items: Schema.string() }),
  },
});

const scoreSchema = Schema.object({
  properties: {
    probability: Schema.number({ description: "P(claim true | evidence), 0..1" }),
    reasons: Schema.array({ items: Schema.string() }),
  },
});

const liveCheckSchema = Schema.object({
  properties: {
    ok: Schema.boolean(),
    reason: Schema.string(),
    label: Schema.string({ description: "2-4 word description of what is in the frame" }),
  },
});

let live: GenerativeModel | null = null;
let judge: GenerativeModel | null = null;
let skeptic: GenerativeModel | null = null;
let scorer: GenerativeModel | null = null;

function ai() {
  if (!app) throw new Error("Firebase is not configured (see web/.env.example)");
  return getAI(app, { backend: new GoogleAIBackend() });
}

/** Per-frame coach. Gemini Nano with image input when Chrome has it, else the cloud model. */
export function liveCheckModel(): GenerativeModel {
  if (!live) {
    live = getGenerativeModel(ai(), {
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
        promptOptions: { responseConstraint: prompts.liveCheck.schema },
      },
      inCloudParams: {
        // No systemInstruction here: the on-device path ignores it, so ai.ts puts the system text in
        // the prompt itself and both routes see identical words.
        model: cloudModelName,
        generationConfig: { responseMimeType: "application/json", responseSchema: liveCheckSchema },
      },
    });
  }
  return live;
}

function cloudOpinionModel(system: string, responseSchema = opinionSchema): GenerativeModel {
  return getGenerativeModel(ai(), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: cloudModelName,
      systemInstruction: system,
      generationConfig: { responseMimeType: "application/json", responseSchema },
    },
  });
}

export function judgeModel(): GenerativeModel {
  return (judge ??= cloudOpinionModel(prompts.judge.system));
}
export function skepticModel(): GenerativeModel {
  return (skeptic ??= cloudOpinionModel(prompts.skeptic.system));
}
/** P(claim true | evidence) under a cheater-heavy prior. */
export function scorerModel(): GenerativeModel {
  return (scorer ??= cloudOpinionModel(prompts.scorer.system, scoreSchema));
}

// ---------------------------------------------------------------- v3 prompt models

export type V3Prompt = "interviewTurn" | "structureIntention" | "barPreview" | "witnessDraft" | "witnessRefine";
const v3models = new Map<V3Prompt, GenerativeModel>();

/**
 * One model per v3 prompt, routed by the prompt's own `mode` in shared/prompts.json. On-device answers are
 * constrained by the same JSON schema (Chrome Prompt API `responseConstraint`) as the cloud's `responseJsonSchema`.
 * The on-device path ignores systemInstruction, so ai.ts puts the system text in the prompt for both routes.
 */
export function promptModel(name: V3Prompt): GenerativeModel {
  let m = v3models.get(name);
  if (!m) {
    const p = prompts[name] as { mode: string; schema: Record<string, unknown> };
    const inCloudParams = {
      model: cloudModelName,
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: p.schema },
    };
    m =
      p.mode === "PREFER_ON_DEVICE"
        ? getGenerativeModel(ai(), {
            mode: InferenceMode.PREFER_ON_DEVICE,
            onDeviceParams: {
              createOptions: {
                expectedInputs: [{ type: "text", languages: ["en"] }],
                expectedOutputs: [{ type: "text", languages: ["en"] }],
              },
              promptOptions: { responseConstraint: p.schema },
            },
            inCloudParams,
          })
        : getGenerativeModel(ai(), { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams });
    v3models.set(name, m);
  }
  return m;
}

export { prompts };
