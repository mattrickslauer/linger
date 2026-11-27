import Foundation
import Testing
@testable import VerifiedCore

@Suite struct DisplayRotationTests {
  @Test func validQuarterTurns() {
    #expect(normalizeDisplayRotation(0) == 0)
    #expect(normalizeDisplayRotation(90) == 90)
    #expect(normalizeDisplayRotation(180) == 180)
    #expect(normalizeDisplayRotation(270) == 270)
    #expect(normalizeDisplayRotation(270.0) == 270)
    #expect(normalizeDisplayRotation(NSNumber(value: 270)) == 270)
    #expect(normalizeDisplayRotation(Int64(90)) == 90)
  }

  @Test func wraps() {
    #expect(normalizeDisplayRotation(360) == 0)
    #expect(normalizeDisplayRotation(450) == 90)
    #expect(normalizeDisplayRotation(-90) == 270)
  }

  @Test func invalidIsZero() {
    #expect(normalizeDisplayRotation(nil) == 0)
    #expect(normalizeDisplayRotation(45) == 0)
    #expect(normalizeDisplayRotation(89.5) == 0)
    #expect(normalizeDisplayRotation(Double.nan) == 0)
    #expect(normalizeDisplayRotation(Double.infinity) == 0)
    #expect(normalizeDisplayRotation("270") == 0)
    #expect(normalizeDisplayRotation(true) == 0)
    #expect(normalizeDisplayRotation(["x": 90]) == 0)
  }

  @Test func rotatedSize() {
    let landscape = displayRotatedSize(width: 640, height: 480, rotation: 0)
    #expect(landscape.width == 640 && landscape.height == 480)
    let flipped = displayRotatedSize(width: 640, height: 480, rotation: 180)
    #expect(flipped.width == 640 && flipped.height == 480)
    let quarter = displayRotatedSize(width: 640, height: 480, rotation: 90)
    #expect(quarter.width == 480 && quarter.height == 640)
    let threeQuarter = displayRotatedSize(width: 640, height: 480, rotation: 270)
    #expect(threeQuarter.width == 480 && threeQuarter.height == 640)
  }
}
