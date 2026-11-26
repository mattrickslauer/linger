package com.mattricks.verified.ui

import android.provider.Settings
import android.text.format.DateUtils
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mattricks.verified.data.LatLng
import kotlin.math.cos
import kotlin.math.max

// Feed v5 (docs/superpowers/specs/2026-11-25-feed-intent-proof-result.md): every Moment reads as a thread with three
// waypoints, intent → proof → result, drawn like the GPS track it recorded. Shared by the feed slides and the
// evidence room.

/** GPS orange: the dashed track and the waypoints. */
val TrackOrange = Color(0xFFFF8A4C)
/** The seal: the one loud element. */
val SealGold = Color(0xFFE7B425)
val SealInk = Color(0xFF10242B)
/** The feed is always dark: the proof photo is the page. */
val TokBg = Color(0xFF071419)
val TokInk = Color(0xFFE8ECE4)
val TokInk2 = TokInk.copy(alpha = 0.72f)
val TokLine = TokInk.copy(alpha = 0.30f)
val TokOk = Color(0xFF8FDCAA)
val TokBad = Color(0xFFFF9A85)

enum class Wp { Intent, Proof, Result }

/** The five deterministic seal checks, in pip order. */
val CHECK_ORDER = listOf("chain" to "Chain", "timing" to "Timing", "physics" to "Physics", "frames" to "Frames", "ai" to "AI")

/** "Remove animations" / animator duration scale 0: skip the reveal and land every element in place. */
@Composable
fun rememberReduceMotion(): Boolean {
    val ctx = LocalContext.current
    return remember {
        runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
}

fun agoText(ms: Long): String =
    if (ms <= 0) "" else DateUtils.getRelativeTimeSpanString(ms, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString().lowercase()

/**
 * Draws a waypoint dot centred at [c]: hollow ring (intent), filled (proof), filled with a halo (result).
 * [ok] = false greys the track dots and turns the result dot red.
 */
fun DrawScope.waypointDot(kind: Wp, ok: Boolean, c: Offset, dot: Dp = 14.dp, hole: Color = TokBg, muted: Color = TokInk2, bad: Color = TokBad) {
    val r = dot.toPx() / 2
    val track = if (ok) TrackOrange else muted
    when (kind) {
        Wp.Intent -> {
            drawCircle(hole, r, c)
            drawCircle(track, r - 1.25.dp.toPx(), c, style = Stroke(2.5.dp.toPx()))
        }
        Wp.Proof -> drawCircle(track, r, c)
        Wp.Result -> {
            val fill = if (ok) SealGold else bad
            drawCircle(fill.copy(alpha = 0.25f), r + 4.dp.toPx(), c)
            drawCircle(fill, r, c)
        }
    }
}

/** A vertical dashed segment of the track from [fromY] down to [toY], drawn [progress] of the way. */
fun DrawScope.dashedTrack(x: Float, fromY: Float, toY: Float, color: Color, progress: Float = 1f) {
    if (progress <= 0f || toY <= fromY) return
    drawLine(
        color.copy(alpha = color.alpha * 0.85f), Offset(x, fromY), Offset(x, fromY + (toY - fromY) * progress.coerceIn(0f, 1f)),
        strokeWidth = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(7.dp.toPx(), 5.dp.toPx())),
    )
}

/** The seal stamp: gold block, dark ink, inset ring, rotated −4°; or a dashed red "Not verified". */
@Composable
fun SealStamp(ok: Boolean, modifier: Modifier = Modifier, big: Boolean = true) {
    val shape = RoundedCornerShape(7.dp)
    val fs = if (big) 24.sp else 18.sp
    val pad = if (big) Modifier.padding(horizontal = 16.dp, vertical = 11.dp) else Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
    if (ok) {
        Box(
            modifier.shadow(10.dp, shape).clip(shape).background(SealGold).drawBehind {
                val inset = 3.5.dp.toPx()
                drawRoundRect(
                    SealInk, Offset(inset, inset), Size(size.width - 2 * inset, size.height - 2 * inset),
                    CornerRadius(4.dp.toPx()), style = Stroke(1.5.dp.toPx()),
                )
            }.then(pad),
        ) { Text("Verified ✓", color = SealInk, fontSize = fs, fontWeight = FontWeight.ExtraBold, lineHeight = fs, maxLines = 1) }
    } else {
        Box(
            modifier.clip(shape).background(TokBg.copy(alpha = 0.8f)).drawBehind {
                val w = 2.5.dp.toPx()
                drawRoundRect(
                    TokBad, Offset(w / 2, w / 2), Size(size.width - w, size.height - w), CornerRadius(7.dp.toPx()),
                    style = Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx(), 5.dp.toPx()))),
                )
            }.then(pad),
        ) { Text("Not verified", color = TokBad, fontSize = fs, fontWeight = FontWeight.ExtraBold, lineHeight = fs, maxLines = 1) }
    }
}

/** Five pips Chain / Timing / Physics / Frames / AI: green dot = passed, red outline = failed. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CheckPips(checks: Map<String, Boolean>, modifier: Modifier = Modifier, ok: Color = TokOk, bad: Color = TokBad, ink: Color = TokInk, bg: Color = TokBg.copy(alpha = 0.6f)) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        CHECK_ORDER.forEach { (k, name) ->
            val passed = checks[k] == true
            Row(
                Modifier.clip(RoundedCornerShape(50)).background(bg)
                    .border(1.dp, if (passed) TokLine else bad.copy(alpha = 0.5f), RoundedCornerShape(50))
                    .padding(start = 6.dp, end = 8.dp, top = 3.dp, bottom = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(8.dp).clip(CircleShape).then(
                        if (passed) Modifier.background(ok) else Modifier.border(1.5.dp, bad, CircleShape),
                    ),
                )
                Spacer(Modifier.width(5.dp))
                Text(name, color = if (passed) ink else bad, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** The recorded track as a tiny sketch (orange line, gold end dot) in a dark box. */
@Composable
fun TrackSketch(track: List<LatLng>, modifier: Modifier = Modifier) {
    Canvas(modifier.clip(RoundedCornerShape(8.dp)).background(TokBg.copy(alpha = 0.6f)).border(1.dp, TokLine, RoundedCornerShape(8.dp))) {
        if (track.size < 2) return@Canvas
        val k = cos(Math.toRadians(track.first().lat))
        val xs = track.map { it.lng * k }; val ys = track.map { it.lat }
        val minX = xs.min(); val maxX = xs.max(); val minY = ys.min(); val maxY = ys.max()
        val span = max(max(maxX - minX, maxY - minY), 0.00005)
        val pad = 7.dp.toPx()
        val scale = (minOf(size.width, size.height) - 2 * pad) / span
        val cx = (minX + maxX) / 2; val cy = (minY + maxY) / 2
        fun p(i: Int) = Offset((size.width / 2 + (xs[i] - cx) * scale).toFloat(), (size.height / 2 - (ys[i] - cy) * scale).toFloat())
        val path = Path().apply { moveTo(p(0).x, p(0).y); for (i in 1 until track.size) lineTo(p(i).x, p(i).y) }
        drawPath(path, TrackOrange, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
        drawCircle(SealGold, 3.dp.toPx(), p(track.size - 1))
    }
}

/** 0..1 progress of [t] (ms) through the window [a, b]. */
fun seg(t: Float, a: Float, b: Float): Float = ((t - a) / (b - a)).coerceIn(0f, 1f)

/** Fade + rise in as a waypoint arrives ([p] 0..1). */
fun Modifier.arrive(p: Float): Modifier = graphicsLayer { alpha = p; translationY = (1f - p) * 8.dp.toPx() }
