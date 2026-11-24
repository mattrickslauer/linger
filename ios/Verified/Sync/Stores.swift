@preconcurrency import FirebaseFirestore
import Observation

/// Public feed: `feed/*`, newest first.
@Observable
final class FeedStore {
  private(set) var items: [MomentCardData] = []
  private(set) var loaded = false
  var error: String?
  @ObservationIgnored private var listener: ListenerRegistration?

  func start() {
    guard listener == nil else { return }
    listener = Firestore.firestore().collection("feed")
      .order(by: "sealedAtServer", descending: true).limit(to: 50)
      .addSnapshotListener { [weak self] snap, err in
        guard let self else { return }
        if let err { self.error = err.localizedDescription }
        guard let snap else { return }
        self.items = snap.documents.map { MomentCardData.fromFeed(id: $0.documentID, $0.data()) }
        self.loaded = true
      }
  }
}

/// The signed-in user's moments (any status), with pending-write flags for the sync badge.
@Observable
final class MyMomentsStore {
  private(set) var items: [MomentCardData] = []
  @ObservationIgnored private var listener: ListenerRegistration?

  func start(uid: String, onChange: @escaping ([MomentCardData]) -> Void) {
    stop()
    // Single-field filter + client-side sort: no composite index needed.
    listener = Firestore.firestore().collection("moments")
      .whereField("ownerUid", isEqualTo: uid)
      .addSnapshotListener(includeMetadataChanges: true) { [weak self] snap, _ in
        guard let self, let snap else { return }
        self.items = snap.documents
          .map { MomentCardData.fromMoment(id: $0.documentID, $0.data(), pending: $0.metadata.hasPendingWrites) }
          .sorted { $0.startedAt > $1.startedAt }
        onChange(self.items)
      }
  }

  func stop() {
    listener?.remove()
    listener = nil
    items = []
  }
}

/// Counts chunk docs that are written locally but not yet acknowledged by the server
/// (Firestore snapshot metadata `hasPendingWrites`).
@Observable
final class ChunkSyncMonitor {
  private(set) var total = 0
  private(set) var pending = 0
  @ObservationIgnored private var listener: ListenerRegistration?

  func watch(momentId: String) {
    stop()
    listener = MomentStore.chunks(momentId)
      .addSnapshotListener(includeMetadataChanges: true) { [weak self] snap, _ in
        guard let self, let snap else { return }
        self.total = snap.documents.count
        self.pending = snap.documents.filter { $0.metadata.hasPendingWrites }.count
      }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}
