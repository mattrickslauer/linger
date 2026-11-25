import Foundation

/// v4.4: an app-private copy of every chained clip, kept in the Moment's raw-vault folder
/// (`Application Support/vault/{momentId}/clips/{name}`) until the clip is provably in Cloud Storage. The upload at
/// submit reads from here first; Photos (album "Verified") and Documents/Clips stay as fallbacks. The vault deletes the
/// folder only after the server has the Moment AND every clip (see `VaultIO.verify`).
nonisolated enum ClipStore {
  static func dir(_ momentId: String) -> URL { VaultIO.dir(momentId).appendingPathComponent("clips", isDirectory: true) }

  static func file(_ momentId: String, name: String) -> URL? {
    guard !name.isEmpty, !name.contains("/") else { return nil }
    let f = dir(momentId).appendingPathComponent(name)
    return FileManager.default.fileExists(atPath: f.path) ? f : nil
  }

  /// Copies (never moves) the finished movie file; Photos still gets the original afterwards.
  static func keepForUpload(url: URL, momentId: String, name: String) {
    guard !name.isEmpty, !name.contains("/") else { return }
    do {
      try FileManager.default.createDirectory(at: dir(momentId), withIntermediateDirectories: true)
      let dest = dir(momentId).appendingPathComponent(name)
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.copyItem(at: url, to: dest)
      try? (dest as NSURL).setResourceValue(true, forKey: .isExcludedFromBackupKey)
    } catch {
      print("[Verified] could not keep clip for upload:", error.localizedDescription)
    }
  }
}
