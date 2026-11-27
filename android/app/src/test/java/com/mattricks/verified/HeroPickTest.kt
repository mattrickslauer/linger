package com.mattricks.verified

import com.mattricks.verified.data.HeroCache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HeroPickTest {
    private fun chunk(seq: Int, jpeg: String?, ok: Boolean?) = mapOf(
        "seq" to seq,
        "payload" to (if (ok == null) "{}" else """{"check":{"ok":$ok}}"""),
        "frame" to jpeg?.let { mapOf("jpegB64" to it) },
    )

    @Test fun lastCoachPassedFrameWins() =
        assertEquals("B", HeroCache.pick(listOf(chunk(0, "A", true), chunk(2, "C", false), chunk(1, "B", true))))

    @Test fun fallsBackToLastFrame() =
        assertEquals("C", HeroCache.pick(listOf(chunk(0, "A", false), chunk(1, null, true), chunk(2, "C", null))))

    @Test fun noFramesIsNull() = assertNull(HeroCache.pick(listOf(chunk(0, null, true), chunk(1, "", true))))
}
