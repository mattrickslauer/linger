package com.mattricks.verified.data

import org.json.JSONArray
import org.json.JSONObject

// ───────────────────────── v4 (docs/ARCHITECTURE.md v4.1–v4.8): claims, evidence plan, video review, per-claim scores

val CLAIM_KINDS = listOf("action", "count", "measure", "place", "time", "object", "outcome")
val EVIDENCE = listOf("video", "frames", "gps", "motion", "witness")

/** One checkable part of the intention (v4.1). metric/value/unit only on count/measure with value > 0. */
data class Claim(val id: String, val kind: String, val text: String, val metric: String? = null, val value: Double? = null, val unit: String? = null) {
    val quantified get() = (kind == "count" || kind == "measure") && (value ?: 0.0) > 0

    fun toMap(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("id" to id, "kind" to kind, "text" to text)
        if (quantified) { m["metric"] = metric.orEmpty(); m["value"] = value; m["unit"] = unit.orEmpty() }
        return m
    }

    fun toJson(): JSONObject = JSONObject(toMap())

    companion object {
        fun from(m: Map<*, *>): Claim = Claim(
            m["id"] as? String ?: "", m["kind"] as? String ?: "", m["text"] as? String ?: "",
            m["metric"] as? String, (m["value"] as? Number)?.toDouble(), m["unit"] as? String,
        )

        fun fromJson(j: JSONObject): Claim = Claim(
            j.optString("id"), j.optString("kind"), j.optString("text"),
            j.optString("metric").takeIf { it.isNotEmpty() }, j.optDouble("value", 0.0).takeIf { !it.isNaN() }, j.optString("unit").takeIf { it.isNotEmpty() },
        )
    }
}

/** Minimum evidence for one claim (v4.2). minSeconds only on video/motion, > 0. */
data class Requirement(val id: String, val claimId: String, val evidence: String, val ask: String, val minSeconds: Double? = null) {
    fun toMap(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("id" to id, "claimId" to claimId, "evidence" to evidence, "ask" to ask)
        minSeconds?.let { m["minSeconds"] = it }
        return m
    }

    /** Short form the witness prompt gets for `{{unmet}}`. */
    fun toJson(): JSONObject = JSONObject().put("id", id).put("claimId", claimId).put("evidence", evidence).put("ask", ask)

    companion object {
        fun from(m: Map<*, *>): Requirement = Requirement(
            m["id"] as? String ?: "", m["claimId"] as? String ?: "", m["evidence"] as? String ?: "", m["ask"] as? String ?: "",
            (m["minSeconds"] as? Number)?.toDouble(),
        )

        fun fromJson(j: JSONObject): Requirement = Requirement(
            j.optString("id"), j.optString("claimId"), j.optString("evidence"), j.optString("ask"),
            j.optDouble("minSeconds", 0.0).takeIf { !it.isNaN() },
        )
    }
}

data class Plan(val requirements: List<Requirement>, val recordMode: String, val note: String, val source: String? = null) {
    fun toMap(): Map<String, Any?> = mapOf("requirements" to requirements.map { it.toMap() }, "recordMode" to recordMode, "note" to note)
    fun toJson(): JSONObject = JSONObject().put("requirements", JSONArray(requirements.map { JSONObject(it.toMap()) })).put("recordMode", recordMode).put("note", note)

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): Plan? = (m as? Map<String, Any?>)?.let {
            Plan(
                (it["requirements"] as? List<Any?>).orEmpty().mapNotNull { r -> (r as? Map<*, *>)?.let(Requirement::from) },
                it["recordMode"] as? String ?: "photo", it["note"] as? String ?: "", it["source"] as? String,
            )
        }
    }
}

/** Server-only moments/{id}.claims (v4.3). */
data class ServerClaims(val items: List<Claim>, val source: String, val model: String?) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): ServerClaims? = (m as? Map<String, Any?>)?.let {
            ServerClaims((it["items"] as? List<Any?>).orEmpty().mapNotNull { c -> (c as? Map<*, *>)?.let(Claim::from) }, it["source"] as? String ?: "ai", it["model"] as? String)
        }
    }
}

