package com.mattricks.verified.data

import kotlin.math.roundToLong

/** Pure v3 math shared with every platform (docs/ARCHITECTURE.md v3.3, v3.6; vectors in shared/test-vectors-v3.json). */
object V3Math {
    fun clamp01(x: Double) = if (x.isNaN()) 0.0 else x.coerceIn(0.0, 1.0)

    /** JS Math.round(x*100)/100 (rounds .5 up, also for negatives). */
    fun round2(x: Double): Double = Math.floor(x * 100 + 0.5) / 100

    /** bar = round2(0.5 + 0.45 * clamp01(difficulty)). */
    fun bar(difficulty: Double): Double = round2(0.5 + 0.45 * clamp01(difficulty))

    /** Pass: p + s(1 - p). */
    fun pass(p: Double, s: Double) = p + s * (1 - p)

    /** Fail: p(1 - s). */
    fun fail(p: Double, s: Double) = p * (1 - s)

    fun step(p: Double, s: Double, passed: Boolean) = if (passed) pass(p, s) else fail(p, s)

    /** Display: 0.7872 → "0.79". */
    fun fmt(x: Double): String = String.format(java.util.Locale.US, "%.2f", (x * 100).roundToLong() / 100.0)
}
