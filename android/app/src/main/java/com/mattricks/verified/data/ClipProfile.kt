package com.mattricks.verified.data

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * How a clip is encoded, from how long it may run (v4.14; the same tiers as web `clip.ts` and iOS `ClipProfile`).
 * The server's reviewer samples footage at <= 1 frame/s (far sparser past 2 min), so a long, still activity
 * (meditating, reading) loses nothing at a low frame rate and bitrate while the file shrinks ~10-30x. Time is not
 * sped up: a 30-minute clip plays for 30 minutes with continuous audio, so its duration and sound stay evidence.
 *   live  cap <= 5 min   camera rate, HD, 1.2 Mbit/s
 *   long  cap <= 20 min  5 fps target, SD, 350 kbit/s
 *   slow  cap <= 2 h     1 fps target, SD, 110 kbit/s
 * Android records straight to the encoder (CameraX), so `fps` picks the lowest sensor rate the camera offers
 * (often 10-15 fps); the bitrate is what bounds the file.
 */
data class ClipProfile(val tier: String, val fps: Int?, val maxEdge: Int, val videoBps: Int, val audioBps: Int) {
    companion object {
        val LIVE = ClipProfile("live", null, 1280, 1_200_000, 64_000)
        val LONG = ClipProfile("long", 5, 960, 350_000, 32_000)
        val SLOW = ClipProfile("slow", 1, 720, 110_000, 24_000)

        /** Phones always allowed 5 minutes (web keeps a 60 s default). */
        const val MIN_CAP_SECONDS = 300.0
        /** Two hours: a `slow` clip that long is ~120 MB, under the 200 MB upload limit. */
        const val MAX_CAP_SECONDS = 7200.0
        /** Stop a clip before the 200 MB upload limit (storage.rules) whatever the encoder does. */
        const val FILE_LIMIT_BYTES = 190L * 1024 * 1024

        fun forCap(seconds: Double): ClipProfile = when {
            seconds <= 300 -> LIVE
            seconds <= 1200 -> LONG
            else -> SLOW
        }

        /** The longest `video` requirement plus 5 % and 15 s, between 5 min and 2 h. */
        fun capSeconds(plan: Plan?): Double {
            val need = plan?.requirements.orEmpty().filter { it.evidence == "video" }
                .maxOfOrNull { ((it.minSeconds ?: 0.0) * 1.05 + 15).roundToLong().toDouble() } ?: 0.0
            return min(MAX_CAP_SECONDS, max(MIN_CAP_SECONDS, need))
        }

        /**
         * The sensor frame-rate range for a low-rate profile: the lowest maximum the camera supports (fixed ranges
         * first), or null to keep the default when nothing goes below 30 fps.
         */
        fun sensorRange(profile: ClipProfile, supported: List<Pair<Int, Int>>): Pair<Int, Int>? {
            if (profile.fps == null) return null
            val best = supported.filter { it.second >= profile.fps && it.first <= it.second }
                .minWithOrNull(compareBy<Pair<Int, Int>>({ it.second }, { it.second - it.first })) ?: return null
            return best.takeIf { it.second < 30 }
        }
    }
}
