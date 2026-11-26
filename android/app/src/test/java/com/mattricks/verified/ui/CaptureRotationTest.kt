package com.mattricks.verified.ui

import android.view.Surface
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Sensor angle → capture targetRotation (CameraX's 45° buckets), so a sideways-held phone saves landscape. */
class CaptureRotationTest {
    @Test fun buckets() {
        assertNull(surfaceRotationFor(-1)) // ORIENTATION_UNKNOWN: keep the last rotation
        for (a in listOf(0, 44, 315, 359)) assertEquals(Surface.ROTATION_0, surfaceRotationFor(a))
        for (a in listOf(45, 90, 134)) assertEquals(Surface.ROTATION_270, surfaceRotationFor(a))
        for (a in listOf(135, 180, 224)) assertEquals(Surface.ROTATION_180, surfaceRotationFor(a))
        for (a in listOf(225, 270, 314)) assertEquals(Surface.ROTATION_90, surfaceRotationFor(a))
    }
}
