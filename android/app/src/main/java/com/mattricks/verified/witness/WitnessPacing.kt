package com.mattricks.verified.witness

/** Witness pacing (docs/ARCHITECTURE.md v3.4), pure so it is unit-tested. */
object WitnessPacing {
    const val FIRST_MS = 30_000L
    const val GAP_MS = 60_000L
    const val MAX = 6
    const val MIN_GAIN = 0.1

    /** May a new request be drafted now? lastAt = when the previous request was asked (0 = none yet). */
    fun canAsk(now: Long, startedAt: Long, lastAt: Long, asked: Int, open: Boolean): Boolean =
        !open && asked < MAX && now - startedAt >= FIRST_MS && (lastAt == 0L || now - lastAt >= GAP_MS)

    /** Show a drafted request only when it has an ask and enough expected gain. */
    fun worthShowing(ask: String, gain: Double): Boolean = ask.isNotBlank() && !gain.isNaN() && gain >= MIN_GAIN
}
