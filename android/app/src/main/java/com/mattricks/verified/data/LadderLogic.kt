package com.mattricks.verified.data

/** Pure ladder helpers (docs/ARCHITECTURE.md v3.6), unit-tested; the Cloud Function is the authority. */
object LadderLogic {
    /** [backs] = claim kinds the module can back (v4.6); [backsTargetedOnly] = witness_review: only targeted claims. */
    data class Module(
        val id: String, val title: String, val blurb: String, val cost: Int, val strength: Double,
        val available: Boolean, val needs: List<String>,
        val backs: List<String> = emptyList(), val backsTargetedOnly: Boolean = false,
    )

    /**
     * What the Moment has, for the `needs` check. v4 ([v4] = true): `quantities` = server count/measure claims, and
     * `video` is met by the clip uploaded at submit ([clipUploaded]) or, failing that, the clip still on this phone.
     */
    data class Evidence(
        val frames: Int, val gps: Int, val witnessAnswered: Int, val quantities: Int, val video: Boolean, val clipOnPhone: Boolean,
        val v4: Boolean = false, val clipUploaded: Boolean = false,
    )

    /** null = runnable; else the reason shown on the disabled row. */
    fun unmet(m: Module, e: Evidence, needsText: Map<String, String>): String? {
        if (!m.available) return "Coming soon"
        for (n in m.needs) {
            val ok = when (n) {
                "frames" -> e.frames > 0
                "gps" -> e.gps > 0
                "witness_answered" -> e.witnessAnswered > 0
                "quantities" -> e.quantities > 0
                "video" -> e.video && (e.clipOnPhone || (e.v4 && e.clipUploaded))
                else -> true
            }
            if (!ok) return when {
                n == "video" && e.video -> "The clip isn't on this phone"
                n == "video" -> "Needs a video clip in the chain"
                n == "witness_answered" -> "Needs an answered witness request"
                n == "quantities" && e.v4 -> "Needs a count or measure claim"
                n == "quantities" -> "Needs a number in the intention"
                else -> "Needs " + (needsText[n] ?: n)
            }
        }
        return null
    }

    /** v4.6: claim ids this module moves (kind in backs; witness_review only claims an answered request targeted). */
    fun backedClaims(m: Module, claims: List<Claim>, requirements: List<Requirement>, answeredRids: List<String?>): List<String> =
        V4Score.claimsBackedByModule(claims, requirements, answeredRids.map { V4Score.WitnessFact(it, true) }, m.backs, m.backsTargetedOnly)

    /** v4: null = offered; else why not (needs unmet, or it backs none of the claims). */
    fun unmetV4(m: Module, e: Evidence, needsText: Map<String, String>, backed: List<String>): String? =
        unmet(m, e, needsText) ?: if (backed.isEmpty()) "Backs none of this Moment's claims" else null

    /** Moment score if the module passes / fails on every claim it backs (each claim moves on its own, v4.5 step 4). */
    fun previewsV4(scores: List<ClaimScore>, backed: List<String>, s: Double): Pair<Double, Double>? {
        if (scores.isEmpty() || backed.isEmpty()) return null
        val up = scores.minOf { if (it.id in backed) V3Math.pass(it.p, s) else it.p }
        val down = scores.minOf { if (it.id in backed) V3Math.fail(it.p, s) else it.p }
        return up to down
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
        "needs_quantities" -> "Needs a count or measure claim."
        "no_claims_backed" -> "This module backs none of this Moment's claims. No credits were spent."
        "needs_video" -> "Needs a video clip in the chain."
        "clip_missing" -> "The clip didn't reach the server. Try again."
        "clip_hash_mismatch" -> "The uploaded clip doesn't match the chained hash. No credits were spent."
        "model_failed" -> "The review model failed. Your credits were refunded."
        "in_progress" -> "This module is already running."
        "moment_missing" -> "This Moment isn't on the server."
        "pay_unavailable" -> "The payment service couldn't be reached. Try again in a moment."
        "bad_pack" -> "That credit pack isn't on sale any more. Update the app and try again."
        "unknown_purchase" -> "That purchase isn't on this account."
        else -> fallback?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
    }
}
