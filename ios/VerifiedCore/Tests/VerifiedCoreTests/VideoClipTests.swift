import Foundation
import Testing
@testable import VerifiedCore

@Suite struct VideoClipTests {
  let clip = VideoClip(name: "verified-1234abcd-1764000010000.mov", sha256: String(repeating: "ab", count: 32),
                       bytes: 1_234_567, durationMs: 4_321, startedAt: 1764000010000)

  @Test func eventKindsSerializeAsContractNames() {
    #expect(MomentEvent.Kind.videoStart.rawValue == "video_start")
    #expect(MomentEvent.Kind.video.rawValue == "video")
  }

  @Test func videoEventKeyOrderMatchesAndroid() {
    // Android: Event(t, "video", mapOf("sha256", "bytes", "durationMs", "startedAt", "name")).
    let expected = "{\"t\":1764000014400,\"type\":\"video\",\"sha256\":\"\(clip.sha256)\",\"bytes\":1234567,"
      + "\"durationMs\":4321,\"startedAt\":1764000010000,\"name\":\"verified-1234abcd-1764000010000.mov\"}"
    #expect(clip.event(t: 1764000014400).json.serialized == expected)
  }

  @Test func frameChunkWithVideoPayload() {
    let p = Payload(
      events: [
        MomentEvent(t: 1764000010000, type: .videoStart),
        MomentEvent(t: 1764000014400, type: .frame, extras: [("w", .int(360)), ("h", .int(640))]),
        clip.event(t: 1764000014400),
        MomentEvent(t: 1764000014900, type: .check, extras: [("ok", .bool(true)), ("mode", .string("on_device"))]),
      ],
      frameSha: sha256Hex("aGVsbG8="),
      check: FrameCheck(ok: true, reason: "keep going", mode: .onDevice, label: "fish"))
    let expected = "{\"gps\":[],\"motion\":[],\"events\":[{\"t\":1764000010000,\"type\":\"video_start\"},"
      + "{\"t\":1764000014400,\"type\":\"frame\",\"w\":360,\"h\":640},"
      + "{\"t\":1764000014400,\"type\":\"video\",\"sha256\":\"\(clip.sha256)\",\"bytes\":1234567,\"durationMs\":4321,"
      + "\"startedAt\":1764000010000,\"name\":\"verified-1234abcd-1764000010000.mov\"},"
      + "{\"t\":1764000014900,\"type\":\"check\",\"ok\":true,\"mode\":\"on_device\"}],"
      + "\"frameSha\":\"\(sha256Hex("aGVsbG8="))\","
      + "\"check\":{\"ok\":true,\"reason\":\"keep going\",\"mode\":\"on_device\",\"label\":\"fish\"}}"
    #expect(p.string == expected)
  }

  @Test func fileNameAndDuration() {
    #expect(VideoClip.fileName(momentId: "1234abcd-ffff-4000-8000-000000000000", startedAt: 42) == "verified-1234abcd-42.mov")
    #expect(VideoClip.durationMs(seconds: 4.3214) == 4321)
    #expect(VideoClip.durationMs(seconds: .nan) == 0)
    #expect(VideoClip.durationMs(seconds: -1) == 0)
  }

  @Test func fileHashIsStreamedAndMatchesInMemory() throws {
    let dir = FileManager.default.temporaryDirectory
    let url = dir.appendingPathComponent("vc-\(UUID().uuidString).bin")
    defer { try? FileManager.default.removeItem(at: url) }
    // > 1 MB so more than one block is read.
    var data = Data(count: (1 << 20) + 12_345)
    for i in data.indices { data[i] = UInt8(truncatingIfNeeded: i &* 31) }
    try data.write(to: url)
    let r = try sha256HexOfFile(at: url)
    #expect(r.bytes == Int64(data.count))
    #expect(r.sha256 == sha256Hex(data))

    let empty = dir.appendingPathComponent("vc-\(UUID().uuidString).bin")
    defer { try? FileManager.default.removeItem(at: empty) }
    try Data().write(to: empty)
    let e = try sha256HexOfFile(at: empty)
    #expect(e.bytes == 0 && e.sha256 == sha256Hex(Data()))
  }
}
