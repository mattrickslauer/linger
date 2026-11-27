import Testing
@testable import VerifiedCore

@Suite struct CaptureRotationTests {
  @Test func uprightPortraitIs90() {
    #expect(captureRotationAngle(gravityX: 0, y: -1, z: 0, prev: 0) == 90)
    // Slightly reclined, as people hold a phone to shoot.
    #expect(captureRotationAngle(gravityX: 0.05, y: -0.8, z: -0.55, prev: 0) == 90)
  }

  @Test func landscapes() {
    #expect(captureRotationAngle(gravityX: -1, y: 0, z: 0) == 0) // top turned left
    #expect(captureRotationAngle(gravityX: 1, y: 0, z: 0) == 180) // top turned right
    #expect(captureRotationAngle(gravityX: 0, y: 1, z: 0) == 270) // upside down
  }

  @Test func flatKeepsPrevious() {
    #expect(captureRotationAngle(gravityX: 0, y: 0, z: -1, prev: 180) == 180)
    #expect(captureRotationAngle(gravityX: 0, y: 0, z: -1) == 90)
  }

  @Test func diagonalHysteresis() {
    // 45° between portrait and top-right: stays where it was.
    let s = 0.7071
    #expect(captureRotationAngle(gravityX: s, y: -s, z: 0, prev: 90) == 90)
    #expect(captureRotationAngle(gravityX: s, y: -s, z: 0, prev: 180) == 180)
  }
}
