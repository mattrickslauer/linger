package com.mattricks.verified.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.util.Base64
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.material3.MaterialTheme
import com.github.takahirom.roborazzi.captureRoboImage
import com.mattricks.verified.data.LatLng
import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Summary
import java.io.ByteArrayOutputStream
import kotlin.math.cos
import kotlin.math.sin

/** Screenshot output dir: -Dshots.dir=… (gradle: -Pshots.dir), default build/shots. */
val shotsDir: String get() = System.getProperty("shots.dir")?.takeIf { it.isNotBlank() } ?: "build/shots"

fun shot(name: String, dark: Boolean = false, content: @Composable () -> Unit) =
    captureRoboImage("$shotsDir/$name.png") {
        VerifiedTheme(dark) { Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) { content() } }
    }

/** A fake "proof shot": a lake-at-dusk gradient with a horizon, as base64 JPEG. */
fun fakePhoto(seed: Int = 0): String {
    val w = 360; val h = 640
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val p = Paint()
    val skies = listOf(intArrayOf(0xFF3B6E8F.toInt(), 0xFFE8A86B.toInt()), intArrayOf(0xFF2B4A3A.toInt(), 0xFF9CC08A.toInt()), intArrayOf(0xFF553A5E.toInt(), 0xFFF2B880.toInt()))
    val sky = skies[seed % skies.size]
    p.shader = LinearGradient(0f, 0f, 0f, h * 0.6f, sky[0], sky[1], Shader.TileMode.CLAMP)
    c.drawRect(0f, 0f, w.toFloat(), h * 0.6f, p)
    p.shader = LinearGradient(0f, h * 0.6f, 0f, h.toFloat(), 0xFF1F4B55.toInt(), 0xFF0B1E24.toInt(), Shader.TileMode.CLAMP)
    c.drawRect(0f, h * 0.6f, w.toFloat(), h.toFloat(), p)
    p.shader = null; p.color = 0xFF14301F.toInt()
    c.drawCircle(w * 0.2f, h * 0.62f, 120f, p); c.drawCircle(w * 0.85f, h * 0.63f, 150f, p)
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.JPEG, 80, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

val fakeTrack: List<LatLng> = (0..40).map { i ->
    val a = i / 40.0 * Math.PI * 1.4
    LatLng(33.62 + 0.002 * sin(a) + i * 0.00002, -117.66 + 0.003 * cos(a * 0.8))
}

fun fakeCard(
    id: String = "m1", status: String = "sealed", intention: String = "Catch and release a largemouth bass at Lake Mission Viejo",
    score: Double? = 0.86, bar: Double? = 0.74, photo: Boolean = true, seed: Int = 0,
    checks: Map<String, Boolean> = mapOf("chain" to true, "timing" to true, "physics" to true, "frames" to true, "ai" to true),
    cheating: Boolean = false, local: Boolean = false,
) = MomentCard(
    id = id, ownerName = "Mattricks", intention = intention, category = "fishing", platform = "android", status = status,
    summary = Summary(durationMs = 27 * 60_000L + 14_000, distanceM = 1840.0, frameCount = 6, gpsCount = 410),
    onDeviceMode = "on_device", heroJpegB64 = if (photo) fakePhoto(seed) else null, startedAt = 1_764_000_000_000,
    bar = bar, score = score, ladderCount = 1, witnessAsked = 2, witnessAnswered = 2, claimsBacked = 2, claimsTotal = 2,
    checks = checks, track = fakeTrack, sealedAt = System.currentTimeMillis() - 3 * 3_600_000,
    scoreReasons = listOf("The fish, the rod and the shoreline match across four shots taken 20 minutes apart."),
    cheating = cheating, cheatingSignals = if (cheating) listOf("The same photo appears twice with different timestamps.") else emptyList(),
    local = local,
)

fun fakeDetail(status: String = "sealed"): com.mattricks.verified.data.MomentDetail {
    val c = fakeCard(status = status)
    val t0 = c.startedAt
    val frames = (0 until 5).map { i ->
        com.mattricks.verified.data.Frame(
            i + 1, t0 + i * 240_000L, fakePhoto(i),
            com.mattricks.verified.chain.Check(i != 2, if (i == 2) "too dark" else "", if (i % 2 == 0) "on_device" else "cloud", if (i == 4) "fish in hand" else ""),
            witnessAsk = if (i == 3) "Show the fish next to the rod" else null,
        )
    }
    val claims = listOf(
        com.mattricks.verified.data.Claim("c1", "action", "Catch a largemouth bass"),
        com.mattricks.verified.data.Claim("c2", "place", "At Lake Mission Viejo"),
        com.mattricks.verified.data.Claim("c3", "outcome", "Release it alive"),
    )
    val reqs = listOf(
        com.mattricks.verified.data.Requirement("r1", "c1", "frames", "Photo of the fish on the line"),
        com.mattricks.verified.data.Requirement("r2", "c1", "video", "10 s clip of landing it", 10.0),
        com.mattricks.verified.data.Requirement("r3", "c2", "gps", "GPS at the lake"),
        com.mattricks.verified.data.Requirement("r4", "c3", "witness", "Show the release"),
    )
    val scores = listOf(
        com.mattricks.verified.data.ClaimScore("c1", 0.88, 0.88, listOf("r1", "r2"), emptyList(), true, listOf("video_review")),
        com.mattricks.verified.data.ClaimScore("c2", 0.93, 0.93, listOf("r3"), emptyList(), true, listOf("gps")),
        com.mattricks.verified.data.ClaimScore("c3", 0.61, 0.61, emptyList(), listOf("r4"), false, emptyList()),
    )
    return com.mattricks.verified.data.MomentDetail(
        card = c, startedAt = t0, endedAt = t0 + c.summary.durationMs, track = fakeTrack,
        motion = (0 until 300).map { t0 + it * 5_000L to (9.8f + 2f * kotlin.math.sin(it / 6.0).toFloat()) },
        frames = frames, chunkCount = 18, chainOk = true,
        judge = com.mattricks.verified.data.Opinion("consistent", 0.84, listOf("Rod, fish and shoreline match across shots."), "gemini-3.5-flash"),
        skeptic = com.mattricks.verified.data.Opinion("uncertain", 0.4, listOf("The release itself is not shown."), "gemini-3.5-flash"),
        score = com.mattricks.verified.data.Score(0.81, listOf("Four consistent shots over 20 minutes."), "gemini-3.5-flash"),
        seal = com.mattricks.verified.data.Seal(status == "sealed", mapOf("chain" to true, "timing" to true, "physics" to true, "frames" to true, "ai" to true, "cheating" to true, "bar" to (status == "sealed")), "Every claim reaches the bar."),
        feedChecks = emptyMap(), feedReason = null, judgeReasons = emptyList(),
        bar = com.mattricks.verified.data.Bar(0.74, 0.53, "Catching a specific species at a named lake is moderately hard to fake.", listOf("Named place", "Specific species"), "ai", "gemini-3.5-flash"),
        verification = com.mattricks.verified.data.Verification(
            0.81, 0.86, 0.74, true,
            listOf(com.mattricks.verified.data.LadderResult("run1", "place_time", "Place & time", 1, 0.3, true, 0.9, 0.81, 0.86, listOf("GPS matches the lake."), emptyList())),
        ),
        witness = listOf(
            com.mattricks.verified.data.WitnessItem("w1", "Show the fish next to the rod", "show", "on_device", t0 + 700_000, "frame"),
            com.mattricks.verified.data.WitnessItem("w2", "What lure are you using?", "tell", "cloud", t0 + 900_000, "voice", "A green senko"),
        ),
        sealVersion = 4, ladderEligible = true,
        v4 = com.mattricks.verified.data.V4Detail(claims, com.mattricks.verified.data.Plan(reqs, "photo", ""), null, scores, 2, false, emptyList()),
        sharedClips = listOf(com.mattricks.verified.data.SharedClip("clips/u/m/a.mp4", "a", "mp4", 14_000, true), com.mattricks.verified.data.SharedClip("clips/u/m/b.mp4", "b", "mp4", 9_000, null)),
    )
}
