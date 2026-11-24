package com.mattricks.verified.data

import com.mattricks.verified.chain.Check

val CATEGORIES = listOf("fishing", "fitness", "outdoors", "making", "other")

data class LatLng(val lat: Double, val lng: Double)

data class Summary(
    val durationMs: Long = 0,
    val distanceM: Double = 0.0,
    val frameCount: Int = 0,
    val gpsCount: Int = 0,
    val motionCount: Int = 0,
    val start: LatLng? = null,
    val end: LatLng? = null,
    val heroFrameSeq: Int? = null,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "durationMs" to durationMs, "distanceM" to distanceM, "frameCount" to frameCount,
        "gpsCount" to gpsCount, "motionCount" to motionCount,
        "start" to start?.let { mapOf("lat" to it.lat, "lng" to it.lng) },
        "end" to end?.let { mapOf("lat" to it.lat, "lng" to it.lng) },
        "heroFrameSeq" to heroFrameSeq,
    )

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Map<String, Any?>?): Summary {
            if (m == null) return Summary()
            fun ll(x: Any?) = (x as? Map<String, Any?>)?.let { LatLng(num(it["lat"]), num(it["lng"])) }
            return Summary(
                durationMs = num(m["durationMs"]).toLong(), distanceM = num(m["distanceM"]),
                frameCount = num(m["frameCount"]).toInt(), gpsCount = num(m["gpsCount"]).toInt(),
                motionCount = num(m["motionCount"]).toInt(), start = ll(m["start"]), end = ll(m["end"]),
                heroFrameSeq = (m["heroFrameSeq"] as? Number)?.toInt(),
            )
        }
    }
}

fun num(x: Any?): Double = (x as? Number)?.toDouble() ?: 0.0

data class Opinion(val verdict: String, val confidence: Double, val reasons: List<String>, val model: String) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): Opinion? = (m as? Map<String, Any?>)?.let {
            Opinion(it["verdict"] as? String ?: "uncertain", num(it["confidence"]), (it["reasons"] as? List<String>).orEmpty(), it["model"] as? String ?: "")
        }
    }
}

data class Seal(val sealed: Boolean, val checks: Map<String, Boolean>, val reason: String) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): Seal? = (m as? Map<String, Any?>)?.let {
            Seal(it["sealed"] == true, (it["checks"] as? Map<String, Any?>).orEmpty().mapValues { e -> e.value == true }, it["reason"] as? String ?: "")
        }
    }
}

/** A card in the Feed (from feed/{id}) or Me (from moments/{id}). */
data class MomentCard(
    val id: String,
    val ownerName: String,
    val intention: String,
    val category: String,
    val platform: String,
    val status: String,
    val summary: Summary,
    val onDeviceMode: String,
    val heroJpegB64: String?,
    val startedAt: Long = 0,
    val pendingWrites: Boolean = false,
)

data class Frame(val seq: Int, val t: Long, val jpegB64: String, val check: Check?)

/** Everything the detail screen draws, rebuilt from moments/{id} + chunks. */
data class MomentDetail(
    val card: MomentCard,
    val startedAt: Long,
    val endedAt: Long?,
    val track: List<LatLng>,
    val motion: List<Pair<Long, Float>>, // t, |accel| m/s^2
    val frames: List<Frame>,
    val chunkCount: Int,
    val chainOk: Boolean?,
    val judge: Opinion?,
    val skeptic: Opinion?,
    val seal: Seal?,
    val feedChecks: Map<String, Boolean>,
    val feedReason: String?,
    val judgeReasons: List<String>,
)
