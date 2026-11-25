package com.mattricks.verified

import com.mattricks.verified.chain.Chain
import com.mattricks.verified.chain.ChainLink
import com.mattricks.verified.chain.Check
import com.mattricks.verified.chain.Event
import com.mattricks.verified.chain.Payload
import com.mattricks.verified.data.Checklist
import com.mattricks.verified.data.Claim
import com.mattricks.verified.data.Intention
import com.mattricks.verified.data.Plan
import com.mattricks.verified.data.Requirement
import com.mattricks.verified.data.V4Norm
import com.mattricks.verified.data.V4Score
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** shared/test-vectors-v4.json + docs/ARCHITECTURE.md v4.1, v4.2, v4.5, v4.10. */
class V4ContractTest {
    private val v: JSONObject by lazy {
        val f = listOf("../../shared/test-vectors-v4.json", "../shared/test-vectors-v4.json", "shared/test-vectors-v4.json")
            .map(::File).first { it.exists() }
        JSONObject(f.readText())
    }

    // ── v4.1 / v4.2 normalization

    @Test fun normalizesClaimsAndPlanLikeTheContract() {
        val model = JSONObject(
            """{"claims":[
                {"id":"x","kind":"action","text":"  clapping  ","metric":"","value":0,"unit":""},
                {"id":"y","kind":"weird","text":"dropped","metric":"","value":0,"unit":""},
                {"id":"z","kind":"count","text":"50 claps","metric":"claps","value":50,"unit":"claps"},
                {"id":"w","kind":"place","text":"","metric":"","value":0,"unit":""}],
              "plan":{"requirements":[
                {"id":"a","claimId":"x","evidence":"video","ask":"Clap on camera","minSeconds":0},
                {"id":"b","claimId":"y","evidence":"video","ask":"orphan","minSeconds":0},
                {"id":"c","claimId":"z","evidence":"video","ask":"All 50 claps","minSeconds":20},
                {"id":"d","claimId":"z","evidence":"gps","ask":"gps with seconds","minSeconds":30},
                {"id":"e","claimId":"z","evidence":"telepathy","ask":"bad","minSeconds":0}],
               "recordMode":"photo","note":"n"}}""",
        )
        val (claims, plan) = V4Norm.fromModel(model)
        assertEquals(listOf("c1", "c2"), claims.map { it.id })
        assertEquals("clapping", claims[0].text)
        assertFalse(claims[0].toMap().containsKey("metric")) // only count/measure with value > 0 keep metric/value/unit
        assertEquals(50.0, claims[1].toMap()["value"])
        plan!!
        assertEquals(listOf("r1", "r2", "r3"), plan.requirements.map { it.id })
        assertEquals(listOf("c1", "c2", "c2"), plan.requirements.map { it.claimId })
        assertNull(plan.requirements[0].minSeconds)
        assertEquals(20.0, plan.requirements[1].minSeconds)
        assertNull(plan.requirements[2].minSeconds) // gps never keeps minSeconds
        assertEquals("video", plan.recordMode) // recordMode = video iff any requirement is video
    }

    @Test fun capsAtFiveClaimsAndSixRequirements() {
        val claims = (1..7).map { Claim("k$it", "action", "a$it") }
        val plan = Plan((1..9).map { Requirement("q$it", "k1", "frames", "ask $it") }, "video", "x".repeat(300))
        val (c, p) = V4Norm.normalize(claims, plan)
        assertEquals(5, c.size)
        assertEquals(6, p!!.requirements.size)
        assertEquals("photo", p.recordMode)
        assertEquals(160, p.note.length)
    }

    @Test fun removingAClaimDropsItsRequirementsAndRenumbers() {
        val (c, p) = V4Norm.normalize(
            listOf(Claim("c1", "action", "clapping"), Claim("c2", "count", "50 claps", "claps", 50.0, "claps")),
            Plan(listOf(Requirement("r1", "c1", "frames", "a"), Requirement("r2", "c2", "video", "b", 20.0)), "video", ""),
        )
        val (c2, p2) = V4Norm.without(c, p, "c1")
        assertEquals(listOf(Claim("c1", "count", "50 claps", "claps", 50.0, "claps")), c2)
        assertEquals(listOf(Requirement("r1", "c1", "video", "b", 20.0)), p2!!.requirements)
    }

    @Test fun intentionMapIsV4WithClaimsAndPlan() {
        val i = Intention(
            text = "clap 50 times", category = "fitness", v = 4,
            claims = listOf(Claim("c1", "action", "clapping")),
            plan = Plan(listOf(Requirement("r1", "c1", "video", "Clap on camera")), "video", ""),
        )
        val m = i.toMap(1L)
        assertEquals(4, m["v"])
        assertEquals(1, (m["claims"] as List<*>).size)
        @Suppress("UNCHECKED_CAST")
        assertEquals("video", (m["plan"] as Map<String, Any?>)["recordMode"])
        val back = Intention.from(m)!!
        assertEquals(i.claims, back.claims)
        assertEquals(i.plan!!.requirements, back.plan!!.requirements)
        assertTrue(back.structured)
    }

