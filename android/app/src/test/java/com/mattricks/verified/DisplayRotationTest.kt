package com.mattricks.verified

import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Summary
import com.mattricks.verified.data.normalizeDisplayRotation
import com.mattricks.verified.ui.rotatedSize
import org.junit.Assert.assertEquals
import org.junit.Test

class DisplayRotationTest {
    @Test fun validValuesPassThrough() {
        assertEquals(0, normalizeDisplayRotation(0))
        assertEquals(90, normalizeDisplayRotation(90))
        assertEquals(180, normalizeDisplayRotation(180L))
        assertEquals(270, normalizeDisplayRotation(270.0))
    }

    @Test fun missingOrInvalidIsZero() {
        assertEquals(0, normalizeDisplayRotation(null))
        assertEquals(0, normalizeDisplayRotation("270"))
        assertEquals(0, normalizeDisplayRotation(45))
        assertEquals(0, normalizeDisplayRotation(270.5))
        assertEquals(0, normalizeDisplayRotation(Double.NaN))
        assertEquals(0, normalizeDisplayRotation(Double.POSITIVE_INFINITY))
        assertEquals(0, normalizeDisplayRotation(true))
    }

    @Test fun wholeTurnsWrap() {
        assertEquals(270, normalizeDisplayRotation(-90))
        assertEquals(0, normalizeDisplayRotation(360))
        assertEquals(90, normalizeDisplayRotation(450))
    }

    @Test fun quarterTurnsSwapSides() {
        assertEquals(640 to 480, rotatedSize(640, 480, 0))
        assertEquals(480 to 640, rotatedSize(640, 480, 90))
        assertEquals(640 to 480, rotatedSize(640, 480, 180))
        assertEquals(480 to 640, rotatedSize(640, 480, 270))
    }

    @Test fun cardDefaultsToUpright() {
        val c = MomentCard(
            id = "m", ownerName = "", intention = "", category = "other", platform = "ios", status = "sealed",
            summary = Summary.from(null), onDeviceMode = "none", heroJpegB64 = null,
        )
        assertEquals(0, c.displayRotation)
    }
}
