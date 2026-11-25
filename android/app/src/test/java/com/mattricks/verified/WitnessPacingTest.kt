package com.mattricks.verified

import com.mattricks.verified.witness.WitnessPacing
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WitnessPacingTest {
    private val t0 = 1_000_000L

    @Test fun notBefore30s() {
        assertFalse(WitnessPacing.canAsk(t0 + 29_999, t0, 0, 0, false))
        assertTrue(WitnessPacing.canAsk(t0 + 30_000, t0, 0, 0, false))
    }

    @Test fun oneOpenAtATime() = assertFalse(WitnessPacing.canAsk(t0 + 300_000, t0, 0, 1, open = true))

    @Test fun sixtySecondsBetween() {
        val last = t0 + 40_000
        assertFalse(WitnessPacing.canAsk(last + 59_999, t0, last, 1, false))
        assertTrue(WitnessPacing.canAsk(last + 60_000, t0, last, 1, false))
    }

    @Test fun atMostSix() = assertFalse(WitnessPacing.canAsk(t0 + 9_000_000, t0, t0, 6, false))

    @Test fun gainThreshold() {
        assertFalse(WitnessPacing.worthShowing("", 0.9))
        assertFalse(WitnessPacing.worthShowing("Show the fish", 0.09))
        assertTrue(WitnessPacing.worthShowing("Show the fish", 0.1))
    }
}
