import AVFoundation
import Foundation
import Photos
import VerifiedCore

/// Turns a finished movie file into chain evidence (like Android's `finishClip`): SHA-256 of the file bytes,
/// duration, and the middle frame as a proof frame (640 px JPEG q0.6, labelled for the on-device coach).
/// Then keeps the clip on the phone: Photos album "Verified" (or a plain Photos item with limited access),
/// falling back to the app's Documents/Clips folder when Photos access is denied.
nonisolated enum VideoClipFile {
  struct Processed: Sendable {
    let clip: VideoClip
    let poster: ProofFrame?
  }

  /// Hashes the clip and extracts its poster. `posterT` is the proof-frame time (the stop time).
  static func process(url: URL, startedAt: Int64, endedAt: Int64, posterT: Int64) async throws -> Processed {
    let (sha, bytes) = try sha256HexOfFile(at: url)
    let asset = AVURLAsset(url: url)
    let seconds = (try? await asset.load(.duration).seconds) ?? 0
    var durationMs = VideoClip.durationMs(seconds: seconds)
    if durationMs == 0 { durationMs = max(0, endedAt - startedAt) }

    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true  // upright, like Android's MediaMetadataRetriever frame
    gen.maximumSize = CGSize(width: ProofFrame.maxSide, height: ProofFrame.maxSide)
    let tolerance = CMTime(seconds: 0.5, preferredTimescale: 600)
    gen.requestedTimeToleranceBefore = tolerance
    gen.requestedTimeToleranceAfter = tolerance
    let middle = CMTime(seconds: Double(durationMs) / 2000, preferredTimescale: 600)
    var poster: ProofFrame?
    if let image = (try? await gen.image(at: middle))?.image { poster = ProofFrame.make(from: image, t: posterT) }

    let clip = VideoClip(name: url.lastPathComponent, sha256: sha, bytes: bytes, durationMs: durationMs, startedAt: startedAt)
    return Processed(clip: clip, poster: poster)
  }

  enum Saved: Sendable { case album, photos, appFolder, failed }

  static let albumTitle = "Verified"

  /// Moves the clip into the user's library (album "Verified") and deletes the temporary file.
  /// Photos stores the original file bytes, so the gallery copy still matches the chained SHA-256.
  static func keep(url: URL) async -> Saved {
    var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if status == .notDetermined { status = await PHPhotoLibrary.requestAuthorization(for: .readWrite) }
    if status == .authorized || status == .limited {
      let intoAlbum = status == .authorized  // albums can only be found / created with full access
      let title = albumTitle
      do {
        try await PHPhotoLibrary.shared().performChanges {
          let req = PHAssetCreationRequest.forAsset()
          let opts = PHAssetResourceCreationOptions()
          opts.originalFilename = url.lastPathComponent
          req.addResource(with: .video, fileURL: url, options: opts)
          guard intoAlbum, let placeholder = req.placeholderForCreatedAsset else { return }
          let fetch = PHFetchOptions()
          fetch.predicate = NSPredicate(format: "title = %@", title)
          let album: PHAssetCollectionChangeRequest? =
            if let existing = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: fetch)
              .firstObject
            {
              PHAssetCollectionChangeRequest(for: existing)
            } else {
              PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
            }
          album?.addAssets([placeholder] as NSArray)
        }
        try? FileManager.default.removeItem(at: url)
        return intoAlbum ? .album : .photos
      } catch {
        print("[Verified] Photos save failed:", error.localizedDescription)
      }
    }
    // No Photos access: keep it in the app (visible in Files if file sharing is ever enabled).
    do {
      let dir = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("Clips", isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let dest = dir.appendingPathComponent(url.lastPathComponent)
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.moveItem(at: url, to: dest)
      return .appFolder
    } catch {
      print("[Verified] could not keep clip:", error.localizedDescription)
      return .failed
    }
  }
}