/** A per-claim verdict from the frames judge, the video review or a ladder module. */
data class ClaimVerdict(
    val id: String, val verdict: String, val confidence: Double, val reasons: List<String> = emptyList(),
    val measured: Pair<Double, String>? = null, val passed: Boolean? = null, val before: Double? = null, val after: Double? = null,
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Map<*, *>): ClaimVerdict = ClaimVerdict(
            m["id"] as? String ?: "", m["verdict"] as? String ?: "missing", num(m["confidence"]),
            (m["reasons"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
            (m["measured"] as? Map<String, Any?>)?.let { num(it["value"]) to (it["unit"] as? String ?: "") },
            m["passed"] as? Boolean, (m["before"] as? Number)?.toDouble(), (m["after"] as? Number)?.toDouble(),
        )

        @Suppress("UNCHECKED_CAST")
        fun list(x: Any?): List<ClaimVerdict> = (x as? List<Any?>).orEmpty().mapNotNull { (it as? Map<*, *>)?.let(::from) }
    }
}

/** Server-only moments/{id}.videoReview (v4.4). */
data class VideoReview(
    val status: String, val clips: List<Clip>, val claims: List<ClaimVerdict>, val cheatingDetected: Boolean,
    val signals: List<String>, val summary: String, val reason: String?, val model: String?,
) {
    data class Clip(val sha256: String, val durationMs: Long, val uploaded: Boolean, val hashOk: Boolean?)

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Any?): VideoReview? = (m as? Map<String, Any?>)?.let {
            val ch = it["cheating"] as? Map<String, Any?>
            VideoReview(
                it["status"] as? String ?: "waiting",
                (it["clips"] as? List<Any?>).orEmpty().mapNotNull { c ->
                    (c as? Map<String, Any?>)?.let { x -> Clip(x["sha256"] as? String ?: "", num(x["durationMs"]).toLong(), x["uploaded"] == true, x["hashOk"] as? Boolean) }
                },
                ClaimVerdict.list(it["claims"]), ch?.get("detected") == true,
                (ch?.get("signals") as? List<Any?>).orEmpty().mapNotNull { s -> s as? String },
                it["summary"] as? String ?: "", it["reason"] as? String, it["model"] as? String,
            )
        }
    }
}

/** verification.claims[] (v4.5/v4.6); from the feed only id/p/backedBy/met count are known. */
data class ClaimScore(
    val id: String, val p: Double, val sealP: Double, val met: List<String>, val unmet: List<String>,
    val minimumMet: Boolean, val backedBy: List<String>,
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Map<*, *>): ClaimScore = ClaimScore(
            m["id"] as? String ?: "", num(m["p"]), (m["sealP"] as? Number)?.toDouble() ?: num(m["p"]),
            (m["met"] as? List<Any?>).orEmpty().mapNotNull { it as? String }, (m["unmet"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
            m["minimumMet"] == true, (m["backedBy"] as? List<Any?>).orEmpty().mapNotNull { it as? String },
        )
    }
}

/** The v4 parts of a Moment the detail screen shows (server claims, plan, video review, per-claim scores). */
data class V4Detail(
    val claims: List<Claim>,
    val plan: Plan?,
    val videoReview: VideoReview?,
    val claimScores: List<ClaimScore>,
    val claimsBacked: Int?,
    val cheatingDetected: Boolean,
    val cheatingSignals: List<String>,
    /** feed-only: requirement id → met (the moment doc gives met/unmet per claim instead). */
    val feedMet: Map<String, Boolean> = emptyMap(),
    val videoSummary: String? = null,
)

// ───────────────────────── normalization (v4.1, v4.2) — client side, no server defaults

