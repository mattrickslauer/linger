package com.mattricks.verified.ui

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.DirectionsRun
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Stairs
import androidx.compose.material.icons.filled.Straighten
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Toll
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

// ───────────────────────── one visual vocabulary (spec "One visual vocabulary on every platform")

/** Same glyph = same meaning on every screen (and on web / iOS). */
object Glyph {
    val Intent = Icons.Filled.FormatQuote
    val Proof = Icons.Filled.PhotoCamera
    val Result = Icons.Filled.Verified
    val Chain = Icons.Filled.Link
    val Timing = Icons.Filled.Schedule
    val Physics = Icons.Filled.Speed
    val Frames = Icons.Filled.PhotoLibrary
    val Ai = Icons.Filled.AutoAwesome
    val Witness = Icons.Filled.Visibility
    val Place = Icons.Filled.Place
    val Motion = Icons.Filled.GraphicEq
    val Ladder = Icons.Filled.Stairs
    val Credits = Icons.Filled.Toll
    val OnDevice = Icons.Filled.Smartphone
    val Cloud = Icons.Filled.Cloud
    val Time = Icons.Filled.Timer
    val Distance = Icons.Filled.Straighten
    val Video = Icons.Filled.Videocam
    val Warning = Icons.Filled.Warning
}

fun checkGlyph(key: String): ImageVector = when (key) {
    "chain" -> Glyph.Chain
    "timing" -> Glyph.Timing
    "physics" -> Glyph.Physics
    "frames" -> Glyph.Frames
    "ai" -> Glyph.Ai
    "cheating" -> Glyph.Warning
    "bar" -> Glyph.Ladder
    else -> Glyph.Result
}

/** v4 claim kinds (action / count / measure / place / time / object / outcome). */
fun claimGlyph(kind: String): ImageVector = when (kind) {
    "action" -> Icons.AutoMirrored.Filled.DirectionsRun
    "count" -> Icons.Filled.Tag
    "measure" -> Icons.Filled.Straighten
    "place" -> Glyph.Place
    "time" -> Glyph.Timing
    "object" -> Icons.Filled.Category
    "outcome" -> Icons.Filled.EmojiEvents
    else -> Glyph.Intent
}

fun pct(p: Double) = "${(p * 100).roundToInt()}%"

// ───────────────────────── score ring

/**
 * P(true) as an arc with the big % in the middle and a tick on the ring at the AI-set [bar]. Gold if it reaches the
 * bar, bad if below, ink-2 while pending ([p] null: only the tick). [centerText] overrides the middle text (bar previews).
 */
@Composable
fun ScoreRing(
    p: Double?, bar: Double?, modifier: Modifier = Modifier, size: Dp = 64.dp, onMedia: Boolean = false,
    centerText: String? = null, caption: String? = null,
) {
    val v = LocalV.current
    val ink = if (onMedia) TokInk else MaterialTheme.colorScheme.onSurface
    val trackC = if (onMedia) TokInk.copy(alpha = 0.22f) else MaterialTheme.colorScheme.outlineVariant
    val reaches = p != null && (bar == null || p >= bar)
    val arc = when {
        p == null -> if (onMedia) TokInk2 else v.ink2
        reaches -> SealGold
        else -> if (onMedia) TokBad else v.bad
    }
    val desc = buildString {
        if (p != null) append("${pct(p)} likely true") else append("Not scored yet")
        if (bar != null) {
            append(", bar ${pct(bar)}")
            if (p != null) append(if (reaches) ", reaches the bar" else ", below the bar")
        }
    }
    val density = LocalDensity.current
    val big = with(density) { (size * if (caption != null) 0.28f else 0.32f).toSp() }
    val small = with(density) { (size * 0.15f).toSp() }
    Box(modifier.size(size).clearAndSetSemantics { contentDescription = desc }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val sw = this.size.minDimension * 0.1f
            val r = (this.size.minDimension - sw) / 2 - 2.dp.toPx()
            val tl = Offset(center.x - r, center.y - r)
            drawCircle(trackC, r, center, style = Stroke(sw))
            if (p != null) drawArc(
                arc, -90f, (360f * p.coerceIn(0.0, 1.0)).toFloat().coerceAtLeast(2f), false, tl, Size(2 * r, 2 * r),
                style = Stroke(sw, cap = StrokeCap.Round),
            )
            if (bar != null) {
                val a = Math.toRadians(-90.0 + 360.0 * bar.coerceIn(0.0, 1.0))
                val inner = r - sw / 2 - 2.dp.toPx(); val outer = r + sw / 2 + 2.dp.toPx()
                val c = cos(a).toFloat(); val s = sin(a).toFloat()
                if (onMedia) drawLine(MediaBg, Offset(center.x + c * inner, center.y + s * inner), Offset(center.x + c * outer, center.y + s * outer), 5.dp.toPx(), StrokeCap.Round)
                drawLine(ink, Offset(center.x + c * inner, center.y + s * inner), Offset(center.x + c * outer, center.y + s * outer), 2.5.dp.toPx(), StrokeCap.Round)
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                centerText ?: p?.let { "${(it * 100).roundToInt()}" } ?: "–",
                color = ink, fontSize = big, lineHeight = big, fontWeight = FontWeight.ExtraBold, style = Tnum, maxLines = 1,
            )
            val cap = caption ?: if (centerText == null && p != null) "%" else null
            if (cap != null) Text(cap, color = ink.copy(alpha = 0.7f), fontSize = small, lineHeight = small, maxLines = 1)
        }
    }
}

