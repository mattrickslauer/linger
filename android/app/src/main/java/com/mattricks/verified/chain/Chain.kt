package com.mattricks.verified.chain

import java.math.BigDecimal
import java.security.MessageDigest

/**
 * Pure Kotlin hash chain (no Android deps) — see docs/ARCHITECTURE.md "chunks".
 * hash = sha256hex("$seq|$t0|$t1|$prevHash|${sha256hex(payload)}"), UTF-8, lowercase hex.
 * The payload is hashed as the stored STRING; it is never re-serialized.
 */
object Chain {
    fun sha256Hex(s: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
        val out = StringBuilder(64)
        for (b in d) {
            val v = b.toInt() and 0xff
            out.append(HEX[v ushr 4]).append(HEX[v and 0x0f])
        }
        return out.toString()
    }

    fun genesis(momentId: String) = "GENESIS:$momentId"

    fun chunkHash(seq: Int, t0: Long, t1: Long, prevHash: String, payload: String): String =
        sha256Hex("$seq|$t0|$t1|$prevHash|${sha256Hex(payload)}")

    /** Verifies a full chain; returns the index of the first bad chunk or -1. */
    fun verify(momentId: String, chunks: List<ChainLink>): Int {
        var prev = genesis(momentId)
        chunks.forEachIndexed { i, c ->
            if (c.seq != i || c.prevHash != prev || chunkHash(c.seq, c.t0, c.t1, c.prevHash, c.payload) != c.hash) return i
            prev = c.hash
        }
        return -1
    }

    private val HEX = "0123456789abcdef".toCharArray()
}

data class ChainLink(val seq: Int, val t0: Long, val t1: Long, val prevHash: String, val payload: String, val hash: String)

data class Check(val ok: Boolean, val reason: String, val mode: String, val label: String)

data class Event(val t: Long, val type: String, val extra: Map<String, Any?> = emptyMap())

/**
 * Builds the payload JSON string in the contract's key order with JS-like number formatting
 * (integers without ".0", no exponent), so all platforms produce similar bytes.
 */
object Payload {
    fun build(
        gps: List<DoubleArray>,          // [t, lat, lng, acc, alt|NaN, speed|NaN]
        motion: List<DoubleArray>,       // [t, ax, ay, az, gx, gy, gz]
        events: List<Event>,
        frameSha: String?,
        check: Check?,
    ): String {
        val sb = StringBuilder(256 + motion.size * 64)
        sb.append("{\"gps\":[")
        gps.forEachIndexed { i, r -> if (i > 0) sb.append(','); row(sb, r) }
        sb.append("],\"motion\":[")
        motion.forEachIndexed { i, r -> if (i > 0) sb.append(','); row(sb, r) }
        sb.append("],\"events\":[")
        events.forEachIndexed { i, e ->
            if (i > 0) sb.append(',')
            sb.append("{\"t\":").append(e.t).append(",\"type\":").append(str(e.type))
            for ((k, v) in e.extra) sb.append(',').append(str(k)).append(':').append(value(v))
            sb.append('}')
        }
        sb.append("],\"frameSha\":").append(if (frameSha == null) "null" else str(frameSha))
        sb.append(",\"check\":")
        if (check == null) sb.append("null") else {
            sb.append("{\"ok\":").append(check.ok)
                .append(",\"reason\":").append(str(check.reason))
                .append(",\"mode\":").append(str(check.mode))
                .append(",\"label\":").append(str(check.label)).append('}')
        }
        sb.append('}')
        return sb.toString()
    }

    private fun row(sb: StringBuilder, r: DoubleArray) {
        sb.append('[')
        r.forEachIndexed { i, v -> if (i > 0) sb.append(','); sb.append(num(v)) }
        sb.append(']')
    }

    private fun value(v: Any?): String = when (v) {
        null -> "null"
        is Boolean -> v.toString()
        is Int, is Long -> v.toString()
        is Number -> num(v.toDouble())
        else -> str(v.toString())
    }

    /** JS-like number formatting; NaN/Infinity become null. */
    fun num(v: Double): String {
        if (v.isNaN() || v.isInfinite()) return "null"
        if (v == Math.rint(v) && Math.abs(v) < 1e15) return v.toLong().toString()
        return BigDecimal(v.toString()).stripTrailingZeros().toPlainString()
    }

    fun str(s: String): String {
        val sb = StringBuilder(s.length + 2).append('"')
        for (c in s) when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\t' -> sb.append("\\t")
            c < ' ' -> sb.append(String.format("\\u%04x", c.code))
            else -> sb.append(c)
        }
        return sb.append('"').toString()
    }
}
