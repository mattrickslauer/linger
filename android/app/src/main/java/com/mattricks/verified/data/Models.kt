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

/** moments/{id}.score: P(claim true | evidence) under the adversarial prior. */
data class Score(val probability: Double, val reasons: List<String>, val model: String) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): Score? = (m as? Map<String, Any?>)?.let {
            if (it["probability"] !is Number) return null
            Score(num(it["probability"]).coerceIn(0.0, 1.0), (it["reasons"] as? List<String>).orEmpty(), it["model"] as? String ?: "")
        }

        /** feed/{id}: verificationScore (number|null) + scoreReasons. */
        @Suppress("UNCHECKED_CAST")
        fun fromFeed(p: Any?, reasons: Any?): Score? =
            (p as? Number)?.let { Score(it.toDouble().coerceIn(0.0, 1.0), (reasons as? List<String>).orEmpty(), "") }
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
    val ownerUid: String = "",
    /** v3: server bar value (feed `bar` / moments `bar.value`), final score, number of ladder results. */
    val bar: Double? = null,
    val score: Double? = null,
    val ladderCount: Int = 0,
    val recordedAsGuest: Boolean = false,
    /** A guest Moment that lives only in this phone's journal (v3.1). */
    val local: Boolean = false,
    /** Client preview of the bar from the interview (never binding). */
    val previewBar: Double? = null,
    val witnessAsked: Int = 0,
)

/** [witnessAsk] is the witness request this frame answered (frame event `wid`), if any. */
data class Frame(val seq: Int, val t: Long, val jpegB64: String, val check: Check?, val witnessAsk: String? = null)

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
    val score: Score?,
    val seal: Seal?,
    val feedChecks: Map<String, Boolean>,
    val feedReason: String?,
    val judgeReasons: List<String>,
    val local: Boolean = false,
    val intention: Intention? = null,
    val bar: Bar? = null,
    val verification: Verification? = null,
    val witness: List<WitnessItem> = emptyList(),
    val sealVersion: Int = 0,
    val ladderEligible: Boolean = false,
    val ownerUid: String = "",
    /** `video` events in the chain (the clips stay on the phone that recorded them). */
    val videos: List<VideoRef> = emptyList(),
)

data class VideoRef(val sha256: String, val name: String, val bytes: Long, val durationMs: Long)

// ───────────────────────── v3 (docs/ARCHITECTURE.md v3.2–v3.8)

data class Quantity(val metric: String, val value: Double, val unit: String, val measuredBy: String) {
    fun toMap() = mapOf("metric" to metric, "value" to value, "unit" to unit, "measuredBy" to measuredBy)
}

data class Place(val name: String?, val lat: Double?, val lng: Double?, val region: String?, val country: String?) {
    fun toMap() = mapOf("name" to name, "lat" to lat, "lng" to lng, "region" to region, "country" to country)
    fun label(): String = listOfNotNull(name, region, country).filter { it.isNotBlank() }.distinct().joinToString(", ")
}

data class IntentionPreview(val bar: Double, val difficulty: Double, val mode: String, val rationale: String = "", val factors: List<String> = emptyList()) {
    fun toMap() = mapOf("bar" to bar, "difficulty" to difficulty, "mode" to mode)
}

/** moments/{id}.intention: v1 `{text, category}` or the v3 structured form (`v == 3`). */
data class Intention(
    val text: String,
    val category: String,
    val v: Int = 1,
    val activity: String = "",
    val goal: String = "",
    val quantities: List<Quantity> = emptyList(),
    val place: Place? = null,
    val expectedMinutes: Double? = null,
    val conditions: List<String> = emptyList(),
    val assumptions: List<String> = emptyList(),
    val interviewTurns: Int = 0,
    val interviewMode: String = "typed",
    val preview: IntentionPreview? = null,
) {
    val structured get() = v == 3

    /** Firestore map. [start] = window.start (the Moment's startedAt). */
    fun toMap(start: Long): Map<String, Any?> {
        val base = mutableMapOf<String, Any?>("text" to text.take(200), "category" to category)
        if (!structured) return base
        base += mapOf(
            "v" to 3,
            "activity" to activity.take(40),
            "goal" to goal.take(120),
            "quantities" to quantities.take(5).map { it.toMap() },
            "place" to place?.toMap(),
            "window" to mapOf("start" to start, "expectedMinutes" to expectedMinutes),
            "conditions" to conditions.take(6),
            "assumptions" to assumptions.take(6),
            "interview" to mapOf("turns" to interviewTurns, "mode" to interviewMode),
            "preview" to preview?.toMap(),
        )
        return base
    }

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Map<String, Any?>?): Intention? {
            if (m == null) return null
            fun strs(x: Any?) = (x as? List<Any?>).orEmpty().mapNotNull { it as? String }.filter { it.isNotBlank() }
            val place = (m["place"] as? Map<String, Any?>)?.let {
                fun s(k: String) = (it[k] as? String)?.takeIf { v -> v.isNotBlank() }
                Place(s("name"), (it["lat"] as? Number)?.toDouble(), (it["lng"] as? Number)?.toDouble(), s("region"), s("country"))
            }
            val interview = m["interview"] as? Map<String, Any?>
            val preview = (m["preview"] as? Map<String, Any?>)?.let {
                IntentionPreview(num(it["bar"]), num(it["difficulty"]), it["mode"] as? String ?: "cloud")
            }
            return Intention(
                text = m["text"] as? String ?: "", category = m["category"] as? String ?: "other",
                v = (m["v"] as? Number)?.toInt() ?: 1,
                activity = m["activity"] as? String ?: "", goal = m["goal"] as? String ?: "",
                quantities = (m["quantities"] as? List<Any?>).orEmpty().mapNotNull { q ->
                    (q as? Map<String, Any?>)?.let { Quantity(it["metric"] as? String ?: "", num(it["value"]), it["unit"] as? String ?: "", it["measuredBy"] as? String ?: "claim") }
                },
                place = place,
                expectedMinutes = ((m["window"] as? Map<String, Any?>)?.get("expectedMinutes") as? Number)?.toDouble(),
                conditions = strs(m["conditions"]), assumptions = strs(m["assumptions"]),
                interviewTurns = (interview?.get("turns") as? Number)?.toInt() ?: 0,
                interviewMode = interview?.get("mode") as? String ?: "typed",
                preview = preview,
            )
        }
    }
}

