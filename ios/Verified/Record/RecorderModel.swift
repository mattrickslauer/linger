import AVFoundation
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
  /// Finished video clips this Moment.
  private(set) var videoCount = 0
  /// Start time (ms) of the clip being recorded right now, nil when not recording video.
  private(set) var clipStartedAt: Int64?

  // Camera controls (kept across Moments and re-applied on start, like the controller's session).
  private(set) var videoMode = false
  private(set) var front = false
  private(set) var flash: AVCaptureDevice.FlashMode = .off
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
    phase == .recording && clipStartedAt == nil && elapsedMs(at: date) >= Self.minDurationMs
  }

  /// The camera controls (mode, flip) are locked while a shot is being checked or a clip records/saves.
  var cameraBusy: Bool { shooting || clipStartedAt != nil }

  var position: AVCaptureDevice.Position { front ? .front : .back }

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
    videoCount = 0
    clipStartedAt = nil
    error = nil
    lastSubmitted = nil
    coach = Coach(kind: .info, text: "Take a proof shot when something happens")
    do {
      try MomentStore.create(id: id, owner: owner, intention: intention.trimmingCharacters(in: .whitespacesAndNewlines),
                             category: category, startedAt: t)
    } catch {
      // Raw vault: without a local copy we don't record at all.
      self.error = "Could not save this Moment on the phone: \(error.localizedDescription)"
      momentId = nil
      return
    }
    phase = .recording
    sync.watch(momentId: id)
    location.start { [weak self] s in self?.addGPS(s) }
    motion.start { [weak self] s in self?.addMotion(s) }
    camera.start()
    applyCameraControls()
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
  /// Returns false (and surfaces the error) when the raw-vault journal write failed.
  @discardableResult
  private func closeChunk(frame: ProofFrame? = nil) -> Bool {
    guard momentId != nil else { return true }
    let t1 = max(nowMs(), chunkT0)
    let payload = buffer.string
    let chunk = chain.append(t0: chunkT0, t1: t1, payload: payload)
    chunks.append(chunk)
    chunkCount = chunks.count
    buffer = Payload()
    chunkT0 = t1
    do {
      try MomentStore.writeChunk(
        momentId: chain.momentId, chunk: chunk,
        frame: frame.map { MomentStore.Frame(jpegB64: $0.jpegB64, w: $0.w, h: $0.h, t: $0.t) })
      return true
    } catch {
      let msg = "Could not save chunk \(chunk.seq) on the phone: \(error.localizedDescription)"
      print("[Verified]", msg)
      self.error = msg
      coach = Coach(kind: .retake, text: msg)
      return false
    }
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

  // MARK: - Camera controls

  func setVideoMode(_ on: Bool) {
    guard !cameraBusy, videoMode != on else { return }
    videoMode = on
    if on && flash == .auto { flash = .off }  // video: the torch is Off or On (Android: Auto acts as Off)
    camera.setVideoMode(on)
    camera.setFlash(CameraController.hasFlash(position) ? flash : .off)
  }

  /// Photo: Off -> Auto -> On. Video: Off <-> On (torch).
  func cycleFlash() {
    if videoMode {
      flash = flash == .on ? .off : .on
    } else {
      flash = switch flash { case .off: .auto; case .auto: .on; default: .off }
    }
    camera.setFlash(flash)
  }

  func flip() {
    guard !cameraBusy, CameraController.canFlip else { return }
    front.toggle()
    camera.setPosition(position)
    camera.setFlash(CameraController.hasFlash(position) ? flash : .off)
  }

  private func applyCameraControls() {
    if front && !CameraController.canFlip { front = false }
    camera.setPosition(position)
    camera.setVideoMode(videoMode)
    camera.setFlash(CameraController.hasFlash(position) ? flash : .off)
  }

  // MARK: - Video clips

  /// Starts a clip; `video_start` goes into the current chunk once the camera is recording.
  func startVideo() {
    guard phase == .recording, !cameraBusy, let id = momentId else { return }
    let t = nowMs()
    clipStartedAt = t  // also blocks double taps while the camera starts
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(VideoClip.fileName(momentId: id, startedAt: t))
    Task {
      do {
        try await camera.startRecording(to: url) { url, failure in
          Task { @MainActor in self.clipFinished(url: url, failure: failure, startedAt: t) }
        }
        guard self.phase == .recording else { return }
        self.buffer.events.append(MomentEvent(t: max(nowMs(), self.chunkT0), type: .videoStart))
      } catch {
        self.clipStartedAt = nil
        self.coach = Coach(kind: .retake, text: "Camera: \(error.localizedDescription)")
      }
    }
  }

  func stopVideo() {
    guard clipStartedAt != nil, !shooting else { return }
    shooting = true
    coach = Coach(kind: .checking, text: "Saving clip…")
    camera.stopRecording()
  }

  /// The movie file is finished (Stop, the length cap, or an interruption). Like Android's `videoClip`:
  /// hash it, chain a `video` event, and coach its middle frame as this chunk's proof frame.
  private func clipFinished(url: URL, failure: String?, startedAt: Int64) {
    clipStartedAt = nil
    let endedAt = nowMs()
    guard phase != .idle else {
      // Moment already over: keep the clip on the phone, nothing to chain.
      Task.detached { _ = await VideoClipFile.keep(url: url) }
      shooting = false
      return
    }
    if let failure {
      shooting = false
      coach = Coach(kind: .retake, text: "Video clip failed: \(failure)")
      try? FileManager.default.removeItem(at: url)
      return
    }
    shooting = true
    coach = Coach(kind: .checking, text: LiveCoach.onDeviceAvailable ? "Checking clip on-device…" : "Checking clip…")
    let intentionText = intention
    shotTask = Task { [weak self] in
      guard let self else { return }
      defer { self.shooting = false }
      let processed: VideoClipFile.Processed
      do {
        processed = try await Task.detached {
          try await VideoClipFile.process(url: url, startedAt: startedAt, endedAt: endedAt, posterT: endedAt)
        }.value
      } catch {
        self.coach = Coach(kind: .retake, text: "Video clip failed to save: \(error.localizedDescription)")
        try? FileManager.default.removeItem(at: url)
        return
      }
      self.videoCount += 1
      // Keep the clip on the phone (Photos album "Verified") while the poster is coached.
      Task.detached {
        let saved = await VideoClipFile.keep(url: url)
        if saved == .failed { print("[Verified] clip \(processed.clip.name) kept nowhere") }
      }
      guard let frame = processed.poster else {
        // No poster frame: the clip is still committed to the chain, without a proof frame.
        if self.phase != .idle { self.buffer.events.append(processed.clip.event(t: max(nowMs(), self.chunkT0))) }
        self.coach = Coach(kind: .info, text: "Clip saved · no frame to check")
        return
      }
      self.lastFrame = frame
      let check = await LiveCoach.check(intention: intentionText, labels: frame.labels, online: self.network.isOnline)
      guard self.phase != .idle else { return }
      self.record(frame: frame, check: check, clip: processed.clip)
    }
  }

  /// Chains a proof frame (a photo, or a clip's poster with its `video` event right after `frame`) and its check.
  private func record(frame: ProofFrame, check: FrameCheck, clip: VideoClip? = nil) {
    let tc = max(nowMs(), frame.t)
    checks += 1
    if !check.ok { retakes += 1 }
    if check.mode != .none { modesUsed.insert(check.mode) }
    frameCount += 1
    buffer.events.append(MomentEvent(t: frame.t, type: .frame, extras: [("w", .int(Int64(frame.w))), ("h", .int(Int64(frame.h)))]))
    if let clip { buffer.events.append(clip.event(t: frame.t)) }
    buffer.events.append(MomentEvent(
      t: tc, type: check.ok ? .check : .retake,
      extras: [("ok", .bool(check.ok)), ("mode", .string(check.mode.rawValue))]))
    buffer.frameSha = frame.frameSha
    buffer.check = check
    guard closeChunk(frame: frame) else { return }  // one frame max per chunk: close right away

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
    do {
      try MomentStore.submit(
        momentId: id, endedAt: endedAt, chunkCount: chunks.count, headHash: chain.lastHash,
        summary: summary, onDevice: (onDeviceMode.rawValue, checks, retakes))
    } catch {
      // Raw vault: not journaled means not submitted; the Moment stays `recording` on the server.
      self.error = "Could not save this Moment on the phone, so it was not submitted: \(error.localizedDescription)"
      coach = nil
      phase = .idle
      momentId = nil
      return
    }
    // Give the queued writes a head start, then check the server has every chunk.
    Task {
      try? await Task.sleep(for: .seconds(5))
      await Vault.shared.verifyAll()
    }

    lastSubmitted = Submitted(id: id, intention: intention)
    intention = ""
    coach = nil
    phase = .idle
    momentId = nil
    // Keep `sync` watching this moment so the badge can show the queued tail draining.
  }
}