    // ── v4.2 checklist ("captured")

    @Test fun checklistCapturedRules() {
        val f = Checklist.Facts(clipsMs = listOf(12_000), frames = 1, goodFixes = 0, motionSeconds = 9.5, answeredRids = listOf("r5"))
        assertTrue(Checklist.captured(Requirement("r1", "c1", "video", ""), f))
        assertFalse(Checklist.captured(Requirement("r2", "c1", "video", "", 20.0), f))
        assertTrue(Checklist.captured(Requirement("r3", "c1", "frames", ""), f))
        assertFalse(Checklist.captured(Requirement("r4", "c1", "gps", ""), f))
        assertFalse(Checklist.captured(Requirement("r6", "c1", "motion", ""), f)) // default 10 s
        assertTrue(Checklist.captured(Requirement("r6", "c1", "motion", "", 5.0), f))
        assertTrue(Checklist.captured(Requirement("r5", "c1", "witness", ""), f))
        assertFalse(Checklist.captured(Requirement("r1", "c1", "witness", ""), f))
    }

    // ── v4.10 witness event with rid + chained clip

    @Test fun videoChainVerifiesAndPayloadCarriesRid() {
        val vc = v.getJSONObject("videoChain")
        val arr = vc.getJSONArray("chunks")
        val links = (0 until arr.length()).map {
            val c = arr.getJSONObject(it)
            ChainLink(c.getInt("seq"), c.getLong("t0"), c.getLong("t1"), c.getString("prevHash"), c.getString("payload"), c.getString("hash"))
        }
        assertEquals(-1, Chain.verify(vc.getString("momentId"), links))
        val p0 = Payload.build(
            gps = emptyList(),
            motion = listOf(doubleArrayOf(1764200000100.0, 0.3, 9.7, 0.1, 0.2, 0.1, 0.0)),
            events = listOf(
                Event(1764200000000, "start"),
                Event(1764200001000, "video_start"),
                Event(1764200004000, "witness", linkedMapOf("wid" to "w1", "ask" to "Keep both hands in frame", "kind" to "do", "by" to "on_device", "rid" to "r1")),
            ),
            frameSha = null, check = null,
        )
        assertEquals(links[0].payload, p0)
        val p1 = Payload.build(
            gps = emptyList(), motion = emptyList(),
            events = listOf(
                Event(1764200036000, "video", linkedMapOf("sha256" to vc.getString("clipSha"), "bytes" to 15L, "durationMs" to 35000L, "startedAt" to 1764200001000L, "name" to "verified-clap.webm")),
                Event(1764200036000, "frame"),
                Event(1764200036000, "witness_answer", linkedMapOf("wid" to "w1", "via" to "done")),
                Event(1764200036000, "stop"),
            ),
            frameSha = "333d6b3a3c1f5db6c9bdda5939b136986d170f4649172a68368d54ecb44c2ff2",
            check = Check(true, "keep going", "on_device", "hands clapping"),
        )
        assertEquals(links[1].payload, p1)
    }

    @Test fun clipRefsComeFromTheChainedVideoEvents() {
        val vc = v.getJSONObject("videoChain")
        val chunks = vc.getJSONArray("chunks")
        val refs = (0 until chunks.length()).flatMap { com.mattricks.verified.data.Clips.refsIn(chunks.getJSONObject(it).getString("payload")) }
        assertEquals(1, refs.size)
        assertEquals(vc.getString("clipSha"), refs[0].sha256)
        assertEquals(35000L, refs[0].durationMs)
        assertEquals("webm", com.mattricks.verified.data.Clips.ext(refs[0]))
        assertEquals("mp4", com.mattricks.verified.data.Clips.ext(refs[0].copy(name = "verified-1234abcd-1764200000000")))
    }

    // ── v4.5 scoring vectors

