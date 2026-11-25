@preconcurrency import FirebaseFirestore
import UIKit
import VerifiedCore

/// All Firestore writes for a Moment (contract: docs/ARCHITECTURE.md).
/// Writes use completion handlers (never awaited) so they queue offline and sync later.
/// Raw vault: every Moment write is journaled on the phone FIRST (`Vault`); if that fails the call throws
/// and nothing is written to Firestore, so the caller must surface it.
enum MomentStore {
  static var db: Firestore { Firestore.firestore() }
  static func moment(_ id: String) -> DocumentReference { db.collection("moments").document(id) }
  static func chunks(_ id: String) -> CollectionReference { moment(id).collection("chunks") }

  /// `owner == nil` is a guest Moment (docs/ARCHITECTURE.md v3.1): journaled on the phone only, with the
  /// journal-only markers `ownerUid: null, owner: null, guest: true`, and NO Firestore write at all. It reaches the
  /// server only when claimed at sign-in (`Vault.claim` + `Vault.verifyAll`).
  static func create(id: String, owner: SignedInUser?, intention: [String: Any], startedAt: Int64) throws {
    var data: [String: Any] = [
      "ownerUid": owner.map { $0.uid as Any } ?? NSNull(),
      "owner": owner.map { o in
        ["name": o.name, "photoURL": o.photoURL.map { $0 as Any } ?? NSNull()] as [String: Any] as Any
      } ?? NSNull(),
      "intention": intention,
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
      "score": NSNull(),
      "seal": NSNull(),
      "createdAtServer": FieldValue.serverTimestamp(),
    ]
    if owner == nil { data["guest"] = true }
    try Vault.shared.saveMoment(id, data)  // raw copy on the phone first, kept until the server provably has it
    guard owner != nil else { return }  // guest: local only
    moment(id).setData(data) { err in if let err { print("[Verified] create moment:", err) } }
  }

  struct Frame: Sendable { let jpegB64: String; let w: Int; let h: Int; let t: Int64 }

  static func writeChunk(momentId: String, chunk: ChainedChunk, frame: Frame?, guest: Bool) throws {
    let frameData: Any = frame.map { ["jpegB64": $0.jpegB64, "w": $0.w, "h": $0.h, "t": $0.t] } ?? NSNull()
    let data: [String: Any] = [
      "seq": chunk.seq, "t0": chunk.t0, "t1": chunk.t1, "prevHash": chunk.prevHash,
      "payload": chunk.payload, "hash": chunk.hash, "frame": frameData,
    ]
    try Vault.shared.saveChunk(momentId, seq: chunk.seq, data)
    guard !guest else { return }
    chunks(momentId).document(chunk.docId).setData(data) { err in if let err { print("[Verified] chunk \(chunk.seq):", err) } }
  }

  /// `sendNow == false` (v4.4: chained clips must reach Storage first) journals the submit fields only; the caller
  /// sends them with `sendSubmitFromJournal` once every clip is uploaded (the raw vault retries otherwise).
  static func submit(momentId: String, endedAt: Int64, chunkCount: Int, headHash: String?,
                     summary: MomentSummary, onDevice: (mode: String, checks: Int, retakes: Int),
                     witness: [String: Any], guest: Bool, sendNow: Bool = true) throws {
    let fields: [String: Any] = [
      "status": "submitted",
      "endedAt": endedAt,
      "chunkCount": chunkCount,
      "headHash": headHash ?? NSNull(),
      "summary": summary.firestoreData,
      "onDevice": ["mode": onDevice.mode, "checks": onDevice.checks, "retakes": onDevice.retakes],
      "witness": witness,
      "submittedAtServer": FieldValue.serverTimestamp(),
    ]
    try Vault.shared.updateMoment(momentId, fields)
    guard !guest, sendNow else { return }
    moment(momentId).updateData(fields) { err in if let err { print("[Verified] submit:", err) } }
  }

  /// The journaled submit fields → `moments/{id}` (queues offline like any write).
  static func sendSubmitFromJournal(momentId: String) {
    guard let json = try? Data(contentsOf: VaultIO.momentFile(momentId)),
          let fields = try? VaultIO.submitUpdate(json) else { return }
    moment(momentId).updateData(fields) { err in if let err { print("[Verified] submit:", err) } }
  }

  /// Judge, skeptic and score land in one write: the seal never sees a partial set.
  static func writeOpinions(momentId: String, judge: AiOpinion, skeptic: AiOpinion, score: VerificationScore) {
    let fields: [String: Any] = [
      "judge": judge.firestoreData, "skeptic": skeptic.firestoreData, "score": score.firestoreData,
    ]
    moment(momentId).updateData(fields) { err in
      if let err { print("[Verified] opinions:", err) }
    }
  }

  /// Owner-only delete (docs/ARCHITECTURE.md "Deleting a Moment"). The local raw-vault journal goes FIRST, so this
  /// device can never re-upload the Moment; if that fails the call throws and nothing is deleted on the server.
  /// Then `delete moments/{id}` (queues offline like any write). The `onMomentDeleted` function removes the chunks
  /// and the feed entry and writes the `deleted/{id}` tombstone other devices' vaults check.
  static func delete(id: String) throws {
    try Vault.shared.forget(id)
    moment(id).delete { err in if let err { print("[Verified] delete moment \(id):", err) } }
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
