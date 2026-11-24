import Network
import Observation

/// Online/offline flag from NWPathMonitor (drives the sync badge and when the cloud judge runs).
@Observable
final class NetworkMonitor {
  private(set) var isOnline = true
  @ObservationIgnored private let monitor = NWPathMonitor()
  @ObservationIgnored private var onOnline: [() -> Void] = []

  init() {
    monitor.pathUpdateHandler = { @Sendable [weak self] path in
      guard let self else { return }
      let online = path.status == .satisfied
      Task { @MainActor in self.update(online) }
    }
    monitor.start(queue: DispatchQueue(label: "verified.network"))
  }

  /// Registers a callback fired whenever connectivity comes back.
  func whenOnline(_ action: @escaping () -> Void) { onOnline.append(action) }

  private func update(_ online: Bool) {
    let cameBack = online && !isOnline
    isOnline = online
    if cameBack { onOnline.forEach { $0() } }
  }
}
