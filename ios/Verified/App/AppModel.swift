import Foundation
import Observation
import VerifiedCore

/// App-wide state, created once after Firebase is configured.
///
/// Guest mode (docs/ARCHITECTURE.md v3.1): there is no sign-in wall. A guest browses the public feed and records
/// Moments into the local raw vault only. Anything that writes to the server goes through `requireSignIn`, which
/// shows the "Sign in to <action>" sheet and resumes the action once signed in.
@Observable
final class AppModel {
  enum AppTab: Hashable { case feed, record, me }

  /// A write that is waiting for the user to sign in.
  struct SignInRequest: Identifiable {
    let id = UUID()
    /// "upload this Moment", "run a verification module", …
    let action: String
    let then: (SignedInUser) -> Void
  }

  let auth = AuthModel()
  let network: NetworkMonitor
  let feed = FeedStore()
  let mine = MyMomentsStore()
  let recorder: RecorderModel
  let judge: JudgeRunner
  /// Raw vault: each Moment's raw data stays on the phone until the server provably has all of it.
  /// Guest Moments live only here until they are claimed at sign-in.
  let vault = Vault.shared

  var tab = AppTab.feed
  var signInRequest: SignInRequest?
  /// The claim sheet ("You recorded N Moments as a guest…") is showing.
  var claimOffer = false
  @ObservationIgnored private var claimOfferedThisSession = false
  @ObservationIgnored private var lastUid: String?

  init() {
    let net = NetworkMonitor()
    network = net
    recorder = RecorderModel(network: net)
    judge = JudgeRunner(network: net)
    net.whenOnline { Task { await Vault.shared.verifyAll() } }
  }

  var isGuest: Bool { auth.user == nil }

  /// Runs `then` right away when signed in; otherwise asks the user to sign in first ("Sign in to <action>").
  func requireSignIn(_ action: String, then: @escaping (SignedInUser) -> Void) {
    if let user = auth.user {
      then(user)
    } else {
      signInRequest = SignInRequest(action: action, then: then)
    }
  }

  /// Plain "Sign in" (Feed header, Me): nothing to resume afterwards.
  func signIn() { requireSignIn("") { _ in } }

  /// Called whenever the signed-in user changes.
  func userChanged() {
    feed.start()
    let uid = auth.user?.uid
    defer { lastUid = uid }
    if let user = auth.user {
      mine.start(uid: user.uid) { [weak self] moments in self?.judge.consider(moments) }
      Task { await vault.verifyAll() }
      if let pending = signInRequest {
        signInRequest = nil
        pending.then(user)
      }
      if uid != lastUid { offerClaimIfNeeded() }
    } else {
      mine.stop()
    }
  }

  // MARK: - Claim guest Moments (v3.1)

  /// Guest Moments that are finished and waiting to be uploaded.
  var claimable: [MomentCardData] { vault.guestMoments.filter { $0.status == "submitted" } }

  /// At most once per session, on sign-in or at launch while signed in, or right after a guest Moment finishes.
  func offerClaimIfNeeded(force: Bool = false) {
    guard auth.user != nil, !claimable.isEmpty else { return }
    guard force || !claimOfferedThisSession else { return }
    claimOfferedThisSession = true
    claimOffer = true
  }

  /// Journal first (owner, recordedAsGuest, claimedAt), then the normal raw-vault verify re-creates the Moment on the
  /// server, uploads every chunk and submits it; the cloud review then runs from the "My Moments" listener.
  func claim(_ ids: [String]) {
    guard let user = auth.user else { return }
    for id in ids {
      do { try vault.claim(id, owner: user) } catch { print("[Verified] claim \(id):", error.localizedDescription) }
    }
    Task { await vault.verifyAll() }
  }

  /// Upload one guest Moment, asking for sign-in first if needed.
  func upload(_ m: MomentCardData) {
    requireSignIn("upload this Moment and get it verified") { [weak self] _ in self?.claim([m.id]) }
  }

  // MARK: - Delete

  /// Owner-only delete (docs/ARCHITECTURE.md "Deleting a Moment"): the signed-in user's own Moment, opened from
  /// "My Moments" (never the feed), and not the Moment this device is recording right now. A guest Moment kept on
  /// this phone can always be deleted locally (it was never on the server).
  func canDelete(_ m: MomentCardData, fromMyMoments: Bool) -> Bool {
    if m.local { return fromMyMoments && m.id != recorder.momentId }
    return MomentDeletion.canDelete(momentId: m.id, ownerUid: m.ownerUid, currentUid: auth.user?.uid,
                                    recordingId: recorder.momentId, fromMyMoments: fromMyMoments)
  }

  /// Local raw-vault journal first, then `moments/{id}` (see `MomentStore.delete`). Re-checks `canDelete`.
  func deleteMoment(_ m: MomentCardData) throws {
    guard canDelete(m, fromMyMoments: true) else { return }
    if m.local {
      try vault.forget(m.id)
    } else {
      try MomentStore.delete(id: m.id)
    }
  }
}