// ───────────────────────── check pips

/** The five deterministic seal checks, as glyph pips. Filled ok = passed, red ring = failed, grey = pending. */
@Composable
fun CheckPips(
    checks: Map<String, Boolean>, modifier: Modifier = Modifier, onMedia: Boolean = false, labels: Boolean = false,
    pip: Dp = 26.dp, keys: List<Pair<String, String>> = CHECK_ORDER,
) {
    val v = LocalV.current
    val okC = if (onMedia) TokOk else v.ok
    val badC = if (onMedia) TokBad else v.bad
    val pending = if (onMedia) TokInk2 else MaterialTheme.colorScheme.outline
    val passedN = keys.count { checks[it.first] == true }
    Row(
        modifier.semantics(mergeDescendants = true) {
            contentDescription = if (checks.isEmpty()) "Seal checks pending" else "$passedN of ${keys.size} seal checks passed"
        },
        horizontalArrangement = Arrangement.spacedBy(if (labels) 4.dp else 6.dp),
    ) {
        keys.forEach { (k, name) ->
            val state = checks[k]
            val desc = "$name check " + when (state) { true -> "passed"; false -> "failed"; null -> "pending" }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = (if (labels) Modifier.width(56.dp) else Modifier).semantics { contentDescription = desc },
            ) {
                Box(
                    Modifier.size(pip).clip(CircleShape).then(
                        when (state) {
                            true -> Modifier.background(okC)
                            false -> Modifier.background(if (onMedia) MediaBg.copy(alpha = 0.6f) else Color.Transparent).border(1.5.dp, badC, CircleShape)
                            null -> Modifier.border(1.5.dp, pending.copy(alpha = 0.6f), CircleShape)
                        },
                    ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        checkGlyph(k), null, Modifier.size(pip * 0.56f),
                        tint = when (state) { true -> if (okC.luminance() > 0.4f) MediaBg else Color.White; false -> badC; null -> pending },
                    )
                }
                if (labels) Text(
                    name, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = when (state) { false -> badC; else -> if (onMedia) TokInk2 else v.ink2 },
                    modifier = Modifier.padding(top = 3.dp),
                )
            }
        }
    }
}

// ───────────────────────── chips, badges, stats

/** A pill on a scrim, for overlays on photos, video and maps. */
@Composable
fun ScrimChip(modifier: Modifier = Modifier, color: Color = MediaBg.copy(alpha = 0.62f), content: @Composable () -> Unit) {
    Surface(modifier, color = color, shape = RoundedCornerShape(50), contentColor = TokInk) {
        Box(Modifier.padding(horizontal = 10.dp, vertical = 5.dp)) { content() }
    }
}

