@preconcurrency import FirebaseFirestore
import UIKit
import VerifiedCore

/// All Firestore writes for a Moment (contract: docs/ARCHITECTURE.md).
/// Writes use completion handlers (never awaited) so they queue offline and sync later.
enum MomentStore {
  static var db: Firestore { Firestore.firestore() }
  static func moment(_ id: String) -> DocumentReference { db.collection("moments").document(id) }
  static func chunks(_ id: String) -> CollectionReference { moment(id).collection("chunks") }

  static func create(id: String, owner: SignedInUser, intention: String, category: Category, startedAt: Int64) {
    let data: [String: Any] = [
      "ownerUid": owner.uid,
      "owner": ["name": owner.name, "photoURL": owner.photoURL ?? NSNull()],
      "intention": ["text": String(intention.prefix(200)), "category": category.rawValue],
      "platform": "ios",
      "device": ["model": deviceModel(), "os": "iOS \(UIDevice.current.systemVersion)", "appVersion": AppConfig.appVersion],
      "status": "recording",
      "startedAt": startedAt,
      "endedAt": NSNull(),
      "chunkCount": 0,
      "headHash": NSNull(),
      "summary": NSNull(),
      "onDevice": ["mode": "none", "checks": 0, "retakes": 0],
      "judge": NSNull(),
      "skeptic": NSNull(),
      "seal": NSNull(),
      "createdAtServer": FieldValue.serverTimestamp(),
    ]
    moment(id).setData(data) { err in if let err { print("[Verified] create moment:", err) } }
  }

  struct Frame: Sendable { let jpegB64: String; let w: Int; let h: Int; let t: Int64 }

  static func writeChunk(momentId: String, chunk: ChainedChunk, frame: Frame?) {
    let frameData: Any = frame.map { ["jpegB64": $0.jpegB64, "w": $0.w, "h": $0.h, "t": $0.t] } ?? NSNull()
    chunks(momentId).document(chunk.docId).setData([
      "seq": chunk.seq, "t0": chunk.t0, "t1": chunk.t1, "prevHash": chunk.prevHash,
      "payload": chunk.payload, "hash": chunk.hash, "frame": frameData,
    ]) { err in if let err { print("[Verified] chunk \(chunk.seq):", err) } }
  }

  static func submit(momentId: String, endedAt: Int64, chunkCount: Int, headHash: String?,
                     summary: MomentSummary, onDevice: (mode: String, checks: Int, retakes: Int)) {
    moment(momentId).updateData([
      "status": "submitted",
      "endedAt": endedAt,
      "chunkCount": chunkCount,
      "headHash": headHash ?? NSNull(),
      "summary": summary.firestoreData,
      "onDevice": ["mode": onDevice.mode, "checks": onDevice.checks, "retakes": onDevice.retakes],
      "submittedAtServer": FieldValue.serverTimestamp(),
    ]) { err in if let err { print("[Verified] submit:", err) } }
  }

  static func writeOpinions(momentId: String, judge: AiOpinion, skeptic: AiOpinion) {
    moment(momentId).updateData(["judge": judge.firestoreData, "skeptic": skeptic.firestoreData]) { err in
      if let err { print("[Verified] opinions:", err) }
    }
  }

  /// "iPhone17,1" style hardware identifier.
  static func deviceModel() -> String {
    var info = utsname()
    uname(&info)
    let id = withUnsafeBytes(of: &info.machine) { raw in
      String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
    }
    return id.isEmpty ? UIDevice.current.model : id
  }
}
