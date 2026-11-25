package com.mattricks.verified

import com.mattricks.verified.chain.Chain
import com.mattricks.verified.chain.ChainLink
import com.mattricks.verified.chain.Check
import com.mattricks.verified.chain.Event
import com.mattricks.verified.chain.Payload
import com.mattricks.verified.data.V3Math
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

/** shared/test-vectors-v3.json: guest chain with witness events, bar mapping, ladder math (docs/ARCHITECTURE.md v3). */
class V3ContractTest {
    private val v: JSONObject by lazy {
        val f = listOf("../../shared/test-vectors-v3.json", "../shared/test-vectors-v3.json", "shared/test-vectors-v3.json")
            .map(::File).first { it.exists() }
        JSONObject(f.readText())
    }

    private fun guestLinks(): List<ChainLink> {
        val arr = v.getJSONObject("guestChain").getJSONArray("chunks")
        return (0 until arr.length()).map {
            val c = arr.getJSONObject(it)
            ChainLink(c.getInt("seq"), c.getLong("t0"), c.getLong("t1"), c.getString("prevHash"), c.getString("payload"), c.getString("hash"))
        }
    }

    @Test fun guestChainVerifiesAndHasNoOwner() {
        val g = v.getJSONObject("guestChain")
        val links = guestLinks()
        assertEquals(-1, Chain.verify(g.getString("momentId"), links))
        assertEquals(g.getString("headHash"), links.last().hash)
        for (l in links) {
            assertFalse(l.payload.contains("uid"))
            assertFalse(l.payload.contains("owner"))
        }
    }

    @Test fun payloadBuilderReproducesWitnessEvents() {
        val nan = Double.NaN
        val links = guestLinks()
        val p0 = Payload.build(
            gps = listOf(doubleArrayOf(1764100000000.0, 33.6189, -117.6681, 5.2, nan, 0.4)),
            motion = listOf(doubleArrayOf(1764100000100.0, 0.01, 9.81, -0.2, 0.0, 0.001, 0.0)),
            events = listOf(
                Event(1764100000000, "start"),
                Event(1764100003000, "witness", linkedMapOf("wid" to "w1", "ask" to "Hold the fish next to the ruler", "kind" to "show", "by" to "on_device")),
            ),
            frameSha = null, check = null,
        )
        assertEquals(links[0].payload, p0)
        val p1 = Payload.build(
            gps = emptyList(), motion = emptyList(),
            events = listOf(
                Event(1764100008000, "frame", linkedMapOf("wid" to "w1")),
                Event(1764100008000, "witness_answer", linkedMapOf("wid" to "w1", "via" to "frame")),
            ),
            frameSha = "333d6b3a3c1f5db6c9bdda5939b136986d170f4649172a68368d54ecb44c2ff2",
            check = Check(true, "keep going", "on_device", "bass on ruler"),
        )
        assertEquals(links[1].payload, p1)
        val p2 = Payload.build(
            gps = listOf(doubleArrayOf(1764100029000.0, 33.619, -117.668, 5.0, nan, 0.2)), motion = emptyList(),
            events = listOf(
                Event(1764100020000, "witness", linkedMapOf("wid" to "w2", "ask" to "Say the time on your watch", "kind" to "tell", "by" to "cloud")),
                Event(1764100024000, "witness_answer", linkedMapOf("wid" to "w2", "via" to "voice", "text" to "it's six forty two")),
                Event(1764100026000, "witness", linkedMapOf("wid" to "w3", "ask" to "Pan slowly across the lake", "kind" to "show", "by" to "on_device")),
                Event(1764100028000, "witness_skip", linkedMapOf("wid" to "w3")),
                Event(1764100030000, "stop"),
            ),
            frameSha = null, check = null,
        )
        assertEquals(links[2].payload, p2)
    }

    @Test fun barMapping() {
        val bars = v.getJSONArray("bars")
        for (i in 0 until bars.length()) {
            val b = bars.getJSONObject(i)
            assertEquals("difficulty ${b.getDouble("difficulty")}", b.getDouble("bar"), V3Math.bar(b.getDouble("difficulty")), 1e-12)
        }
    }

    @Test fun ladderMath() {
        val ladders = v.getJSONArray("ladders")
        for (i in 0 until ladders.length()) {
            val l = ladders.getJSONObject(i)
            var p = l.getDouble("baseline")
            val steps = l.getJSONArray("steps")
            for (j in 0 until steps.length()) {
                val s = steps.getJSONObject(j)
                assertEquals(s.getDouble("before"), p, 1e-9)
                p = V3Math.step(p, s.getDouble("strength"), s.getBoolean("passed"))
                assertEquals(s.getDouble("after"), p, 1e-9)
            }
            assertEquals(l.getDouble("score"), p, 1e-9)
            assertEquals(l.getBoolean("verified"), p >= l.getDouble("bar"))
        }
    }
}