/** Glyph + number (+ ≤ 2-word label). Numbers in tabular figures. */
@Composable
fun StatOverlay(
    icon: ImageVector, value: String, label: String? = null, modifier: Modifier = Modifier,
    tint: Color = TokInk, sub: Color = TokInk2, big: Boolean = false,
) {
    Row(modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(if (big) 18.dp else 15.dp), tint = sub)
        Spacer(Modifier.width(5.dp))
        Text(
            value, color = tint, fontSize = if (big) 18.sp else 14.sp, fontWeight = FontWeight.Bold, style = Tnum.merge(TextStyle(shadow = null)),
            maxLines = 1, softWrap = false,
        )
        if (label != null) {
            Spacer(Modifier.width(4.dp))
            Text(label, color = sub, fontSize = 12.sp, maxLines = 1)
        }
    }
}

/** Glyph + ≤ 2 words on a solid fill. Text colour follows the fill so it holds AA in both themes. */
@Composable
fun GlyphPill(icon: ImageVector?, text: String, bg: Color, modifier: Modifier = Modifier, fg: Color = contentOn(bg)) {
    Surface(modifier, color = bg, shape = RoundedCornerShape(50)) {
        Row(Modifier.padding(start = if (icon != null) 8.dp else 10.dp, end = 10.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) { Icon(icon, null, Modifier.size(14.dp), tint = fg); Spacer(Modifier.width(4.dp)) }
            Text(text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, style = Tnum)
        }
    }
}

/** Ink on light fills, white on dark ones. */
fun contentOn(bg: Color): Color = if (bg.luminance() > 0.45f) LightV.ink else Color.White

/** Moment status as a glyph pill: Verified (gold) / Not verified / Sealing / Recording / On phone / Cheating. */
@Composable
fun StatusBadge(status: String, local: Boolean = false, cheating: Boolean = false, modifier: Modifier = Modifier) = when {
    local && status == "recording" -> GlyphPill(Icons.Filled.FiberManualRecord, "Recording", FillInk, modifier)
    local -> GlyphPill(Glyph.OnDevice, "On phone", FillInk, modifier)
    cheating -> GlyphPill(Glyph.Warning, "Cheating", FillBad, modifier)
    status == "sealed" -> GlyphPill(Glyph.Result, "Verified", SealGold, modifier, fg = SealInk)
    status == "rejected" -> GlyphPill(Icons.Filled.Block, "Not verified", FillBad, modifier)
    status == "submitted" -> GlyphPill(Icons.Filled.HourglassTop, "Sealing", FillLake, modifier)
    else -> GlyphPill(Icons.Filled.FiberManualRecord, "Recording", FillInk, modifier)
}

