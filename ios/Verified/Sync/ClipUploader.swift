@preconcurrency import FirebaseStorage
import Foundation
import Observation
import UIKit
import VerifiedCore

/// v4.4 clip upload at submit (all platforms): every chained `video` clip goes to
/// `clips/{uid}/{momentId}/{sha256}.{ext}` BEFORE the client writes `status = "submitted"`, so the free video review
/// can watch it. Idempotent: `getMetadata` first (the owner may `get`), an existing object is skipped (storage.rules
/// refuse overwrites). Offline or failing: returns false and the caller does not submit; the raw vault retries.
/// A clip ≥ 200 MB, or one this phone no longer has (or whose bytes no longer match the chain), is skipped for good:
/// its requirements stay unmet and the Moment submits without it.
///
/// Uploads run one at a time, inside a UIKit background task so a Finish followed by locking the phone still
/// completes (Firebase Storage resumes a session upload on its own URLSession).
@Observable
final class ClipUploader {
  static let shared = ClipUploader()

  enum State: Equatable {
    /// "Uploading video · 34 MB"
    case uploading(totalBytes: Int64, sentBytes: Int64)
    /// "Video uploaded"
    case uploaded
    /// Offline or a failed upload: retried by the raw vault.
    case waiting
  }

  /// Per Moment, for the Record tab banner and the detail screen.
  private(set) var states: [String: State] = [:]
  @ObservationIgnored private var inflight: [String: Task<Bool, Never>] = [:]

  /// A chained clip, from the journal's `video` events.
  nonisolated struct ChainClip: Sendable, Equatable {
    let sha256: String
    let name: String
    let bytes: Int64
    var ext: String {
      let e = (name as NSString).pathExtension.lowercased()
      return ["mp4", "mov", "webm"].contains(e) ? e : "mov"
    }
    var contentType: String {
      switch ext {
      case "mp4": "video/mp4"
      case "webm": "video/webm"
      default: "video/quicktime"
      }
    }
  }

  /// Every `video` event in the Moment's journaled chunks, in chain order.
  nonisolated static func chainClips(_ momentId: String) -> [ChainClip] {
    var out: [ChainClip] = []
    for chunk in Vault.localChunks(momentId) {
      guard let payload = chunk["payload"] as? String,
            let obj = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] else { continue }
      for e in (obj["events"] as? [[String: Any]]) ?? [] where e["type"] as? String == "video" {
        guard let sha = e["sha256"] as? String, sha.count == 64 else { continue }
        out.append(ChainClip(sha256: sha, name: e["name"] as? String ?? "",
                             bytes: (e["bytes"] as? NSNumber)?.int64Value ?? 0))
      }
    }
    return out
  }

  /// True when every uploadable chained clip is in Cloud Storage (or there is none); false to retry later.
  func ensureUploaded(momentId: String, uid: String) async -> Bool {
    if let running = inflight[momentId] { return await running.value }
    let task = Task { await self.run(momentId: momentId, uid: uid) }
    inflight[momentId] = task
    let ok = await task.value
    inflight[momentId] = nil
    return ok
  }

  private func run(momentId: String, uid: String) async -> Bool {
    let clips = await Task.detached { Self.chainClips(momentId) }.value
    guard !clips.isEmpty else { return true }
    let bg = UploadBackgroundTask(name: "clip-upload-\(momentId.prefix(8))")
    defer { bg.end() }

    let total = clips.reduce(Int64(0)) { $0 + ($1.bytes < ClipUpload.maxBytes ? $1.bytes : 0) }
    var sent: Int64 = 0
    for clip in clips {
      let path = "clips/\(uid)/\(momentId)/\(clip.sha256).\(clip.ext)"
      switch await Self.exists(path) {
      case .some(true):
        sent += clip.bytes
        continue
      case .none:
        states[momentId] = .waiting
        return false  // offline / storage unreachable: submit waits
      case .some(false): break
      }
      guard clip.bytes < ClipUpload.maxBytes else {
        print("[Verified] clip \(clip.sha256.prefix(8)) is over 200 MB: not uploaded, its requirements stay unmet")
        continue
      }
      guard let local = await ClipUpload.localCopy(momentId: momentId, name: clip.name) else {
        print("[Verified] clip \(clip.name) is no longer on this phone: submitting without it")
        continue
      }
      defer { if local.isTemporary { try? FileManager.default.removeItem(at: local.url) } }
      let hashed = try? await Task.detached { try sha256HexOfFile(at: local.url) }.value
      guard let hashed, hashed.sha256 == clip.sha256 else {
        print("[Verified] clip \(clip.name) no longer matches the chain: submitting without it")
        continue
      }
      states[momentId] = .uploading(totalBytes: max(total, sent + hashed.bytes), sentBytes: sent)
      let base = sent
      do {
        try await ClipUpload.upload(local.url, to: path, contentType: clip.contentType) { [weak self] done in
          self?.states[momentId] = .uploading(totalBytes: max(total, base + hashed.bytes), sentBytes: base + done)
        }
        sent += hashed.bytes
      } catch {
        print("[Verified] clip upload \(clip.sha256.prefix(8)) failed: \(error.localizedDescription)")
        states[momentId] = .waiting
        return false
      }
    }
    states[momentId] = .uploaded
    return true
  }

  /// true = exists, false = not found, nil = couldn't tell (offline, …).
  private static func exists(_ path: String) async -> Bool? {
    await withCheckedContinuation { c in
      Storage.storage().reference(withPath: path).getMetadata { _, error in
        guard let error = error as NSError? else { return c.resume(returning: true) }
        if error.domain == StorageErrorDomain && error.code == StorageErrorCode.objectNotFound.rawValue {
          c.resume(returning: false)
        } else if error.domain == StorageErrorDomain && error.code == StorageErrorCode.unauthorized.rawValue {
          // Storage rules without the v4 owner `get`: can't tell, so try the upload; an existing object is then
          // refused as an overwrite, which `ClipUpload.upload` treats as already uploaded.
          c.resume(returning: false)
        } else {
          print("[Verified] clip metadata \(path): \(error.localizedDescription)")
          c.resume(returning: nil)
        }
      }
    }
  }
}

/// A UIKit background task that also ends itself when iOS says time is up: a task still open at expiry gets the app
/// killed. The cut-off upload then simply fails and the raw vault retries it on the next pass.
@MainActor
final class UploadBackgroundTask {
  private var id: UIBackgroundTaskIdentifier = .invalid

  init(name: String) {
    id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
      MainActor.assumeIsolated { self?.end() }
    }
  }

  func end() {
    guard id != .invalid else { return }
    UIApplication.shared.endBackgroundTask(id)
    id = .invalid
  }
}

extension ClipUploader.State {
  /// v4.11 words.
  var label: String {
    switch self {
    case .uploading(let total, _): "Uploading video · \(ClipUploader.megabytes(total))"
    case .uploaded: "Video uploaded"
    case .waiting: "Video waits for a connection"
    }
  }

  var fraction: Double? {
    if case .uploading(let total, let sent) = self, total > 0 { return min(1, Double(sent) / Double(total)) }
    return nil
  }
}

extension ClipUploader {
  nonisolated static func megabytes(_ bytes: Int64) -> String {
    let mb = Double(bytes) / 1_048_576
    return mb < 10 ? String(format: "%.1f MB", mb) : "\(Int(mb.rounded())) MB"
  }
}
