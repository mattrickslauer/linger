package com.mattricks.verified.record

import com.mattricks.verified.data.LatLng
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object Geo {
    /** Great-circle distance in meters. */
    fun haversine(a: LatLng, b: LatLng): Double {
        val r = 6_371_000.0
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val h = sin(dLat / 2).let { it * it } +
            cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLng / 2).let { it * it }
        return 2 * r * atan2(sqrt(h), sqrt(1 - h))
    }

    fun pathLength(pts: List<LatLng>): Double = pts.zipWithNext().sumOf { (a, b) -> haversine(a, b) }

    fun round(v: Double, dp: Int): Double {
        val f = Math.pow(10.0, dp.toDouble())
        return Math.round(v * f) / f
    }
}
