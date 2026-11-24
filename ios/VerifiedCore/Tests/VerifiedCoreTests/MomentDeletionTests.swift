import Testing
@testable import VerifiedCore

struct MomentDeletionTests {
  func can(owner: String? = "me", current: String? = "me", recording: String? = nil, mine: Bool = true) -> Bool {
    MomentDeletion.canDelete(momentId: "m1", ownerUid: owner, currentUid: current, recordingId: recording,
                             fromMyMoments: mine)
  }

  @Test func ownerMayDeleteFromMyMoments() {
    #expect(can())
    #expect(can(recording: "other-moment"))
  }

  @Test func neverFromFeedOrForOthers() {
    #expect(!can(mine: false))
    #expect(!can(owner: "someone-else"))
    #expect(!can(owner: nil))
    #expect(!can(current: nil))
    #expect(!can(owner: "", current: ""))
  }

  @Test func neverTheMomentBeingRecorded() {
    #expect(!can(recording: "m1"))
  }

  @Test func confirmWordingMatchesContract() {
    #expect("\(MomentDeletion.confirmTitle) \(MomentDeletion.confirmMessage)"
            == "Delete this Moment? Its recording, proof shots and feed entry are removed for good.")
  }

  @Test func tombstoneWinsOverRecreate() {
    #expect(MomentDeletion.repair(serverExists: false, tombstoneExists: true) == .forget)
    #expect(MomentDeletion.repair(serverExists: true, tombstoneExists: true) == .forget)
    #expect(MomentDeletion.repair(serverExists: false, tombstoneExists: false) == .recreate)
    #expect(MomentDeletion.repair(serverExists: true, tombstoneExists: false) == .verify)
  }
}
