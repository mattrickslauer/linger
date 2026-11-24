// Who may see "Delete Moment" (docs/ARCHITECTURE.md "Deleting a Moment"): only the signed-in owner, only from their
// own Moments (/me, or a detail page opened from it), never the Moment this tab is recording, never in fixture mode.

/** Detail links from /me carry ?from=me; the public feed's links don't. */
export const cameFromMe = (search: string): boolean => new URLSearchParams(search).get("from") === "me";

export interface DeleteContext {
  fixtures: boolean;
  uid: string | null | undefined;
  ownerUid: string | null | undefined;
  fromMe: boolean;
  id: string;
  recordingId: string | null;
}

export function canDeleteMoment(c: DeleteContext): boolean {
  return !c.fixtures && !!c.uid && c.ownerUid === c.uid && c.fromMe && c.id !== c.recordingId;
}

export const DELETE_CONFIRM = "Delete this Moment? Its recording, proof shots and feed entry are removed for good.";
