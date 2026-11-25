package com.mattricks.verified

import com.mattricks.verified.data.LadderLogic
import com.mattricks.verified.data.V3Math
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class LadderLogicTest {
    private val catalog: List<LadderLogic.Module> by lazy {
        val f = listOf("../../shared/ladder.json", "../shared/ladder.json", "shared/ladder.json").map(::File).first { it.exists() }
        val a = JSONObject(f.readText()).getJSONArray("modules")
        (0 until a.length()).map { i ->
            val m = a.getJSONObject(i)
            LadderLogic.Module(m.getString("id"), m.getString("title"), m.optString("blurb"), m.getInt("cost"), m.getDouble("strength"),
                m.optBoolean("available", true), m.getJSONArray("needs").let { n -> (0 until n.length()).map { n.getString(it) } })
        }
    }
    private fun mod(id: String) = catalog.first { it.id == id }
    private val full = LadderLogic.Evidence(frames = 3, gps = 20, witnessAnswered = 1, quantities = 1, video = true, clipOnPhone = true)
    private val bare = LadderLogic.Evidence(0, 0, 0, 0, video = false, clipOnPhone = false)

    @Test fun catalogMatchesContract() {
        assertEquals(listOf("second_look", "place_time", "witness_review", "count_measure", "full_video", "human_review"), catalog.map { it.id })
        assertEquals(3, mod("full_video").cost); assertEquals(0.45, mod("full_video").strength, 0.0)
    }

    @Test fun everythingRunnableWithFullEvidence() {
        catalog.filter { it.available }.forEach { assertNull(it.id, LadderLogic.unmet(it, full, emptyMap())) }
    }

    @Test fun humanReviewComingSoon() = assertEquals("Coming soon", LadderLogic.unmet(mod("human_review"), full, emptyMap()))

    @Test fun needsAreChecked() {
        catalog.filter { it.available }.forEach { assertNotNull(it.id, LadderLogic.unmet(it, bare, emptyMap())) }
        assertTrue(LadderLogic.unmet(mod("full_video"), full.copy(clipOnPhone = false), emptyMap())!!.contains("phone"))
    }

    @Test fun previewsUseContractMath() {
        val (up, down) = LadderLogic.previews(0.62, 0.45)
        assertEquals("0.79", V3Math.fmt(up))
        assertEquals(0.62 * 0.55, down, 1e-12)
    }
}
