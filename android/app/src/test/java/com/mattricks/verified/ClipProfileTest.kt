package com.mattricks.verified

import com.mattricks.verified.data.ClipProfile
import com.mattricks.verified.data.Plan
import com.mattricks.verified.data.Requirement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ClipProfileTest {
    private fun plan(vararg secs: Double) =
        Plan(secs.mapIndexed { i, s -> Requirement("r${i + 1}", "c1", "video", "", s) }, "video", "")

    @Test fun capFollowsTheLongestVideoRequirement() {
        assertEquals(300.0, ClipProfile.capSeconds(null), 0.0)
        assertEquals(300.0, ClipProfile.capSeconds(plan(120.0)), 0.0)
        assertEquals(1905.0, ClipProfile.capSeconds(plan(1800.0)), 0.0) // meditate for 30 minutes
        assertEquals(7200.0, ClipProfile.capSeconds(plan(5 * 3600.0)), 0.0)
    }

    @Test fun longerClipsGetLowerRates() {
        assertEquals(ClipProfile.LIVE, ClipProfile.forCap(300.0))
        assertEquals(ClipProfile.LONG, ClipProfile.forCap(720.0))
        assertEquals(ClipProfile.SLOW, ClipProfile.forCap(1905.0))
    }

    @Test fun sensorRangePicksTheLowestSupportedRate() {
        val ranges = listOf(15 to 30, 30 to 30, 7 to 15, 15 to 15, 24 to 24)
        assertEquals(15 to 15, ClipProfile.sensorRange(ClipProfile.SLOW, ranges))
        assertNull(ClipProfile.sensorRange(ClipProfile.LIVE, ranges))
        assertNull(ClipProfile.sensorRange(ClipProfile.SLOW, listOf(15 to 30, 30 to 30)))
    }
}
