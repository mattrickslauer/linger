/// Pure comparison of the phone's raw journal with what the server returned (docs/ARCHITECTURE.md "Raw vault").
/// Mirrors Android `VaultCheck.compare`: an empty result means the server provably holds every chunk,
/// so the local copy may be deleted; any problem means keep it.
public enum VaultCheck {
  public struct Chunk: Sendable, Equatable {
    public var seq: Int
    public var hash: String
    public var payload: String
    public var frameB64: String?

    public init(seq: Int, hash: String, payload: String, frameB64: String?) {
      self.seq = seq; self.hash = hash; self.payload = payload; self.frameB64 = frameB64
    }
  }

  public static func compare(
    localHead: String?, localCount: Int, serverHead: String?, serverCount: Int?, serverStatus: String?,
    local: [Chunk], server: [Chunk]
  ) -> [String] {
    var p: [String] = []
    if !["submitted", "sealed", "rejected"].contains(serverStatus ?? "") { p.append("status \(serverStatus ?? "nil")") }
    if serverHead != localHead { p.append("headHash") }
    if serverCount != localCount { p.append("chunkCount \(serverCount.map(String.init) ?? "nil") != \(localCount)") }
    var bySeq: [Int: Chunk] = [:]
    for c in server { bySeq[c.seq] = c }
    if server.count != local.count { p.append("server has \(server.count) chunks, journal \(local.count)") }
    for c in local {
      guard let s = bySeq[c.seq] else {
        p.append("chunk \(c.seq) missing")
        continue
      }
      if s.hash != c.hash { p.append("chunk \(c.seq) hash") }
      if s.payload != c.payload { p.append("chunk \(c.seq) payload") }
      if s.frameB64 != c.frameB64 { p.append("chunk \(c.seq) frame") }
    }
    return p
  }
}
