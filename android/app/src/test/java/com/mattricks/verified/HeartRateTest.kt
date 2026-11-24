package com.mattricks.verified

import com.mattricks.verified.devices.HeartRate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HeartRateTest {
    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test fun uint8() = assertEquals(72, HeartRate.parse(bytes(0x00, 72)))
    @Test fun uint8WithExtraFields() = assertEquals(150, HeartRate.parse(bytes(0x16, 150, 0x10, 0x02)))
    @Test fun uint16LittleEndian() = assertEquals(260, HeartRate.parse(bytes(0x01, 0x04, 0x01)))
    @Test fun uint8Above127IsUnsigned() = assertEquals(200, HeartRate.parse(bytes(0x00, 200)))
    @Test fun truncated() { assertNull(HeartRate.parse(bytes(0x00))); assertNull(HeartRate.parse(bytes(0x01, 0x40))) }
    @Test fun zeroMeansNoContact() = assertNull(HeartRate.parse(bytes(0x00, 0)))
}