/** moments/{id}.bar (server-only, v3.3). */
data class Bar(val value: Double, val difficulty: Double, val rationale: String, val factors: List<String>, val source: String, val model: String?) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): Bar? = (m as? Map<String, Any?>)?.let {
            if (it["value"] !is Number) return null
            Bar(num(it["value"]), num(it["difficulty"]), it["rationale"] as? String ?: "", (it["factors"] as? List<String>).orEmpty(), it["source"] as? String ?: "ai", it["model"] as? String)
        }

        fun fromFeed(f: Map<String, Any?>): Bar? = (f["bar"] as? Number)?.let {
            Bar(it.toDouble(), num(f["difficulty"]), f["barRationale"] as? String ?: "", emptyList(), "ai", null)
        }
    }
}

data class Measured(val metric: String, val value: Double, val unit: String)

/** One entry of verification.modules (v3.5) or feed.ladder (v3.8, fewer fields). */
data class LadderResult(
    val runId: String, val module: String, val title: String, val cost: Int, val strength: Double,
    val passed: Boolean, val confidence: Double, val before: Double, val after: Double,
    val reasons: List<String>, val measured: List<Measured>,
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Map<String, Any?>) = LadderResult(
            runId = m["runId"] as? String ?: "", module = m["module"] as? String ?: "", title = m["title"] as? String ?: "",
            cost = num(m["cost"]).toInt(), strength = num(m["strength"]), passed = m["passed"] == true, confidence = num(m["confidence"]),
            before = num(m["before"]), after = num(m["after"]), reasons = (m["reasons"] as? List<String>).orEmpty(),
            measured = (m["measured"] as? List<Any?>).orEmpty().mapNotNull { x ->
                (x as? Map<String, Any?>)?.let { Measured(it["metric"] as? String ?: "", num(it["value"]), it["unit"] as? String ?: "") }
            },
        )
    }
}

/** moments/{id}.verification (server-only, v3.5). */
data class Verification(val baseline: Double?, val score: Double?, val bar: Double, val verified: Boolean, val modules: List<LadderResult>) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): Verification? = (m as? Map<String, Any?>)?.let {
            Verification(
                (it["baseline"] as? Number)?.toDouble(), (it["score"] as? Number)?.toDouble(), num(it["bar"]), it["verified"] == true,
                (it["modules"] as? List<Any?>).orEmpty().mapNotNull { x -> (x as? Map<String, Any?>)?.let(LadderResult::from) },
            )
        }

        @Suppress("UNCHECKED_CAST")
        fun fromFeed(f: Map<String, Any?>): Verification? {
            val bar = (f["bar"] as? Number)?.toDouble() ?: return null
            val score = (f["verificationScore"] as? Number)?.toDouble()
            return Verification(
                (f["baselineScore"] as? Number)?.toDouble(), score, bar, f["status"] == "sealed",
                (f["ladder"] as? List<Any?>).orEmpty().mapNotNull { x -> (x as? Map<String, Any?>)?.let(LadderResult::from) },
            )
        }
    }
}

/** A witness request read back from the chain (v3.4) with its outcome: "frame"|"voice"|"text"|"done"|"skipped"|null (open). */
data class WitnessItem(
    val wid: String, val ask: String, val kind: String, val by: String, val t: Long,
    val outcome: String? = null, val answer: String? = null, val answerSeq: Int? = null,
)
