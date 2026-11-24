package com.mattricks.verified

import com.mattricks.verified.ai.Ai
import com.mattricks.verified.chain.Chain
import com.mattricks.verified.chain.Check
import com.mattricks.verified.chain.Event
import com.mattricks.verified.chain.Payload
import com.mattricks.verified.data.LatLng
import com.mattricks.verified.data.Summary
import com.mattricks.verified.record.Geo
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test fun extractJsonHandlesFencesAndProse() {
        val j = Ai.extractJson("Sure!\n```json\n{\"ok\": false, \"reason\": \"Fish not visible\", \"label\": \"empty lake\"}\n```")
        assertNotNull(j)
        assertEquals(false, j!!.getBoolean("ok"))
        assertEquals("Fish not visible", j.getString("reason"))
        assertNull(Ai.extractJson("no json here"))
    }

    @Test fun haversineAndPathLength() {
        // ~111.2 km per degree of latitude
        val d = Geo.haversine(LatLng(33.0, -117.0), LatLng(34.0, -117.0))
        assertEquals(111_195.0, d, 50.0)
        assertEquals(0.0, Geo.pathLength(listOf(LatLng(1.0, 1.0))), 0.0)
        assertEquals(1.23, Geo.round(1.2345, 2), 0.0)
    }

    @Test fun payloadIsValidJsonWithContractKeysAndNullsForMissingAltitude() {
        val p = Payload.build(
            gps = listOf(doubleArrayOf(1764000000000.0, 33.6189, -117.6681, 5.2, Double.NaN, 0.4)),
            motion = listOf(doubleArrayOf(1764000000100.0, 0.01, 9.81, -0.2, 0.0, 0.001, 0.0)),
            events = listOf(Event(1764000000000, "start"), Event(1764000001000, "retake", mapOf("reason" to "Too \"dark\"", "mode" to "on_device"))),
            frameSha = Chain.sha256Hex("aGVsbG8="),
            check = Check(false, "Too \"dark\"", "on_device", "lake"),
        )
        val j = JSONObject(p)
        assertEquals(setOf("gps", "motion", "events", "frameSha", "check"), j.keys().asSequence().toSet())
        assertTrue(p.startsWith("{\"gps\":[[1764000000000,33.6189,-117.6681,5.2,null,0.4]],\"motion\":"))
        assertEquals("retake", j.getJSONArray("events").getJSONObject(1).getString("type"))
        assertEquals("Too \"dark\"", j.getJSONObject("check").getString("reason"))
    }

    @Test fun summaryRoundTripsThroughFirestoreMap() {
        val s = Summary(25_000, 12.5, 2, 20, 250, LatLng(1.0, 2.0), LatLng(1.1, 2.1), 3)
        assertEquals(s, Summary.from(s.toMap()))
    }
}
