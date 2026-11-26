// Loads the cross-platform contract files from shared/ (prompts.json, ladder.json).
// Deployed functions read the copies that `npm run build` puts in lib/shared/ (only functions/ is uploaded);
// tests and ts sources fall back to the repo's shared/ folder.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readShared<T>(name: string): T {
  const candidates = [join(__dirname, "shared", name), join(__dirname, "..", "..", "shared", name)];
  for (const p of candidates) if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) as T;
  throw new Error(`shared/${name} not found (looked in ${candidates.join(", ")})`);
}

export interface PromptDef {
  mode: "PREFER_ON_DEVICE" | "ONLY_IN_CLOUD";
  runsIn: "client" | "functions";
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

export type ModuleId = "second_look" | "place_time" | "witness_review" | "count_measure" | "full_video" | "human_review";
export type Need = "frames" | "gps" | "witness_answered" | "quantities" | "video";

export interface ModuleDef {
  id: ModuleId;
  title: string;
  blurb: string;
  cost: number;
  strength: number;
  available: boolean;
  needs: Need[];
  /** v4: the claim kinds this module can back (moves only those claims' scores). */
  backs: import("./v4").ClaimKind[];
  /** v4 witness_review: only claims whose requirements an answered witness request targeted. */
  backsTargetedOnly?: boolean;
  prompt: string | null;
}

export interface LadderCatalog {
  version: number;
  freeCredits: number;
  passConfidence: number;
  /** Credit packs sold through pay (functions/src/purchases.ts). */
  creditPacks: CreditPack[];
  modules: ModuleDef[];
}

export interface CreditPack {
  id: string;
  credits: number;
  priceCents: number;
  label: string;
}

let prompts: Record<string, PromptDef> | null = null;
let ladder: LadderCatalog | null = null;

export function getPrompt(key: string): PromptDef {
  prompts ??= readShared<Record<string, PromptDef>>("prompts.json");
  const p = prompts[key];
  if (!p || typeof p !== "object") throw new Error(`unknown prompt ${key}`);
  return p;
}

export function getLadder(): LadderCatalog {
  ladder ??= readShared<LadderCatalog>("ladder.json");
  return ladder;
}

export function getModule(id: string): ModuleDef | undefined {
  return getLadder().modules.find((m) => m.id === id);
}
