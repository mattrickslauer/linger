import CoreLocation
import Foundation
import Observation
import VerifiedCore

/// Records one Moment: GPS 1 Hz + motion 10 Hz + proof frames + events, chained with SHA-256.
/// A chunk closes every 5 s, or immediately when a proof frame (and its live check) is ready.
/// Every chunk is written straight to Firestore (offline persistence queues it with no signal).
@Observable
final class RecorderModel {
  enum Phase: Equatable { case idle, recording, finishing }

  struct Coach: Equatable {
    enum Kind { case checking, ok, retake, info }
    var kind: Kind
    var text: String
  }

  // Form
  var intention = ""
  var category: Category = .fishing

  // Live state
  private(set) var phase: Phase = .idle
  private(set) var momentId: String?
  private(set) var startedAt: Int64 = 0
  private(set) var distanceM = 0.0
  private(set) var track: [CLLocationCoordinate2D] = []
  private(set) var lastFix: GPSSample?
  private(set) var motionTrace: [Double] = []  // |a| m/s^2, last ~12 s for the sparkline
  private(set) var frameCount = 0
  private(set) var chunkCount = 0
  private(set) var checks = 0
  private(set) var retakes = 0
  private(set) var coach: Coach?
  private(set) var shooting = false
  private(set) var lastFrame: ProofFrame?
  var error: String?
  /// Set after Finish so the Record tab can say what happens next.
  private(set) var lastSubmitted: Submitted?
  struct Submitted: Equatable { let id: String; let intention: String }

  let sync = ChunkSyncMonitor()
  let camera = CameraController()

  /// Seal rule: a Moment must last at least 20 s.
  static let minDurationMs: Int64 = 20_000
  static let chunkSeconds = 5.0

  @ObservationIgnored private let network: NetworkMonitor
  @ObservationIgnored private let location = LocationFeed()
  @ObservationIgnored private let motion = MotionFeed()
  @ObservationIgnored private var chain = Chain(momentId: "")
  @ObservationIgnored private var buffer = Payload()
  @ObservationIgnored private var chunkT0: Int64 = 0
  @ObservationIgnored private var chunks: [ChainedChunk] = []
  @ObservationIgnored private var ticker: Task<Void, Never>?
  @ObservationIgnored private var shotTask: Task<Void, Never>?
  @ObservationIgnored private var lastGpsT: Int64 = 0
  @ObservationIgnored private var lastMotionT: Int64 = 0
  @ObservationIgnored private var modesUsed: Set<FrameCheck.Mode> = []
  @ObservationIgnored private var motionDecimate = 0

  init(network: NetworkMonitor) {
    self.network = network
  }