    private fun verdicts(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map {
        val x = a.getJSONObject(it)
        V4Score.Verdict(x.getString("id"), x.optString("verdict").takeIf { s -> s.isNotEmpty() }, if (x.has("confidence")) x.getDouble("confidence") else null)
    }

    private fun strs(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }

    private fun input(j: JSONObject): V4Score.Input {
        val f = j.getJSONObject("facts")
        val g = f.getJSONObject("integrity")
        val claims = j.getJSONArray("claims").let { a -> (0 until a.length()).map { Claim.fromJson(a.getJSONObject(it)) } }
        val reqs = j.getJSONArray("requirements").let { a -> (0 until a.length()).map { Requirement.fromJson(a.getJSONObject(it)) } }
        val clips = f.getJSONArray("clips").let { a ->
            (0 until a.length()).map {
                val c = a.getJSONObject(it)
                V4Score.ClipFact(c.getLong("durationMs"), c.getBoolean("uploaded"), if (c.isNull("hashOk")) null else c.getBoolean("hashOk"))
            }
        }
        val witness = f.getJSONArray("witness").let { a ->
            (0 until a.length()).map { val w = a.getJSONObject(it); V4Score.WitnessFact(if (w.has("rid") && !w.isNull("rid")) w.getString("rid") else null, w.getBoolean("answered")) }
        }
        val judge = j.optJSONObject("judge")?.let { V4Score.Judge(it.getString("verdict"), it.getDouble("confidence"), if (it.has("claims")) verdicts(it.getJSONArray("claims")) else null) }
        val skeptic = j.optJSONObject("skeptic")?.let { V4Score.Skeptic(it.getString("verdict"), strs(it.optJSONArray("reasons"))) }
        val video = j.optJSONObject("videoReview")?.let {
            val ch = it.optJSONObject("cheating")
            V4Score.Video(it.getString("status"), verdicts(it.optJSONArray("claims")), ch?.optBoolean("detected") == true, strs(ch?.optJSONArray("signals")))
        }
        val ladder = j.optJSONArray("ladder")?.let { a ->
            (0 until a.length()).map {
                val m = a.getJSONObject(it)
                V4Score.Module(m.getString("module"), m.getDouble("strength"), strs(m.getJSONArray("backs")), verdicts(m.optJSONArray("claims")), m.optBoolean("targetedOnly", false))
            }
        }.orEmpty()
        return V4Score.Input(
            j.getDouble("bar"), if (j.isNull("baseline")) null else j.getDouble("baseline"), claims, reqs,
            V4Score.Facts(
                V4Score.Integrity(g.getBoolean("chain"), g.getBoolean("timing"), g.getBoolean("physics"), g.getBoolean("frames")),
                f.getInt("frameCount"), f.getInt("gpsFixes"), f.getDouble("motionSeconds"), clips, witness,
            ),
            judge, skeptic, video, ladder,
        )
    }

    @Test fun scoringMatchesEveryReferenceVector() {
        val cases = v.getJSONArray("scoring")
        assertEquals(21, cases.length())
        for (k in 0 until cases.length()) {
            val c = cases.getJSONObject(k)
            val name = c.getString("name")
            val e = c.getJSONObject("expect")
            val out = V4Score.score(input(c.getJSONObject("input")))
            assertEquals(name, e.getDouble("baselineUsed"), out.baselineUsed, 1e-9)
            assertEquals(name, e.getJSONObject("cheating").getBoolean("detected"), out.cheatingDetected)
            assertEquals(name, strs(e.getJSONObject("cheating").getJSONArray("signals")), out.signals)
            assertEquals(name, e.getDouble("score"), out.score, 1e-9)
            assertEquals(name, e.getBoolean("sealed"), out.sealed)
            assertEquals(name, e.getBoolean("ladderEligible"), out.ladderEligible)
            assertEquals(name, e.getInt("claimsBacked"), out.claimsBacked)
            val checks = e.getJSONObject("checks")
            for (key in checks.keys()) assertEquals("$name check $key", checks.getBoolean(key), out.checks[key])
            val ec = e.getJSONArray("claims")
            assertEquals(name, ec.length(), out.claims.size)
            for (i in 0 until ec.length()) {
                val x = ec.getJSONObject(i); val o = out.claims[i]
                assertEquals(name, x.getString("id"), o.id)
                assertEquals("$name ${o.id} p", x.getDouble("p"), o.p, 1e-9)
                assertEquals("$name ${o.id} sealP", x.getDouble("sealP"), o.sealP, 1e-9)
                assertEquals("$name ${o.id} met", strs(x.getJSONArray("met")), o.met)
                assertEquals("$name ${o.id} unmet", strs(x.getJSONArray("unmet")), o.unmet)
                assertEquals("$name ${o.id} minimumMet", x.getBoolean("minimumMet"), o.minimumMet)
                assertEquals("$name ${o.id} backedBy", strs(x.getJSONArray("backedBy")), o.backedBy)
            }
            val el = e.getJSONArray("ladder")
            assertEquals(name, el.length(), out.ladder.size)
            for (i in 0 until el.length()) {
                val x = el.getJSONObject(i); val o = out.ladder[i]
                assertEquals(name, x.getDouble("before"), o.before, 1e-9)
                assertEquals(name, x.getDouble("after"), o.after, 1e-9)
                assertEquals(name, x.getBoolean("passed"), o.passed)
                val mc = x.getJSONArray("claims")
                assertEquals(name, mc.length(), o.claims.size)
                for (q in 0 until mc.length()) {
                    assertEquals(name, mc.getJSONObject(q).getDouble("after"), o.claims[q].after, 1e-9)
                    assertEquals(name, mc.getJSONObject(q).getDouble("before"), o.claims[q].before, 1e-9)
                }
            }
        }
    }

    @Test fun perClaimPreviewMovesOnlyThatClaim() {
        val scores = listOf(
            com.mattricks.verified.data.ClaimScore("c1", 0.52, 0.52, emptyList(), emptyList(), true, emptyList()),
            com.mattricks.verified.data.ClaimScore("c2", 0.4, 0.4, emptyList(), emptyList(), false, emptyList()),
        )
        val p = V4Score.preview(scores, "c2", 0.3)!!
        assertEquals(0.58, p.passP, 1e-9)
        assertEquals(0.28, p.failP, 1e-9)
        assertEquals(0.52, p.passScore, 1e-9)
        assertEquals(0.28, p.failScore, 1e-9)
    }
}
