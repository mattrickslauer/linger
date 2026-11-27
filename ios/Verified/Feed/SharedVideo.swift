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

/// SwiftUI `VideoPlayer` turned by the Moment's `displayRotation` so the clip is upright and still fits its frame:
/// for a quarter turn the player is laid out in the swapped size, then rotated. The system controls turn with it
/// (sideways at 90/270, upside down at 180) and full screen shows the clip as stored; 0 is the plain player.
struct RotatedVideoPlayer: View {
  let player: AVPlayer
  let rotation: Int

  var body: some View {
    let r = normalizeDisplayRotation(rotation)
    if r == 0 {
      VideoPlayer(player: player)
    } else {
      GeometryReader { g in
        let size = displayRotatedSize(width: g.size.width, height: g.size.height, rotation: r)
        VideoPlayer(player: player)
          .frame(width: size.width, height: size.height)
          .rotationEffect(.degrees(Double(r)))
          .frame(width: g.size.width, height: g.size.height)
      }
    }
  }
}

// MARK: - Evidence room

/// Every uploaded clip of the Moment, playable with controls, never autoplayed.
struct SharedClipsSection: View {
  let clips: [SharedClip]
  /// The Moment's `displayRotation` (clockwise degrees).
  var rotation = 0

  var body: some View {
    if clips.count == 1, let clip = clips.first {
      SharedClipRow(clip: clip, index: 1, count: 1, rotation: rotation)
    } else {
      // Several clips: a horizontal carousel instead of a tall stack.
      ScrollView(.horizontal, showsIndicators: false) {
        LazyHStack(alignment: .top, spacing: 10) {
          ForEach(Array(clips.enumerated()), id: \.element.id) { i, clip in
            SharedClipRow(clip: clip, index: i + 1, count: clips.count, rotation: rotation)
              .frame(width: 272)
          }
        }
      }
      .scrollClipDisabled()
    }
  }
}

private struct SharedClipRow: View {
  let clip: SharedClip
  let index: Int
  let count: Int
  var rotation = 0
  @State private var player: AVPlayer?
  @State private var failed = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ZStack {
        Color.black
        if let player {
          RotatedVideoPlayer(player: player, rotation: rotation)
        } else if failed {
          Label("Couldn't load this clip", systemImage: "video.slash")
            .font(.footnote).foregroundStyle(.white.opacity(0.8))
        } else {
          ProgressView().tint(.white)
        }
      }
      .frame(height: 220)
      .frame(maxWidth: .infinity)
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
      HStack(spacing: 4) {
        Text(count > 1 ? "Clip \(index) of \(count)" : "Clip").font(.caption.weight(.semibold))
        if clip.durationMs > 0 {
          Text("· \(formatDuration(ms: clip.durationMs))").font(.caption.monospacedDigit())
        }
        Spacer(minLength: 0)
      }
      .foregroundStyle(.secondary)
      if clip.hashOk == false {
        Label("Hash does not match the chain", systemImage: "exclamationmark.triangle.fill")
          .font(.caption.weight(.semibold)).foregroundStyle(Theme.bad)
      }
    }
    .task(id: clip.path) {
      guard player == nil else { return }
      if let url = await ClipURLCache.url(for: clip.path) {
        ClipAudio.use(sound: true)
        player = AVPlayer(url: url)
      } else {
        failed = true
      }
    }
    .onDisappear { player?.pause() }
  }
}
