// Claim-on-upload (docs/ARCHITECTURE.md v3.1): bind guest Moments to the signed-in account, let the raw vault
// upload them, then run the normal cloud review (judge + skeptic + scorer) once the server holds the submit.

import type { User } from "firebase/auth";
import { doc, getDocFromServer } from "firebase/firestore";
import { getChunks } from "./data";
import { db } from "./firebase";
import { decodeChunks } from "./geo";
import { runCloudReview } from "./recorder";
import type { Moment } from "./types";
import { claimMoments, localChunks } from "./vault";

let prompted = false;
/** The claim sheet shows at most once per page session (contract), or not at all if an action already claimed. */
export const claimPrompted = () => prompted;
export const markClaimPrompted = () => {
  prompted = true;
};

/**
 * Claim and upload; resolves once the vault pass that uploads them is done. The cloud review then runs in the
 * background (the Me list follows it live), so the sheet never waits a minute on Gemini.
 */
export async function claimAndVerify(ids: string[], user: User, onProgress?: (msg: string) => void): Promise<string[]> {
  // Frames for the judges, read from the journal before the vault may drop the local copy.
  const frames = new Map<string, ReturnType<typeof decodeChunks>["frames"]>();
  for (const id of ids) frames.set(id, decodeChunks(await localChunks(id)).frames);
  onProgress?.("Uploading…");
  const claimed = await claimMoments(ids, user);
  void reviewClaimed(claimed, frames);
  return claimed;
}

async function reviewClaimed(claimed: string[], frames: Map<string, ReturnType<typeof decodeChunks>["frames"]>) {
  for (const id of claimed) {
    try {
      const snap = await getDocFromServer(doc(db!, "moments", id));
      if (!snap.exists()) continue; // offline: the vault keeps trying every 30 s; Me shows "Run cloud review"
      const m = { ...(snap.data() as Moment), id };
      if (m.status !== "submitted" || m.judge) continue;
      const f = frames.get(id)?.length ? frames.get(id)! : decodeChunks(await getChunks(id, true)).frames;
      await runCloudReview(id, m, f);
    } catch (e) {
      console.warn("claim: review later", id, e);
    }
  }
}
