@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseStorage
import Foundation
import Photos
import VerifiedCore

/// v4: every chained clip is uploaded at submit by `ClipUploader` (helpers below are shared); a v4 Moment's
/// `full_video` run needs no upload. v3 Moments keep this path:
/// `full_video` (v3.6): before the module runs, the chained clip goes to Cloud Storage at
/// `clips/{uid}/{momentId}/{sha256}.mov` (owner create-only, `video/*`, < 200 MB; only Functions read it).
/// The clip never left the phone during recording (only its SHA-256 is in the chain), so it is found where the
/// recorder kept it: Photos (album "Verified", original bytes) or the app's Documents/Clips folder. The local bytes
/// are re-hashed first: only a file whose hash matches the chained `video` event is uploaded, and the function
/// re-hashes it again (a mismatch costs nothing).
enum ClipUpload {
  static let maxBytes: Int64 = 200 * 1024 * 1024

  /// Uploads the newest chained clip found on this phone and returns its SHA-256 (`clipSha`).
  static func prepare(momentId: String, videos: [MomentDetailModel.ChainVideo]) async throws -> String {
    guard let uid = Auth.auth().currentUser?.uid else {
      throw LadderService.Failure(code: "unauthenticated", reason: "sign_in", message: "Sign in first.")
    }
    for v in videos.reversed() {  // contract default: the last `video` event
      guard let url = await localCopy(momentId: momentId, name: v.name)?.url else { continue }
      defer { if url.path.hasPrefix(FileManager.default.temporaryDirectory.path) { try? FileManager.default.removeItem(at: url) } }
      let hashed = try? await Task.detached { try sha256HexOfFile(at: url) }.value
      guard let hashed, hashed.sha256 == v.sha256 else { continue }
      guard hashed.bytes < maxBytes else {
        throw LadderService.Failure(code: "failed-precondition", reason: "", message: "This clip is over 200 MB.")
      }
      try await upload(url, to: "clips/\(uid)/\(momentId)/\(v.sha256).mov")
      return v.sha256
    }
    throw LadderService.Failure(
      code: "failed-precondition", reason: "",
      message: videos.isEmpty ? "This Moment has no video clip."
        : "The clip isn't on this phone (or was edited), so it can't be matched to the chain.")
  }

  // MARK: - Find the clip

  /// The raw-vault copy (v4), then Documents/Clips, then Photos (written to a temporary file: `isTemporary`).
  static func localCopy(momentId: String, name: String) async -> (url: URL, isTemporary: Bool)? {
    guard !name.isEmpty else { return nil }
    if let f = ClipStore.file(momentId, name: name) { return (f, false) }
    if let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false) {
      let f = docs.appendingPathComponent("Clips", isDirectory: true).appendingPathComponent(name)
      if FileManager.default.fileExists(atPath: f.path) { return (f, false) }
    }
    return await fromPhotos(name: name).map { ($0, true) }
  }

  /// Writes the original resource of the Photos video named `name` to a temporary file.
  private static func fromPhotos(name: String) async -> URL? {
    var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if status == .notDetermined { status = await PHPhotoLibrary.requestAuthorization(for: .readWrite) }
    guard status == .authorized || status == .limited else { return nil }
    let opts = PHFetchOptions()
    opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    opts.fetchLimit = 300
    let assets = PHAsset.fetchAssets(with: .video, options: opts)
    var match: PHAssetResource?
    assets.enumerateObjects { asset, _, stop in
      if let r = PHAssetResource.assetResources(for: asset).first(where: {
        $0.originalFilename == name && ($0.type == .video || $0.type == .fullSizeVideo)
      }) {
        match = r
        stop.pointee = true
      }
    }
    guard let match else { return nil }
    let dest = FileManager.default.temporaryDirectory.appendingPathComponent("upload-\(UUID().uuidString)-\(name)")
    let ropts = PHAssetResourceRequestOptions()
    ropts.isNetworkAccessAllowed = true  // iCloud Photos may hold only the original in the cloud
    let ok: Bool = await withCheckedContinuation { c in
      PHAssetResourceManager.default().writeData(for: match, toFile: dest, options: ropts) { error in
        c.resume(returning: error == nil)
      }
    }
    return ok ? dest : nil
  }

  // MARK: - Upload

  static func upload(_ url: URL, to path: String, contentType: String = "video/quicktime",
                     progress: (@MainActor (Int64) -> Void)? = nil) async throws {
    let meta = StorageMetadata()
    meta.contentType = contentType
    // Named by sha256 and never overwritten (rules: create only), so viewers may cache the clip for good.
    meta.cacheControl = "private, max-age=31536000, immutable"
    let ref = Storage.storage().reference(withPath: path)
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      let task = ref.putFile(from: url, metadata: meta) { _, error in
        // storage.rules allow create only: on a retry (the clip went up, the module call then failed) the same
        // path is an overwrite and is refused. The path is the clip's SHA-256, so the bytes there are already
        // these; carry on and let the function re-hash them (it answers `clip_missing` if nothing is there).
        if let error, !alreadyUploaded(error) { c.resume(throwing: error) } else { c.resume() }
      }
      if let progress {
        // Storage calls back on the main queue.
        task.observe(.progress) { snap in
          let done = snap.progress?.completedUnitCount ?? 0
          MainActor.assumeIsolated { progress(done) }
        }
      }
    }
  }

  private static func alreadyUploaded(_ error: Error) -> Bool {
    let e = error as NSError
    return e.domain == StorageErrorDomain && StorageErrorCode(rawValue: e.code) == .unauthorized
  }
}
