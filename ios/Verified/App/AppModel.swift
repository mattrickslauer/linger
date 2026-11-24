import Foundation
import Observation

/// App-wide state, created once after Firebase is configured.
@Observable
final class AppModel {
  let auth = AuthModel()
  let network: NetworkMonitor
  let feed = FeedStore()
  let mine = MyMomentsStore()
  let recorder: RecorderModel
  let judge: JudgeRunner
  /// Raw vault: each Moment's raw data stays on the phone until the server provably has all of it.
  let vault = Vault.shared

  init() {
    let net = NetworkMonitor()
    network = net
    recorder = RecorderModel(network: net)
    judge = JudgeRunner(network: net)
    net.whenOnline { Task { await Vault.shared.verifyAll() } }
  }

  /// Called whenever the signed-in user changes.
  func userChanged() {
    feed.start()
    if let user = auth.user {
      mine.start(uid: user.uid) { [weak self] moments in self?.judge.consider(moments) }
      Task { await vault.verifyAll() }
    } else {
      mine.stop()
    }
  }
}
