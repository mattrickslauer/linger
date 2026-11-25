package com.mattricks.verified.data

/** Pure ladder helpers (docs/ARCHITECTURE.md v3.6), unit-tested; the Cloud Function is the authority. */
object LadderLogic {
    data class Module(
        val id: String, val title: String, val blurb: String, val cost: Int, val strength: Double,
        val available: Boolean, val needs: List<String>,
    )

    /** What the Moment has, for the `needs` check. */
    data class Evidence(val frames: Int, val gps: Int, val witnessAnswered: Int, val quantities: Int, val video: Boolean, val clipOnPhone: Boolean)

    /** null = runnable; else the reason shown on the disabled row. */
    fun unmet(m: Module, e: Evidence, needsText: Map<String, String>): String? {
        if (!m.available) return "Coming soon"
        for (n in m.needs) {
            val ok = when (n) {
                "frames" -> e.frames > 0
                "gps" -> e.gps > 0
                "witness_answered" -> e.witnessAnswered > 0
                "quantities" -> e.quantities > 0
                "video" -> e.video && e.clipOnPhone
                else -> true
            }
            if (!ok) return when {
                n == "video" && e.video -> "The clip isn't on this phone"
                n == "video" -> "Needs a video clip in the chain"
                n == "witness_answered" -> "Needs an answered witness request"
                n == "quantities" -> "Needs a number in the intention"
                else -> "Needs " + (needsText[n] ?: n)
            }
        }
        return null
    }

    /** "if it passes → 0.79 · if it fails → 0.50" */
    fun previews(p: Double, s: Double): Pair<Double, Double> = V3Math.pass(p, s) to V3Math.fail(p, s)

    /** User-facing text for a runLadderModule `details.reason`. */
    fun message(reason: String?, fallback: String?): String = when (reason) {
        "sign_in" -> "Sign in to run verification modules."
        "insufficient_credits" -> "Not enough credits for this module."
        "already_run" -> "This module already ran on this Moment."
        "not_sealed_yet" -> "The seal isn't ready yet. Try again in a moment."
        "not_eligible" -> "This Moment failed an integrity check, so the ladder is closed."
        "not_owner" -> "Only the owner can run modules."
        "unavailable_module" -> "This module isn't available yet."
        "needs_frames" -> "Needs at least one proof frame."
        "needs_gps" -> "Needs GPS in the recording."
        "needs_witness_answered" -> "Needs an answered witness request."
        "needs_quantities" -> "Needs a number in the intention."
        "needs_video" -> "Needs a video clip in the chain."
        "clip_missing" -> "The clip didn't reach the server. Try again."
        "clip_hash_mismatch" -> "The uploaded clip doesn't match the chained hash. No credits were spent."
        "model_failed" -> "The review model failed. Your credits were refunded."
        "in_progress" -> "This module is already running."
        "moment_missing" -> "This Moment isn't on the server."
        else -> fallback?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
    }
}
