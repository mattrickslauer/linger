// Firebase wiring: app, App Check (AI Logic), Auth, offline-first Firestore, Remote Config and the
// three Firebase AI Logic models Verified routes between.
//
//   liveCheck  PREFER_ON_DEVICE  every proof frame, many per session, often at a lake with no signal.
//                                Gemini Nano in Chrome answers instantly and privately; cloud otherwise.
//   judge      ONLY_IN_CLOUD     once per Moment, multimodal, needs the larger model.
//   skeptic    ONLY_IN_CLOUD     a second, adversarial opinion from a separate prompt.
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
      live = judge = skeptic = null;
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

function cloudOpinionModel(system: string): GenerativeModel {
  return getGenerativeModel(ai(), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: cloudModelName,
      systemInstruction: system,
      generationConfig: { responseMimeType: "application/json", responseSchema: opinionSchema },
    },
  });
}

export function judgeModel(): GenerativeModel {
  return (judge ??= cloudOpinionModel(prompts.judge.system));
}
export function skepticModel(): GenerativeModel {
  return (skeptic ??= cloudOpinionModel(prompts.skeptic.system));
}

export { prompts };
