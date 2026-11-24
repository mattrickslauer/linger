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

  init() {
    let net = NetworkMonitor()
    network = net
    recorder = RecorderModel(network: net)
    judge = JudgeRunner(network: net)
  }

  /// Called whenever the signed-in user changes.
  func userChanged() {
    feed.start()
    if let user = auth.user {
      mine.start(uid: user.uid) { [weak self] moments in self?.judge.consider(moments) }
    } else {
      mine.stop()
    }
  }
}
