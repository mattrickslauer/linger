package com.mattricks.verified

import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Summary
import com.mattricks.verified.data.normalizeDisplayRotation
import com.mattricks.verified.ui.orientedAspect
import com.mattricks.verified.ui.rotatedSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    @Test fun clipAspectIsOrientedThenTurned() {
        // ExoPlayer has applied the container's -90 matrix: a 1080x1920 iPhone clip reports 1920x1080 (sideways landscape).
        assertEquals(1920f / 1080f, orientedAspect(1920, 1080, 0, 1f, 0)!!, 1e-4f)
        // displayRotation 270 on top makes it upright portrait.
        assertEquals(1080f / 1920f, orientedAspect(1920, 1080, 0, 1f, 270)!!, 1e-4f)
        // A rotation the renderer left to the view counts too; a half turn keeps the aspect.
        assertEquals(1080f / 1920f, orientedAspect(1920, 1080, 90, 1f, 0)!!, 1e-4f)
        assertEquals(1920f / 1080f, orientedAspect(1920, 1080, 90, 1f, 90)!!, 1e-4f)
        assertEquals(16f / 9f, orientedAspect(1280, 720, 0, 1f, 180)!!, 1e-4f)
        // Anamorphic pixels widen the frame.
        assertEquals(2f, orientedAspect(1000, 1000, 0, 2f, 0)!!, 1e-4f)
        assertNull(orientedAspect(0, 0, 0, 1f, 90))
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
