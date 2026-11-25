import Foundation

/// `full_video` (v3.6): the chained clip must be uploaded to Cloud Storage before the module runs.
enum ClipUpload {
  /// Uploads the Moment's chained clip and returns its SHA-256 (`clipSha`). Not built yet.
  static func prepare(momentId: String, videos: [MomentDetailModel.ChainVideo]) async throws -> String {
    throw LadderService.Failure(code: "failed-precondition", reason: "clip_missing", message: "Clip upload is not available yet.")
  }
}
