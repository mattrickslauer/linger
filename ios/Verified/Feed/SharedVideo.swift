import AVFoundation
import AVKit
@preconcurrency import FirebaseStorage
import Foundation
import Observation
import SwiftUI
import UIKit
import VerifiedCore

// v4.12 Shared video (docs/ARCHITECTURE.md): the clips uploaded at submit are evidence anyone who can see the Moment
// can watch. The feed autoplays one muted and looping; the evidence room lists them all with controls.

/// Download URLs of shared clips (Storage SDK), cached per path for the session. A failure isn't cached.
enum ClipURLCache {
  private static var urls: [String: URL] = [:]

  static func url(for path: String) async -> URL? {
    if let url = urls[path] { return url }
    let url: URL? = await withCheckedContinuation { c in
      Storage.storage().reference(withPath: path).downloadURL { url, error in
        if let error { print("[Verified] clip url \(path): \(error.localizedDescription)") }
        c.resume(returning: url)
      }
    }
    if let url { urls[path] = url }
    return url
  }
}

/// Muted autoplay must not stop the user's music (`.ambient`); sound on, or a clip played with controls, uses
/// `.playback`. Leaves the session alone while the camera or the voice witness owns it (play-and-record).
enum ClipAudio {
  static func use(sound: Bool) {
    let s = AVAudioSession.sharedInstance()
    guard s.category != .playAndRecord, s.category != .record else { return }
    let category: AVAudioSession.Category = sound ? .playback : .ambient
    guard s.category != category else { return }
    do {
      try s.setCategory(category)
    } catch {
      print("[Verified] clip audio session:", error.localizedDescription)
    }
  }
}

// MARK: - Feed autoplay

/// The feed clip of one slide: muted (until the speaker button), looping, no controls. Only one plays at a time.
@Observable
final class FeedClipPlayer {
  /// The first frame can show: the hero photo (the poster) gives way to the video.
  private(set) var ready = false
  private(set) var muted = true
  @ObservationIgnored let player = AVQueuePlayer()
  @ObservationIgnored private var looper: AVPlayerLooper?
  @ObservationIgnored private var loading = false
  @ObservationIgnored private var wantsPlay = false
  private static weak var playing: FeedClipPlayer?

  init() {
    player.isMuted = true
    player.preventsDisplaySleepDuringVideoPlayback = false
  }

  func play(path: String) {
    wantsPlay = true
    if looper != nil {
      start()
      return
    }
    guard !loading else { return }
    loading = true
    Task {
      let url = await ClipURLCache.url(for: path)
      self.loading = false
      // No URL (offline, refused, …): the photo just stays.
      guard let url, self.looper == nil else { return }
      self.looper = AVPlayerLooper(player: self.player, templateItem: AVPlayerItem(url: url))
      if self.wantsPlay { self.start() }
    }
  }

  func pause() {
    wantsPlay = false
    player.pause()
  }

  func toggleMute() {
    muted.toggle()
    player.isMuted = muted
    if wantsPlay { ClipAudio.use(sound: !muted) }
  }

  func markReady() {
    if !ready { ready = true }
  }

  private func start() {
    if let other = Self.playing, other !== self { other.pause() }
    Self.playing = self
    ClipAudio.use(sound: !muted)
    player.play()
  }
}

/// An `AVPlayerLayer` with no controls, showing the whole clip in its frame (aspect fit, never cropped).
/// `rotation` is the Moment's `displayRotation` (clockwise degrees): the layer is turned so the clip is upright and
/// still fits whole. `onReady` runs once a frame can show.
struct PlayerLayerView: UIViewRepresentable {
  let player: AVPlayer
  var rotation = 0
  let onReady: () -> Void

  func makeUIView(context: Context) -> PlayerLayerUIView {
    let view = PlayerLayerUIView()
    view.playerLayer.videoGravity = .resizeAspect
    view.playerLayer.player = player
    view.rotation = rotation
    view.onReady = onReady
    return view
  }

  func updateUIView(_ view: PlayerLayerUIView, context: Context) {
    if view.playerLayer.player !== player { view.playerLayer.player = player }
    view.rotation = rotation
    view.onReady = onReady
  }
}

final class PlayerLayerUIView: UIView {
  /// A sublayer (not the view's own layer) so it can be turned without fighting UIKit's layout of the view.
  let playerLayer = AVPlayerLayer()
  var rotation = 0 {
    didSet { if rotation != oldValue { setNeedsLayout() } }
  }
  var onReady: (() -> Void)?
  private var readyObservation: NSKeyValueObservation?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    backgroundColor = .clear
    layer.addSublayer(playerLayer)
    // KVO may call back off the main thread: hop to the main actor.
    readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.initial, .new]) { @Sendable [weak self] _, change in
      guard change.newValue == true, let view = self else { return }
      Task { @MainActor in view.onReady?() }
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let r = normalizeDisplayRotation(rotation)
    let size = displayRotatedSize(width: bounds.width, height: bounds.height, rotation: r)
    CATransaction.begin()
    CATransaction.setDisableActions(true)  // no implicit animation when the frame changes
    // A quarter turn: lay the layer out in the swapped size, then turn it to fill the view; `.resizeAspect` then
    // fits the (sideways-stored) clip to that swapped box, which on screen is the upright clip fitted to the view.
    playerLayer.setAffineTransform(.identity)
    playerLayer.bounds = CGRect(x: 0, y: 0, width: size.width, height: size.height)
    playerLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
    playerLayer.setAffineTransform(r == 0 ? .identity : CGAffineTransform(rotationAngle: CGFloat(r) * .pi / 180))
    CATransaction.commit()
  }
}

