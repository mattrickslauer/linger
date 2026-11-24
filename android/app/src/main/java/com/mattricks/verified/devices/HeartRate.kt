package com.mattricks.verified.devices

/** Bluetooth SIG Heart Rate Measurement (0x2A37) parser. Pure Kotlin for unit tests. */
object HeartRate {
    /** flags bit 0 set → UINT16 little-endian value, else UINT8. Returns null for malformed or implausible values. */
    fun parse(v: ByteArray): Int? {
        if (v.size < 2) return null
        val bpm = if (v[0].toInt() and 1 == 1) {
            if (v.size < 3) return null
            (v[1].toInt() and 0xff) or ((v[2].toInt() and 0xff) shl 8)
        } else v[1].toInt() and 0xff
        return bpm.takeIf { it in 1..300 }
    }
}