object V4Norm {
    /** Claims: trim, cut to 80, drop unknown kind / empty text, keep 5, renumber c1..cN; plan claimIds remapped. */
    fun normalize(claims: List<Claim>, plan: Plan?): Pair<List<Claim>, Plan?> {
        val remap = HashMap<String, String>()
        val out = ArrayList<Claim>()
        for (c in claims) {
            if (out.size >= 5) break
            val text = c.text.trim().take(80)
            if (c.kind !in CLAIM_KINDS || text.isEmpty()) continue
            val id = "c${out.size + 1}"
            if (c.id !in remap) remap[c.id] = id
            val q = (c.kind == "count" || c.kind == "measure") && (c.value ?: 0.0) > 0
            out += Claim(id, c.kind, text, if (q) c.metric?.trim().orEmpty() else null, if (q) c.value else null, if (q) c.unit?.trim().orEmpty() else null)
        }
        val p = plan ?: return out to null
        val reqs = ArrayList<Requirement>()
        for (r in p.requirements) {
            if (reqs.size >= 6) break
            val cid = remap[r.claimId] ?: continue
            if (r.evidence !in EVIDENCE) continue
            val min = r.minSeconds?.takeIf { it > 0 && (r.evidence == "video" || r.evidence == "motion") }
            reqs += Requirement("r${reqs.size + 1}", cid, r.evidence, r.ask.trim().take(120), min)
        }
        val mode = if (reqs.any { it.evidence == "video" }) "video" else "photo"
        return out to Plan(reqs, mode, p.note.trim().take(160))
    }

    /** From a model reply (`claims` array + `plan` object, the shared prompt schema). */
    fun fromModel(j: JSONObject): Pair<List<Claim>, Plan?> {
        val a = j.optJSONArray("claims")
        val claims = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(Claim::fromJson) }
        val pj = j.optJSONObject("plan")
        val plan = pj?.let { p ->
            val ra = p.optJSONArray("requirements")
            Plan(
                if (ra == null) emptyList() else (0 until ra.length()).mapNotNull { ra.optJSONObject(it)?.let(Requirement::fromJson) },
                p.optString("recordMode"), p.optString("note"),
            )
        }
        return normalize(claims, plan)
    }

    /** Drop one claim (tap to remove on the interview card): its requirements go too, ids renumber. */
    fun without(claims: List<Claim>, plan: Plan?, id: String): Pair<List<Claim>, Plan?> =
        normalize(claims.filter { it.id != id }, plan?.let { p -> p.copy(requirements = p.requirements.filter { it.claimId != id }) })
}

// ───────────────────────── record-screen checklist ("captured", never "verified"; v4.2)

object Checklist {
    const val GPS_MAX_ACCURACY_M = 100.0
    const val DEFAULT_MOTION_SECONDS = 10.0

    /** What this phone has captured so far. [clipsMs] finished clip durations; [answeredRids] rid of each answered witness request ("" = none). */
    data class Facts(val clipsMs: List<Long>, val frames: Int, val goodFixes: Int, val motionSeconds: Double, val answeredRids: List<String>)

    fun captured(r: Requirement, f: Facts): Boolean = when (r.evidence) {
        "video" -> f.clipsMs.any { it > 0 && it >= (r.minSeconds ?: 0.0) * 1000 }
        "frames" -> f.frames >= 1
        "gps" -> f.goodFixes >= 1
        "motion" -> f.motionSeconds >= (r.minSeconds?.takeIf { it > 0 } ?: DEFAULT_MOTION_SECONDS)
        "witness" -> f.answeredRids.any { it == r.id }
        else -> false
    }

    /** Requirements not captured yet, for the witness prompt (`{{unmet}}`), in plan order. */
    fun unmet(plan: Plan?, f: Facts): List<Requirement> = plan?.requirements.orEmpty().filter { !captured(it, f) }
}

// ───────────────────────── v4.5 scoring, a port of shared/make-test-vectors-v4.mjs `scoreV4` (the reference)

object V4Score {
    const val DEFAULT_BASELINE = 0.2
    const val CHEATING_CAP = 0.1
    const val BACKED_CONFIDENCE = 0.6
    const val DEFAULT_MOTION_SECONDS = 10.0
    const val MAX_SIGNALS = 6

    data class Verdict(val id: String, val verdict: String?, val confidence: Double?)
    data class ClipFact(val durationMs: Long, val uploaded: Boolean, val hashOk: Boolean?)
    data class WitnessFact(val rid: String?, val answered: Boolean)
    data class Integrity(val chain: Boolean, val timing: Boolean, val physics: Boolean, val frames: Boolean)
    data class Facts(val integrity: Integrity, val frameCount: Int, val gpsFixes: Int, val motionSeconds: Double, val clips: List<ClipFact>, val witness: List<WitnessFact>)
    data class Judge(val verdict: String, val confidence: Double, val claims: List<Verdict>?)
    data class Skeptic(val verdict: String, val reasons: List<String>)
    data class Video(val status: String, val claims: List<Verdict>, val cheatingDetected: Boolean, val signals: List<String>)
    data class Module(val module: String, val strength: Double, val backs: List<String>, val claims: List<Verdict>, val targetedOnly: Boolean = false)
    data class Input(
        val bar: Double, val baseline: Double?, val claims: List<Claim>, val requirements: List<Requirement>, val facts: Facts,
        val judge: Judge?, val skeptic: Skeptic?, val videoReview: Video?, val ladder: List<Module> = emptyList(),
    )

