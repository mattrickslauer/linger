import Testing
@testable import VerifiedCore

/// Mirrors android/.../VaultCheckTest.kt: the local raw copy may only be deleted on a full match.
struct VaultCheckTests {
  typealias Chunk = VaultCheck.Chunk
  let local = [Chunk(seq: 0, hash: "h0", payload: "{\"gps\":[]}", frameB64: nil),
               Chunk(seq: 1, hash: "h1", payload: "{\"gps\":[1]}", frameB64: "AAAA")]

  func check(_ server: [Chunk], head: String? = "h1", count: Int? = 2, status: String? = "submitted") -> [String] {
    VaultCheck.compare(localHead: "h1", localCount: 2, serverHead: head, serverCount: count, serverStatus: status,
                       local: local, server: server)
  }

  func with(_ c: Chunk, _ change: (inout Chunk) -> Void) -> Chunk {
    var c = c
    change(&c)
    return c
  }

  @Test func identicalServerCopyPasses() {
    #expect(check(local) == [])
    #expect(check(local, status: "sealed") == [])
    #expect(check(local, status: "rejected") == [])
    #expect(check(local.reversed()) == [])  // order on the server doesn't matter
  }

  @Test func missingChunkKeepsLocalCopy() {
    #expect(check(Array(local.prefix(1))).contains { $0.contains("chunk 1 missing") })
  }

  @Test func differentPayloadHashOrFrameKeepsLocalCopy() {
    #expect(check([local[0], with(local[1]) { $0.payload = "{}" }]).contains { $0.contains("payload") })
    #expect(check([local[0], with(local[1]) { $0.hash = "x" }]).contains { $0.contains("hash") })
    #expect(check([local[0], with(local[1]) { $0.frameB64 = nil }]).contains { $0.contains("frame") })
    #expect(check([with(local[0]) { $0.frameB64 = "BBBB" }, local[1]]).contains { $0.contains("chunk 0 frame") })
  }

  @Test func wrongHeadCountOrStatusKeepsLocalCopy() {
    #expect(check(local, head: "other").contains("headHash"))
    #expect(check(local, head: nil).contains("headHash"))
    #expect(check(local, count: 3).contains { $0.contains("chunkCount") })
    #expect(check(local, count: nil).contains { $0.contains("chunkCount") })
    #expect(check(local, status: "recording").contains { $0.contains("status") })
    #expect(check(local, status: nil).contains { $0.contains("status") })
  }

  @Test func extraServerChunkIsFlagged() {
    #expect(check(local + [Chunk(seq: 2, hash: "h2", payload: "{}", frameB64: nil)]).contains { $0.contains("server has 3") })
  }
}