  var canStart: Bool { phase == .idle && !intention.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  func elapsedMs(at date: Date = Date()) -> Int64 {
    phase == .idle ? 0 : max(0, Int64(date.timeIntervalSince1970 * 1000) - startedAt)
  }

  func canFinish(at date: Date = Date()) -> Bool {
    phase == .recording && elapsedMs(at: date) >= Self.minDurationMs
  }

  /// Contract `onDevice.mode`: on_device if any check ran on-device, else cloud, else none.
  var onDeviceMode: FrameCheck.Mode {
    if modesUsed.contains(.onDevice) { return .onDevice }
    if modesUsed.contains(.cloud) { return .cloud }
    return .none
  }

  // MARK: - Start

  func start(owner: SignedInUser) {
    guard canStart else { return }
    let id = UUID().uuidString.lowercased()
    let t = nowMs()
    momentId = id
    startedAt = t
    chain = Chain(momentId: id)
    buffer = Payload(events: [MomentEvent(t: t, type: .start)])
    chunkT0 = t
    chunks = []
    distanceM = 0
    track = []
    lastFix = nil
    motionTrace = []
    frameCount = 0
    chunkCount = 0
    checks = 0
    retakes = 0
    modesUsed = []
    lastGpsT = 0
    lastMotionT = 0
    lastFrame = nil
    error = nil
    lastSubmitted = nil
    coach = Coach(kind: .info, text: "Take a proof shot when something happens")
    phase = .recording

    MomentStore.create(id: id, owner: owner, intention: intention.trimmingCharacters(in: .whitespacesAndNewlines),
                       category: category, startedAt: t)
    sync.watch(momentId: id)
    location.start { [weak self] s in self?.addGPS(s) }
    motion.start { [weak self] s in self?.addMotion(s) }
    camera.start()
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(Self.chunkSeconds))
        guard let self, !Task.isCancelled, self.phase == .recording else { return }
        self.closeChunk()
      }
    }
  }

  // MARK: - Samples

  private func addGPS(_ s: GPSSample) {
    guard phase != .idle, s.t > lastGpsT else { return }  // seal requires monotonic GPS time
    if let prev = lastFix {
      let d = MomentSummary.haversine(LatLng(lat: prev.lat, lng: prev.lng), LatLng(lat: s.lat, lng: s.lng))
      distanceM += d
    }
    lastGpsT = s.t
    lastFix = s
    track.append(CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng))
    buffer.gps.append(s)
  }

  private func addMotion(_ s: MotionSample) {
    guard phase != .idle, s.t > lastMotionT else { return }
    lastMotionT = s.t
    buffer.motion.append(s)
    motionDecimate += 1
    if motionDecimate % 2 == 0 {
      motionTrace.append((s.ax * s.ax + s.ay * s.ay + s.az * s.az).squareRoot())
      if motionTrace.count > 60 { motionTrace.removeFirst(motionTrace.count - 60) }
    }
  }

  // MARK: - Chunks

  /// Seals the current buffer into the chain and writes it. `frame` goes beside the payload, not in it.
  private func closeChunk(frame: ProofFrame? = nil) {
    guard momentId != nil else { return }
    let t1 = max(nowMs(), chunkT0)
    let payload = buffer.string
    let chunk = chain.append(t0: chunkT0, t1: t1, payload: payload)
    chunks.append(chunk)
    chunkCount = chunks.count
    MomentStore.writeChunk(
      momentId: chain.momentId, chunk: chunk,
      frame: frame.map { MomentStore.Frame(jpegB64: $0.jpegB64, w: $0.w, h: $0.h, t: $0.t) })
    buffer = Payload()
    chunkT0 = t1
  }

  // MARK: - Proof shot + live coach

  func proofShot() {
    guard phase == .recording, !shooting else { return }
    shooting = true
    coach = Coach(kind: .checking, text: LiveCoach.onDeviceAvailable ? "Checking on-device…" : "Checking…")
    let intentionText = intention
    shotTask = Task { [weak self] in
      guard let self else { return }
      defer { self.shooting = false }
      let t = nowMs()
      let frame: ProofFrame?
      #if targetEnvironment(simulator)
        // No camera in the Simulator: a synthetic frame exercises the same pipeline.
        frame = await Task.detached { ProofFrame.syntheticImage().flatMap { ProofFrame.make(from: $0, t: t) } }.value
      #else
        do {
          let data = try await self.camera.capture()
          frame = await Task.detached { ProofFrame.make(from: data, t: t) }.value
        } catch {
          self.coach = Coach(kind: .retake, text: "Camera: \(error.localizedDescription)")
          return
        }
      #endif
      guard let frame else {
        self.coach = Coach(kind: .retake, text: "Retake: could not read the photo")
        return
      }
      self.lastFrame = frame
      let check = await LiveCoach.check(intention: intentionText, labels: frame.labels, online: self.network.isOnline)
      guard self.phase != .idle else { return }
      self.record(frame: frame, check: check)
    }
  }

  private func record(frame: ProofFrame, check: FrameCheck) {
    let tc = max(nowMs(), frame.t)
    checks += 1
    if !check.ok { retakes += 1 }
    if check.mode != .none { modesUsed.insert(check.mode) }
    frameCount += 1
    buffer.events.append(MomentEvent(t: frame.t, type: .frame, extras: [("w", .int(Int64(frame.w))), ("h", .int(Int64(frame.h)))]))
    buffer.events.append(MomentEvent(
      t: tc, type: check.ok ? .check : .retake,
      extras: [("ok", .bool(check.ok)), ("mode", .string(check.mode.rawValue))]))
    buffer.frameSha = frame.frameSha
    buffer.check = check
    closeChunk(frame: frame)  // one frame max per chunk: close right away

    let prefix = switch check.mode {
    case .onDevice: "On-device"
    case .cloud: "Cloud"
    case .none: "Offline"
    }
    coach = check.ok
      ? Coach(kind: .ok, text: "\(prefix): keep going · \(check.label)")
      : Coach(kind: .retake, text: "Retake: \(check.reason)")
  }

  // MARK: - Finish

  func finish() async {
    guard phase == .recording, let id = momentId else { return }
    phase = .finishing
    await shotTask?.value  // let an in-flight proof shot land in the chain first
    ticker?.cancel()
    ticker = nil
    location.stop()
    motion.stop()
    camera.stop()

    let stopT = max(nowMs(), chunkT0)
    buffer.events.append(MomentEvent(t: stopT, type: .stop))
    closeChunk()
    let endedAt = max(stopT, chunks.last?.t1 ?? stopT)
    let summary = MomentSummary.compute(startedAt: startedAt, endedAt: endedAt, chunks: chunks)
    MomentStore.submit(
      momentId: id, endedAt: endedAt, chunkCount: chunks.count, headHash: chain.lastHash,
      summary: summary, onDevice: (onDeviceMode.rawValue, checks, retakes))

    lastSubmitted = Submitted(id: id, intention: intention)
    intention = ""
    coach = nil
    phase = .idle
    momentId = nil
    // Keep `sync` watching this moment so the badge can show the queued tail draining.
  }
}