    data class Moved(val id: String, val passed: Boolean, val before: Double, val after: Double)
    data class ModuleOut(val module: String, val before: Double, val after: Double, val passed: Boolean, val claims: List<Moved>)
    data class Out(
        val baselineUsed: Double, val cheatingDetected: Boolean, val signals: List<String>, val claims: List<ClaimScore>,
        val ladder: List<ModuleOut>, val score: Double, val checks: Map<String, Boolean>, val sealed: Boolean,
        val ladderEligible: Boolean, val claimsBacked: Int,
    )

    fun backs(v: Verdict?): Boolean = v != null && v.verdict == "backed" && v.confidence != null && v.confidence >= BACKED_CONFIDENCE

    private fun framesBack(i: Input, id: String): Boolean {
        val j = i.judge ?: return false
        if (i.facts.frameCount < 1) return false
        if (!j.claims.isNullOrEmpty()) return backs(j.claims.firstOrNull { it.id == id })
        return j.verdict == "consistent" && j.confidence >= BACKED_CONFIDENCE
    }

    private fun videoBacks(i: Input, id: String): Boolean {
        val r = i.videoReview ?: return false
        if (r.status != "done") return false
        if (i.facts.clips.none { it.uploaded && it.hashOk == true }) return false
        return backs(r.claims.firstOrNull { it.id == id })
    }

    private fun met(i: Input, r: Requirement): Boolean {
        val f = i.facts
        return when (r.evidence) {
            "video" -> {
                val min = (r.minSeconds ?: 0.0) * 1000
                f.clips.any { it.uploaded && it.hashOk == true && it.durationMs > 0 && it.durationMs >= min } && videoBacks(i, r.claimId)
            }
            "frames" -> framesBack(i, r.claimId)
            "gps" -> f.gpsFixes >= 1
            "motion" -> f.motionSeconds >= (r.minSeconds?.takeIf { it != 0.0 } ?: DEFAULT_MOTION_SECONDS)
            "witness" -> f.witness.any { it.answered && (it.rid == r.id || it.rid == null) }
            else -> false
        }
    }

    fun cheating(i: Input): List<String> {
        val s = ArrayList<String>()
        val g = i.facts.integrity
        if (!g.chain) s += "chain: hashes do not link"
        if (!g.timing) s += "timing: clock does not add up"
        if (!g.physics) s += "physics: impossible movement"
        if (i.skeptic?.verdict == "inconsistent") s += "skeptic: " + (i.skeptic.reasons.firstOrNull() ?: "fake signal")
        if (i.facts.clips.any { it.uploaded && it.hashOk == false }) s += "video: clip does not match the chain"
        val v = i.videoReview?.takeIf { it.status == "done" }
        if (v != null && v.cheatingDetected) {
            if (v.signals.isNotEmpty()) v.signals.forEach { s += "video: $it" } else s += "video: cheating detected"
        }
        return s.take(MAX_SIGNALS)
    }

    /** Claim ids a module moves: kind in backs; targetedOnly (witness_review) only claims an answered request targeted. */
    fun claimsBackedByModule(claims: List<Claim>, requirements: List<Requirement>, witness: List<WitnessFact>, backs: List<String>, targetedOnly: Boolean): List<String> {
        var ids = claims.filter { it.kind in backs }.map { it.id }
        if (targetedOnly) {
            val answered = witness.filter { it.answered }
            if (answered.none { it.rid == null }) {
                val targeted = requirements.filter { r -> answered.any { it.rid == r.id } }.map { it.claimId }.toSet()
                ids = ids.filter { it in targeted }
            }
        }
        return ids
    }