// MARK: - Evidence room player

/// One clip in the evidence room: an `AVPlayer` plus the state for upright SwiftUI controls (play/pause, position,
/// duration, mute). Only the picture is turned (by `PlayerLayerView`); the controls never turn. Never autoplays.
@Observable
final class ClipPlayerModel {
  private(set) var player: AVPlayer?
  private(set) var failed = false
  private(set) var playing = false
  private(set) var muted = false
  private(set) var time: Double = 0
  private(set) var duration: Double = 0
  /// Width / height of the picture as AVPlayer draws it (the track's `preferredTransform` applied), before the
  /// Moment's `displayRotation`. nil until the track has loaded.
  private(set) var naturalAspect: CGFloat?
  /// The scrubber is being dragged: the periodic observer leaves `time` alone.
  var scrubbing = false
  @ObservationIgnored private var observer: Any?
  @ObservationIgnored private var loadedPath: String?

  func load(_ clip: SharedClip) async {
    guard loadedPath != clip.path else { return }
    loadedPath = clip.path
    if clip.durationMs > 0 { duration = Double(clip.durationMs) / 1000 }
    guard let url = await ClipURLCache.url(for: clip.path) else {
      failed = true
      return
    }
    let asset = AVURLAsset(url: url)
    let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
    player.isMuted = muted
    self.player = player
    observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10), queue: .main) { [weak self] t in
      MainActor.assumeIsolated { self?.tick(t) }
    }
    if let tracks = try? await asset.loadTracks(withMediaType: .video), let track = tracks.first,
       let loaded = try? await track.load(.naturalSize, .preferredTransform) {
      // The picture AVPlayer draws: the natural size through the display matrix (a -90° matrix turns 1080×1920
      // into 1920×1080). abs() because the transformed rect can have negative extents.
      let r = CGRect(origin: .zero, size: loaded.0).applying(loaded.1)
      let w = abs(r.width), h = abs(r.height)
      if w > 0, h > 0 { naturalAspect = w / h }
    }
    if let d = try? await asset.load(.duration), d.isNumeric, d.seconds > 0 { duration = d.seconds }
  }

  private func tick(_ t: CMTime) {
    guard let player else { return }
    playing = player.rate != 0
    if !scrubbing, t.isNumeric { time = max(0, t.seconds) }
  }

  func toggle() {
    guard let player else { return }
    if player.rate != 0 {
      pause()
      return
    }
    if duration > 0, time >= duration - 0.15 { seek(to: 0) }
    ClipAudio.use(sound: !muted)
    player.play()
    playing = true
  }

  func pause() {
    player?.pause()
    playing = false
  }

  func toggleMute() {
    muted.toggle()
    player?.isMuted = muted
    if playing { ClipAudio.use(sound: !muted) }
  }

  func seek(to s: Double) {
    time = s
    player?.seek(to: CMTime(seconds: s, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
  }
}

/// The evidence-room player: the clip turned upright by the Moment's `displayRotation` and sized to its oriented
/// aspect (never cropped, at most `maxHeight` tall), with an upright control bar under it. Tap the picture to play
/// or pause. Pauses when it goes away.
struct ClipPlayerView: View {
  let clip: SharedClip
  /// The Moment's `displayRotation` (clockwise degrees).
  var rotation = 0
  var maxHeight: CGFloat = 520
  @State private var model = ClipPlayerModel()

  var body: some View {
    VStack(spacing: 8) {
      picture
        .aspectRatio(aspect, contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: maxHeight)
      controls
    }
    .task(id: clip.path) { await model.load(clip) }
    .onDisappear { model.pause() }
  }

  /// Oriented width / height: the track's own orientation, then a quarter turn of `displayRotation` swaps it.
  private var aspect: CGFloat {
    guard let a = model.naturalAspect else { return 1 }
    return normalizeDisplayRotation(rotation) % 180 == 0 ? a : 1 / a
  }

  private var picture: some View {
    ZStack {
      Color.black
      if let player = model.player {
        PlayerLayerView(player: player, rotation: rotation) {}
      } else if model.failed {
        Label("Couldn't load this clip", systemImage: "video.slash")
          .font(.footnote).foregroundStyle(.white.opacity(0.8))
      } else {
        ProgressView().tint(.white)
      }
      if model.player != nil, !model.playing {
        Image(systemName: "play.fill")
          .font(.system(size: 26, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 64, height: 64)
          .background(.black.opacity(0.45), in: Circle())
          .allowsHitTesting(false)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .contentShape(Rectangle())
    .onTapGesture { model.toggle() }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(model.failed ? "Clip could not load" : "Video clip")
    .accessibilityHint(model.playing ? "Pauses the clip" : "Plays the clip")
    .accessibilityAddTraits(.isButton)
    .accessibilityAction { model.toggle() }
  }

  private var controls: some View {
    let total = max(model.duration, model.time, 0.1)
    return HStack(spacing: 8) {
      Button { model.toggle() } label: {
        Image(systemName: model.playing ? "pause.fill" : "play.fill")
          .font(.title3.weight(.semibold))
          .frame(width: 44, height: 44)
          .contentShape(Rectangle())
      }
      .accessibilityLabel(model.playing ? "Pause" : "Play")
      Text(Self.clock(model.time)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
      Slider(value: Binding(get: { min(model.time, total) }, set: { model.seek(to: $0) }), in: 0...total) { editing in
        model.scrubbing = editing
      }
      .tint(Theme.track)
      .accessibilityLabel("Position")
      .accessibilityValue("\(Self.clock(model.time)) of \(Self.clock(total))")
      Text(Self.clock(total)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
      Button { model.toggleMute() } label: {
        Image(systemName: model.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
          .font(.body.weight(.semibold))
          .frame(width: 44, height: 44)
          .contentShape(Rectangle())
      }
      .accessibilityLabel(model.muted ? "Unmute" : "Mute")
    }
    .buttonStyle(.plain)
    .disabled(model.player == nil)
  }

  static func clock(_ s: Double) -> String {
    formatDuration(ms: Int64((s.isFinite ? max(0, s) : 0) * 1000))
  }
}

/// Full-screen clip viewer (the evidence room's media modal): one clip at a time, previous / next when there are
/// several.
struct ClipViewer: View {
  let clips: [SharedClip]
  var rotation = 0
  @State private var index: Int
  @Environment(\.dismiss) private var dismiss

  init(clips: [SharedClip], start: Int = 0, rotation: Int = 0) {
    self.clips = clips
    self.rotation = rotation
    _index = State(initialValue: min(max(0, start), max(0, clips.count - 1)))
  }

  var body: some View {
    GeometryReader { g in
      VStack(spacing: 12) {
        HStack(spacing: 8) {
          if clips.indices.contains(index) {
            let clip = clips[index]
            Text(clips.count > 1 ? "Clip \(index + 1) of \(clips.count)" : "Clip").font(.headline)
            if clip.durationMs > 0 {
              Text(formatDuration(ms: clip.durationMs)).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            ClipHashMark(ok: clip.hashOk, long: true)
          }
          Spacer(minLength: 0)
          ModalCloseButton { dismiss() }
        }
        Spacer(minLength: 0)
        if clips.indices.contains(index) {
          let clip = clips[index]
          ClipPlayerView(clip: clip, rotation: rotation,
                         maxHeight: max(160, min(g.size.height * 0.8, g.size.height - 150)))
            .id(clip.path)
        }
        Spacer(minLength: 0)
        if clips.count > 1 {
          HStack {
            Button { index -= 1 } label: { Label("Previous", systemImage: "chevron.left") }
              .disabled(index == 0)
            Spacer()
            Button { index += 1 } label: {
              HStack(spacing: 6) { Text("Next"); Image(systemName: "chevron.right") }
            }
            .disabled(index >= clips.count - 1)
          }
          .font(.subheadline.weight(.semibold))
        }
      }
      .padding(16)
    }
    .background(Theme.media.ignoresSafeArea())
    .environment(\.colorScheme, .dark)
  }
}

/// A clip's upload hash vs the chained hash: ✓ matches, ✗ (or a warning line when `long`) mismatch, nothing yet.
struct ClipHashMark: View {
  let ok: Bool?
  var long = false

  var body: some View {
    switch ok {
    case .some(true):
      Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.ok).accessibilityLabel("Hash matches the chain")
    case .some(false):
      if long {
        Label("Hash does not match the chain", systemImage: "exclamationmark.triangle.fill")
          .font(.caption.weight(.semibold)).foregroundStyle(Theme.bad)
      } else {
        Image(systemName: "xmark.seal.fill").foregroundStyle(Theme.bad).accessibilityLabel("Hash does not match the chain")
      }
    case .none:
      EmptyView()
    }
  }
}

/// The round close button of the evidence room's modals.
struct ModalCloseButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "xmark")
        .font(.body.weight(.bold))
        .foregroundStyle(.primary)
        .frame(width: 36, height: 36)
        .background(.ultraThinMaterial, in: Circle())
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Close")
  }
}
