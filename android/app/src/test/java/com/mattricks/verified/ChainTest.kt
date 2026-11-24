package com.mattricks.verified

import com.mattricks.verified.chain.Chain
import com.mattricks.verified.chain.ChainLink
import com.mattricks.verified.chain.Check
import com.mattricks.verified.chain.Event
import com.mattricks.verified.chain.Payload
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class ChainTest {
    private val vectors: JSONObject by lazy {
        // Gradle runs unit tests with the module dir (android/app) as working dir.
        val f = listOf("../../shared/test-vectors.json", "../shared/test-vectors.json", "shared/test-vectors.json")
            .map(::File).first { it.exists() }
        JSONObject(f.readText())
    }

    private fun links(): List<ChainLink> {
        val arr = vectors.getJSONArray("chunks")
        return (0 until arr.length()).map {
            val c = arr.getJSONObject(it)
            ChainLink(c.getInt("seq"), c.getLong("t0"), c.getLong("t1"), c.getString("prevHash"), c.getString("payload"), c.getString("hash"))
        }
    }

    @Test fun payloadShaMatchesVectors() {
        val arr = vectors.getJSONArray("chunks")
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            assertEquals(c.getString("payloadSha"), Chain.sha256Hex(c.getString("payload")))
        }
    }

    @Test fun chunkHashMatchesVectors() {
        for (l in links()) assertEquals(l.hash, Chain.chunkHash(l.seq, l.t0, l.t1, l.prevHash, l.payload))
    }

    @Test fun genesisAndChainVerify() {
        val id = vectors.getString("momentId")
        val ls = links()
        assertEquals(Chain.genesis(id), ls[0].prevHash)
        assertEquals(-1, Chain.verify(id, ls))
        val tampered = ls.toMutableList().also { it[1] = it[1].copy(payload = it[1].payload.replace("bass", "trout")) }
        assertEquals(1, Chain.verify(id, tampered))
    }

    @Test fun frameShaIsShaOfBase64String() {
        // note in test-vectors.json: frameSha = sha256 of "aGVsbG8="
        assertEquals("333d6b3a3c1f5db6c9bdda5939b136986d170f4649172a68368d54ecb44c2ff2", Chain.sha256Hex("aGVsbG8="))
    }

    @Test fun payloadBuilderReproducesVectorBytes() {
        val nan = Double.NaN
        val p0 = Payload.build(
            gps = listOf(doubleArrayOf(1764000000000.0, 33.6189, -117.6681, 5.2, nan, 0.4)),
            motion = listOf(doubleArrayOf(1764000000100.0, 0.01, 9.81, -0.2, 0.0, 0.001, 0.0)),
            events = listOf(Event(1764000000000, "start")),
            frameSha = null, check = null,
        )
        val p1 = Payload.build(
            gps = emptyList(), motion = emptyList(),
            events = listOf(Event(1764000006000, "stop")),
            frameSha = "333d6b3a3c1f5db6c9bdda5939b136986d170f4649172a68368d54ecb44c2ff2",
            check = Check(true, "keep going", "on_device", "bass in hand"),
        )
        val arr = vectors.getJSONArray("chunks")
        assertEquals(arr.getJSONObject(0).getString("payload"), p0)
        assertEquals(arr.getJSONObject(1).getString("payload"), p1)
    }

    @Test fun numberFormatting() {
        assertEquals("0", Payload.num(0.0))
        assertEquals("-0.2", Payload.num(-0.2))
        assertEquals("0.0001", Payload.num(1e-4))
        assertEquals("null", Payload.num(Double.NaN))
        assertEquals("\"a\\\"b\"", Payload.str("a\"b"))
    }
}
