/// Owner-only Moment delete (docs/ARCHITECTURE.md "Deleting a Moment"). Pure rules shared by the UI and the raw vault.
public enum MomentDeletion {
  /// Contract wording for the confirm dialog (all platforms).
  public static let confirmTitle = "Delete this Moment?"
  public static let confirmMessage = "Its recording, proof shots and feed entry are removed for good."

  /// Delete is offered only for the signed-in user's own Moment, opened from their own list (never the feed),
  /// any status, and never for the Moment this device is recording right now.
  public static func canDelete(
    momentId: String, ownerUid: String?, currentUid: String?, recordingId: String?, fromMyMoments: Bool
  ) -> Bool {
    guard fromMyMoments, let currentUid, !currentUid.isEmpty, ownerUid == currentUid else { return false }
    return momentId != recordingId
  }

  /// What the raw vault does about a submitted Moment in its journal.
  public enum Repair: Sendable, Equatable {
    /// The server has the Moment: check and fill in chunks as usual.
    case verify
    /// The server lacks it and there is no tombstone: re-create it from the journal.
    case recreate
    /// The owner deleted it (on any device): drop the local journal, never re-create.
    case forget
  }

  /// `tombstoneExists`: `deleted/{id}` read from the server (only needed when the server lacks the Moment).
  public static func repair(serverExists: Bool, tombstoneExists: Bool) -> Repair {
    if tombstoneExists { return .forget }
    return serverExists ? .verify : .recreate
  }
}
