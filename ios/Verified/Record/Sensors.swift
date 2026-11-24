import CoreLocation
import CoreMotion
import Foundation
import VerifiedCore

/// GPS at ~1 Hz via `CLLocationUpdate.liveUpdates` (async, Swift-6 friendly).
final class LocationFeed {
  private var task: Task<Void, Never>?
  private var session: CLServiceSession?
  private var lastT: Int64 = 0
  private var onSample: ((GPSSample) -> Void)?

  func start(_ onSample: @escaping (GPSSample) -> Void) {
    stop()
    self.onSample = onSample
    session = CLServiceSession(authorization: .whenInUse)
    task = Task {
      do {
        for try await update in CLLocationUpdate.liveUpdates(.fitness) {
          if Task.isCancelled { break }
          guard let loc = update.location, loc.horizontalAccuracy >= 0 else { continue }
          let t = Int64((loc.timestamp.timeIntervalSince1970 * 1000).rounded())
          guard t - self.lastT >= 900 else { continue }  // 1 Hz
          self.lastT = t
          self.onSample?(GPSSample(
            t: t,
            lat: loc.coordinate.latitude.rounded(places: 6),
            lng: loc.coordinate.longitude.rounded(places: 6),
            accuracyM: loc.horizontalAccuracy.rounded(places: 1),
            altitudeM: loc.verticalAccuracy >= 0 ? loc.altitude.rounded(places: 1) : nil,
            speedMps: loc.speed >= 0 ? loc.speed.rounded(places: 2) : nil))
        }
      } catch {
        print("[Verified] location updates ended:", error)
      }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
    session?.invalidate()
    session = nil
    onSample = nil
    lastT = 0
  }
}

/// Accelerometer (incl. gravity, m/s^2) + gyroscope (rad/s) at 10 Hz via Core Motion device motion.
final class MotionFeed {
  private let manager = CMMotionManager()
  private var onSample: ((MotionSample) -> Void)?
  nonisolated static let g = 9.80665

  var isAvailable: Bool { manager.isDeviceMotionAvailable }

  func start(_ onSample: @escaping (MotionSample) -> Void) {
    guard manager.isDeviceMotionAvailable else { return }
    self.onSample = onSample
    manager.deviceMotionUpdateInterval = 0.1
    // Device-motion timestamps are seconds since boot; convert to epoch ms.
    let bootEpoch = Date().timeIntervalSince1970 - ProcessInfo.processInfo.systemUptime
    manager.startDeviceMotionUpdates(to: .main) { @Sendable motion, _ in
      guard let m = motion else { return }
      let a = m.userAcceleration, gr = m.gravity, r = m.rotationRate
      let sample = MotionSample(
        t: Int64(((bootEpoch + m.timestamp) * 1000).rounded()),
        ax: ((a.x + gr.x) * MotionFeed.g).rounded(places: 3),
        ay: ((a.y + gr.y) * MotionFeed.g).rounded(places: 3),
        az: ((a.z + gr.z) * MotionFeed.g).rounded(places: 3),
        gx: r.x.rounded(places: 3), gy: r.y.rounded(places: 3), gz: r.z.rounded(places: 3))
      MainActor.assumeIsolated { self.onSample?(sample) }
    }
  }

  func stop() {
    manager.stopDeviceMotionUpdates()
    onSample = nil
  }
}