    fun score(i: Input): Out {
        val bar = i.bar
        val baseline = i.baseline?.let { V3Math.clamp01(it) } ?: DEFAULT_BASELINE
        val signals = cheating(i)
        val cheat = signals.isNotEmpty()

        class C(val id: String, val met: List<String>, val unmet: List<String>, val minimumMet: Boolean, val backedBy: MutableList<String>, val sealP: Double, var p: Double)
        val cs = i.claims.map { c ->
            val reqs = i.requirements.filter { it.claimId == c.id }
            val met = reqs.filter { met(i, it) }.map { it.id }
            val unmet = reqs.map { it.id }.filter { it !in met }
            val backedBy = ArrayList<String>()
            if (videoBacks(i, c.id)) backedBy += "video_review"
            if (framesBack(i, c.id)) backedBy += "frames_judge"
            for (ev in listOf("gps", "motion", "witness")) if (reqs.any { it.evidence == ev && it.id in met }) backedBy += ev
            var p = baseline
            val minimumMet = reqs.isNotEmpty() && unmet.isEmpty()
            if (minimumMet && !cheat) p = maxOf(p, bar)
            C(c.id, met, unmet, minimumMet, backedBy, p, p)
        }
        fun capped(p: Double) = if (cheat) minOf(p, CHEATING_CAP) else p
        fun scoreOf() = cs.minOfOrNull { capped(it.p) } ?: Double.POSITIVE_INFINITY

        val ladder = ArrayList<ModuleOut>()
        for (m in i.ladder) {
            val before = scoreOf()
            val backed = claimsBackedByModule(i.claims, i.requirements, i.facts.witness, m.backs, m.targetedOnly)
            val moved = ArrayList<Moved>()
            for (c in cs) {
                if (c.id !in backed) continue
                val pass = backs(m.claims.firstOrNull { it.id == c.id })
                val b = capped(c.p)
                c.p = if (pass) c.p + m.strength * (1 - c.p) else c.p * (1 - m.strength)
                if (pass) c.backedBy += m.module
                moved += Moved(c.id, pass, b, capped(c.p))
            }
            ladder += ModuleOut(m.module, before, scoreOf(), moved.isNotEmpty() && moved.all { it.passed }, moved)
        }
        for (c in cs) c.p = capped(c.p)

        val g = i.facts.integrity
        val checks = linkedMapOf(
            "chain" to g.chain, "timing" to g.timing, "physics" to g.physics, "frames" to g.frames,
            "ai" to !(i.judge?.verdict == "inconsistent" && i.judge.confidence >= BACKED_CONFIDENCE),
            "cheating" to !cheat,
            "bar" to cs.all { it.p >= bar },
        )
        val sealed = checks.values.all { it }
        return Out(
            baseline, cheat, signals,
            cs.map { ClaimScore(it.id, it.p, it.sealP, it.met, it.unmet, it.minimumMet, it.backedBy.toList()) },
            ladder, scoreOf(), checks, sealed,
            g.chain && g.timing && g.physics && g.frames && !cheat, cs.count { it.p >= bar },
        )
    }

    /** Detail-screen preview for one claim: (p if the module passes on it, p if it fails), plus the Moment score after each. */
    data class Preview(val passP: Double, val failP: Double, val passScore: Double, val failScore: Double)

    fun preview(scores: List<ClaimScore>, claimId: String, strength: Double): Preview? {
        val c = scores.firstOrNull { it.id == claimId } ?: return null
        val others = scores.filter { it.id != claimId }.map { it.p }
        val up = V3Math.pass(c.p, strength); val down = V3Math.fail(c.p, strength)
        return Preview(up, down, (others + up).min(), (others + down).min())
    }
}

/** UI words (v4.11) for backedBy sources. Module ids map to their ladder titles. */
fun sourceLabel(s: String, moduleTitle: (String) -> String?): String = when (s) {
    "video_review" -> "video review"
    "frames_judge" -> "proof shots"
    "gps" -> "GPS"
    "motion" -> "motion"
    "witness" -> "witness"
    else -> moduleTitle(s) ?: s
}

fun evidenceLabel(e: String): String = when (e) {
    "video" -> "Video"
    "frames" -> "Proof shot"
    "gps" -> "GPS"
    "motion" -> "Motion"
    "witness" -> "Witness"
    else -> e
}