/** Hybrid AI made visible: "on device" (Gemini Nano) or "cloud". */
@Composable
fun HybridBadge(mode: String, modifier: Modifier = Modifier, onMedia: Boolean = false) {
    val (icon, text) = when (mode) {
        "on_device" -> Glyph.OnDevice to "on device"
        "cloud" -> Glyph.Cloud to "cloud"
        "mixed" -> Glyph.OnDevice to "device + cloud"
        else -> Icons.Filled.CloudOff to "not checked"
    }
    val bg = if (onMedia) MediaBg.copy(alpha = 0.62f) else MaterialTheme.colorScheme.secondaryContainer
    val fg = if (onMedia) TokInk else MaterialTheme.colorScheme.onSecondaryContainer
    Surface(modifier.semantics(mergeDescendants = true) { contentDescription = "Checked $text" }, color = bg, shape = RoundedCornerShape(50)) {
        Row(Modifier.padding(start = 7.dp, end = 9.dp, top = 3.dp, bottom = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(13.dp), tint = fg)
            Spacer(Modifier.width(4.dp))
            Text(text, color = fg, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** A big glyph, a title and one line: intro pages, sign-in value props, empty states. */
@Composable
fun GlyphTile(icon: ImageVector, title: String, line: String, modifier: Modifier = Modifier, tint: Color = Lake, container: Color = MaterialTheme.colorScheme.surfaceContainerHigh, ink: Color = MaterialTheme.colorScheme.onSurface, sub: Color = Ink2) {
    Surface(modifier, color = container, shape = RoundedCornerShape(20.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(tint.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(22.dp), tint = tint)
            }
            Text(title, color = ink, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1)
            Text(line, color = sub, fontSize = 13.sp, lineHeight = 17.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Visual empty / error state: glyph, one line, one action. */
@Composable
fun EmptyState(icon: ImageVector, line: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(34.dp), tint = Lake)
        }
        Text(line, textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
        action?.invoke()
    }
}

/** Shimmer-free skeleton block (static tone; motion only where it means something). */
@Composable
fun Skeleton(modifier: Modifier) = Box(modifier.clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh))

// ───────────────────────── prose behind a tap

/** Long explanations live here, not on the page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InfoSheet(title: String, onDismiss: () -> Unit, icon: ImageVector? = null, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) { Icon(icon, null, tint = Lake); Spacer(Modifier.width(10.dp)) }
                Text(title, style = MaterialTheme.typography.titleLarge)
            }
            content()
        }
    }
}

/** An (i) button (48dp target) that opens an [InfoSheet]. */
@Composable
fun InfoButton(title: String, modifier: Modifier = Modifier, tint: Color = Ink2, content: @Composable ColumnScope.() -> Unit) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }, modifier) { Icon(Icons.Filled.Info, "About: $title", tint = tint) }
    if (open) InfoSheet(title, { open = false }, content = content)
}

@Composable
fun Bullet(text: String, color: Color = MaterialTheme.colorScheme.onSurface) = Row {
    Text("•", color = Ink2, modifier = Modifier.width(16.dp))
    Text(text, style = MaterialTheme.typography.bodyMedium, color = color)
}

// ───────────────────────── ladder preview bar

/**
 * One module's outcome on one 0..1 track: the dot is the score now, the green chevron where a pass lands, the red one
 * where a fail lands, the tick the bar. Numbers under it: "0.62 → 0.79 ↑ / 0.50 ↓".
 */
@Composable
fun PreviewBar(now: Double, up: Double, down: Double, bar: Double?, modifier: Modifier = Modifier) {
    val v = LocalV.current
    val trackC = MaterialTheme.colorScheme.outlineVariant
    val ink = MaterialTheme.colorScheme.onSurface
    Column(modifier.semantics(mergeDescendants = true) {
        contentDescription = "Now ${pct(now)}; if it passes ${pct(up)}, if it fails ${pct(down)}" + (bar?.let { ", bar ${pct(it)}" } ?: "")
    }) {
        Canvas(Modifier.fillMaxWidth().height(22.dp)) {
            val h = 6.dp.toPx(); val y = size.height / 2
            fun x(p: Double) = (size.width * p.coerceIn(0.0, 1.0)).toFloat()
            drawLine(trackC, Offset(0f, y), Offset(size.width, y), h, StrokeCap.Round)
            drawLine(v.bad.copy(alpha = 0.55f), Offset(x(down), y), Offset(x(now), y), h, StrokeCap.Round)
            drawLine(v.ok.copy(alpha = 0.7f), Offset(x(now), y), Offset(x(up), y), h, StrokeCap.Round)
            bar?.let { drawLine(ink, Offset(x(it), 1.dp.toPx()), Offset(x(it), size.height - 1.dp.toPx()), 2.dp.toPx(), StrokeCap.Round) }
            fun chevron(px: Float, c: Color, right: Boolean) {
                val s = 6.dp.toPx(); val d = if (right) 1 else -1
                drawPath(Path().apply { moveTo(px - d * s * 0.6f, y - s); lineTo(px + d * s * 0.6f, y); lineTo(px - d * s * 0.6f, y + s); close() }, c)
            }
            chevron(x(up), v.ok, true); chevron(x(down), v.bad, false)
            drawCircle(ink, 5.dp.toPx(), Offset(x(now), y))
        }
        Text(
            "${com.mattricks.verified.data.V3Math.fmt(now)} → ${com.mattricks.verified.data.V3Math.fmt(up)} ↑ / ${com.mattricks.verified.data.V3Math.fmt(down)} ↓",
            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, style = Tnum, color = Ink2,
        )
    }
}

// ───────────────────────── haptics

/** Record start / proof shot: a confirm tick. */
fun View.hapticConfirm() {
    performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS)
}

/** Record stop / finish: a heavier click. */
fun View.hapticStop() {
    performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS)
}
