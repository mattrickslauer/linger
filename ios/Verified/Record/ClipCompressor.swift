import AVFoundation
import Foundation
import VerifiedCore

/// Re-encodes a finished movie file for its `ClipProfile` (v4.14) BEFORE it is hashed and chained, so the bytes the
/// chain commits to, the gallery copy and the upload are all the small file. The camera records at preset `.high`
/// (~1080p, 15-20 Mbit/s: a 2-minute clip already nears the 200 MB upload limit); this writes H.264 at the profile's
/// size and bitrate, keeps at most `fps` frames a second (time is not sped up) and mono AAC audio.
/// Anything that fails leaves the original file in place: a clip is never lost to compression.
nonisolated enum ClipCompressor {
  enum Failure: Error { case noVideoTrack, cannotRead, cannotWrite(String) }

  /// Compresses `url` in place. True when the file was replaced by a smaller one.
  static func compress(url: URL, profile: ClipProfile) async -> Bool {
    let out = url.deletingLastPathComponent().appendingPathComponent("compressing-\(url.lastPathComponent)")
    try? FileManager.default.removeItem(at: out)
    do {
      let started = Date()
      try await transcode(from: url, to: out, profile: profile)
      let before = fileSize(url)
      let after = fileSize(out)
      guard after > 0, before == 0 || after < before else {
        try? FileManager.default.removeItem(at: out)
        return false
      }
      _ = try FileManager.default.replaceItemAt(url, withItemAt: out)
      print("[Verified] clip compressed (\(profile.tier.rawValue)): \(before / 1000) kB -> \(after / 1000) kB in \(Int(Date().timeIntervalSince(started)))s")
      return true
    } catch {
      print("[Verified] clip not compressed, keeping the original:", error)
      try? FileManager.default.removeItem(at: out)
      return false
    }
  }

  private static func fileSize(_ url: URL) -> Int {
    (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
  }

  private static func transcode(from src: URL, to dst: URL, profile: ClipProfile) async throws {
    let asset = AVURLAsset(url: src)
    guard let vTrack = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.noVideoTrack }
    let aTrack = try await asset.loadTracks(withMediaType: .audio).first
    let natural = try await vTrack.load(.naturalSize)
    let transform = try await vTrack.load(.preferredTransform)
    let longest = max(abs(natural.width), abs(natural.height))
    let scale = longest > 0 ? min(1, Double(profile.maxEdge) / Double(longest)) : 1
    // Even dimensions: H.264 encoders refuse odd ones.
    let w = max(2, Int((Double(abs(natural.width)) * scale / 2).rounded()) * 2)
    let h = max(2, Int((Double(abs(natural.height)) * scale / 2).rounded()) * 2)

    let reader = try AVAssetReader(asset: asset)
    let vOut = AVAssetReaderTrackOutput(
      track: vTrack,
      outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    vOut.alwaysCopiesSampleData = false
    guard reader.canAdd(vOut) else { throw Failure.cannotRead }
    reader.add(vOut)

    // Low bitrates need a low sample rate (AAC-LC at 24 kbit/s is only valid up to ~24 kHz).
    let sampleRate = profile.audioBps <= 32_000 ? 24_000 : 44_100
    var aOut: AVAssetReaderTrackOutput?
    if let aTrack {
      let o = AVAssetReaderTrackOutput(
        track: aTrack,
        outputSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM, AVNumberOfChannelsKey: 1, AVSampleRateKey: sampleRate,
          AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsNonInterleaved: false,
        ])
      o.alwaysCopiesSampleData = false
      if reader.canAdd(o) {
        reader.add(o)
        aOut = o
      }
    }

    let writer = try AVAssetWriter(outputURL: dst, fileType: .mov)
    var compression: [String: Any] = [
      AVVideoAverageBitRateKey: profile.videoBps,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel,
      // A key frame at least every 10 s keeps seeking (and the reviewer's sampling) cheap even at 1 fps.
      AVVideoMaxKeyFrameIntervalDurationKey: 10,
    ]
    if let fps = profile.fps { compression[AVVideoExpectedSourceFrameRateKey] = fps }
    let vIn = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
        AVVideoScalingModeKey: AVVideoScalingModeResizeAspect, AVVideoCompressionPropertiesKey: compression,
      ])
    vIn.transform = transform  // stays upright exactly like the camera file
    vIn.expectsMediaDataInRealTime = false
    guard writer.canAdd(vIn) else { throw Failure.cannotWrite("video input") }
    writer.add(vIn)

    var aIn: AVAssetWriterInput?
    if aOut != nil {
      let i = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 1, AVSampleRateKey: sampleRate,
          AVEncoderBitRateKey: profile.audioBps,
        ])
      i.expectsMediaDataInRealTime = false
      if writer.canAdd(i) {
        writer.add(i)
        aIn = i
      }
    }

    guard reader.startReading() else { throw reader.error ?? Failure.cannotRead }
    guard writer.startWriting() else { throw writer.error ?? Failure.cannotWrite("start") }
    writer.startSession(atSourceTime: .zero)

    let pumps = [Pump(reader: reader, input: vIn, output: vOut, minGap: profile.fps.map { 0.98 / $0 }, label: "video")]
      + (aIn.flatMap { i in aOut.map { Pump(reader: reader, input: i, output: $0, minGap: nil, label: "audio") } }.map { [$0] } ?? [])
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      let group = DispatchGroup()
      for p in pumps { p.start(group) }
      group.notify(queue: .global()) { cont.resume() }
    }
    if reader.status == .failed {
      writer.cancelWriting()
      throw reader.error ?? Failure.cannotRead
    }
    await writer.finishWriting()
    guard writer.status == .completed else { throw writer.error ?? Failure.cannotWrite("finish") }
  }

  /// Moves one track's samples from the reader into the writer on its own serial queue (AVAssetWriter interleaves, so
  /// the video and audio inputs must be fed concurrently). AVFoundation objects are not Sendable: everything here is
  /// touched only on `queue`, hence `@unchecked`.
  private final class Pump: @unchecked Sendable {
    let reader: AVAssetReader
    let input: AVAssetWriterInput
    let output: AVAssetReaderTrackOutput
    /// The least time between two kept samples (video thinning); nil keeps every sample.
    let minGap: Double?
    let queue: DispatchQueue
    private var lastKept = -Double.infinity
    private var finished = false

    init(reader: AVAssetReader, input: AVAssetWriterInput, output: AVAssetReaderTrackOutput, minGap: Double?, label: String) {
      self.reader = reader
      self.input = input
      self.output = output
      self.minGap = minGap
      self.queue = DispatchQueue(label: "verified.compress.\(label)")
    }

    func start(_ group: DispatchGroup) {
      group.enter()
      input.requestMediaDataWhenReady(on: queue) { [self] in step(group) }
    }

    /// Runs on `queue`.
    private func step(_ group: DispatchGroup) {
      while input.isReadyForMoreMediaData, !finished {
        guard reader.status == .reading, let sample = output.copyNextSampleBuffer() else { return finish(group) }
        if let gap = minGap {
          let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
          if t.isFinite, t - lastKept < gap { continue }
          lastKept = t
        }
        if !input.append(sample) {
          reader.cancelReading()
          return finish(group)
        }
      }
    }

    private func finish(_ group: DispatchGroup) {
      guard !finished else { return }
      finished = true
      input.markAsFinished()
      group.leave()
    }
  }
}
