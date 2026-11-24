import Foundation

/// One sealed chunk of a Moment, as stored in `moments/{id}/chunks/{seq}`.
/// `payload` is the exact JSON string that is hashed; it is never re-serialized.
public struct ChainedChunk: Sendable, Equatable {
  public let seq: Int
  public let t0: Int64
  public let t1: Int64
  public let prevHash: String
  public let payload: String
  public let hash: String

  public init(seq: Int, t0: Int64, t1: Int64, prevHash: String, payload: String, hash: String) {
    self.seq = seq
    self.t0 = t0
    self.t1 = t1
    self.prevHash = prevHash
    self.payload = payload
    self.hash = hash
  }

  /// Firestore document id: seq zero-padded to 6 digits.
  public var docId: String { Chain.docId(seq) }
}

/// SHA-256 hash chain: hash = sha256("seq|t0|t1|prevHash|sha256(payload)").
public struct Chain: Sendable {
  public let momentId: String
  public private(set) var seq: Int = 0
  public private(set) var headHash: String

  public init(momentId: String) {
    self.momentId = momentId
    self.headHash = Chain.genesis(momentId)
  }

  public static func genesis(_ momentId: String) -> String { "GENESIS:" + momentId }

  public static func docId(_ seq: Int) -> String {
    let s = String(seq)
    return String(repeating: "0", count: max(0, 6 - s.count)) + s
  }

  public static func hash(seq: Int, t0: Int64, t1: Int64, prevHash: String, payload: String) -> String {
    sha256Hex("\(seq)|\(t0)|\(t1)|\(prevHash)|\(sha256Hex(payload))")
  }

  /// Appends a payload and returns the sealed chunk. Advances `seq` and `headHash`.
  public mutating func append(t0: Int64, t1: Int64, payload: String) -> ChainedChunk {
    let h = Chain.hash(seq: seq, t0: t0, t1: t1, prevHash: headHash, payload: payload)
    let chunk = ChainedChunk(seq: seq, t0: t0, t1: t1, prevHash: headHash, payload: payload, hash: h)
    seq += 1
    headHash = h
    return chunk
  }

  /// The last chunk hash, or nil if nothing was appended.
  public var lastHash: String? { seq == 0 ? nil : headHash }

  /// Verifies links and hashes of an ordered chunk list (what the Cloud Function does).
  public static func verify(momentId: String, chunks: [ChainedChunk]) -> Bool {
    var prev = genesis(momentId)
    for (i, c) in chunks.enumerated() {
      guard c.seq == i, c.prevHash == prev,
            hash(seq: c.seq, t0: c.t0, t1: c.t1, prevHash: c.prevHash, payload: c.payload) == c.hash
      else { return false }
      prev = c.hash
    }
    return true
  }
}
