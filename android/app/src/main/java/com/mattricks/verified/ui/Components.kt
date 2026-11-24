package com.mattricks.verified.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mattricks.verified.data.LatLng
import com.mattricks.verified.data.MomentCard
import java.util.Locale
import kotlin.math.cos
import kotlin.math.max

val Green = Color(0xFF0F7A4A)
val GreenDark = Color(0xFF0B5133)
val Amber = Color(0xFFB26A00)
val Red = Color(0xFFB3261E)
val GridLine = Color(0xFFE3E8E5)

val VerifiedLight = lightColorScheme(
    primary = Green, onPrimary = Color.White, primaryContainer = Color(0xFFD4F0E1), onPrimaryContainer = GreenDark,
    secondary = Color(0xFF3D5A4C), background = Color(0xFFF7F9F8), surface = Color.White,
    surfaceVariant = Color(0xFFEFF3F1),
)
val VerifiedDark = darkColorScheme(primary = Color(0xFF6FD3A0), primaryContainer = GreenDark)

@Composable
fun VerifiedTheme(dark: Boolean, content: @Composable () -> Unit) =
    MaterialTheme(colorScheme = if (dark) VerifiedDark else VerifiedLight, content = content)

fun decodeB64(b64: String?): Bitmap? = b64?.takeIf { it.isNotEmpty() }?.let {
    runCatching { Base64.decode(it, Base64.DEFAULT).let { b -> BitmapFactory.decodeByteArray(b, 0, b.size) } }.getOrNull()
}

@Composable
fun B64Image(b64: String?, modifier: Modifier = Modifier) {
    val bmp = remember(b64) { decodeB64(b64)?.asImageBitmap() }
    if (bmp != null) Image(bmp, null, modifier, contentScale = ContentScale.Crop)
    else Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        Text("No frame", color = Color.Gray, fontSize = 12.sp)
    }
}

fun fmtDuration(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
    else String.format(Locale.US, "%d:%02d", s / 60, s % 60)
}

fun fmtDistance(m: Double): String = if (m >= 1000) String.format(Locale.US, "%.2f km", m / 1000) else "${m.toInt()} m"

@Composable
fun Pill(text: String, bg: Color, fg: Color = Color.White) {
    Surface(color = bg, shape = RoundedCornerShape(50)) {
        Text(text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    }
}

@Composable
fun StatusBadge(status: String) = when (status) {
    "sealed" -> Pill("Verified ✓", Green)
    "rejected" -> Pill("Not verified", Red)
    "submitted" -> Pill("Sealing…", Amber)
    else -> Pill("Recording", Color.DarkGray)
}

fun onDeviceLabel(mode: String) = when (mode) {
    "on_device" -> "checked on-device"
    "cloud" -> "checked in the cloud (no on-device model)"
    else -> "not checked live"
}

@Composable
fun MomentCardView(c: MomentCard, onDelete: (() -> Unit)? = null, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        if (c.heroJpegB64 != null) B64Image(c.heroJpegB64, Modifier.fillMaxWidth().aspectRatio(16f / 10f))
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.intention, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                StatusBadge(c.status)
            }
            Spacer(Modifier.height(4.dp))
            Text(c.ownerName.ifBlank { "Someone" } + " · " + c.category, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            Spacer(Modifier.height(6.dp))
            Text(
                "${fmtDuration(c.summary.durationMs)} · ${fmtDistance(c.summary.distanceM)} · ${c.summary.frameCount} frames",
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Pill(c.platform.ifBlank { "android" }, MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
                Pill(onDeviceLabel(c.onDeviceMode), MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
                if (c.pendingWrites) Pill("Offline · queued", Amber)
                if (onDelete != null) {
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onDelete) { Text("Delete", color = Red) }
                }
            }
        }
    }
}

/** GPS track on a light grid, equirectangular projection fitted to the box. No Maps API key needed. */
@Composable
fun TrackCanvas(track: List<LatLng>, modifier: Modifier = Modifier, live: Boolean = false) {
    Canvas(modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xFFF4F7F5))) {
        val step = 24.dp.toPx()
        var x = 0f; while (x < size.width) { drawLine(GridLine, Offset(x, 0f), Offset(x, size.height)); x += step }
        var y = 0f; while (y < size.height) { drawLine(GridLine, Offset(0f, y), Offset(size.width, y)); y += step }
        if (track.isEmpty()) return@Canvas
        val k = cos(Math.toRadians(track.first().lat))
        val xs = track.map { it.lng * k }; val ys = track.map { it.lat }
        val minX = xs.min(); val maxX = xs.max(); val minY = ys.min(); val maxY = ys.max()
        val span = max(max(maxX - minX, maxY - minY), 0.00005) // ~5 m minimum so a still point is centred
        val pad = 20.dp.toPx()
        val scale = (minOf(size.width, size.height) - 2 * pad) / span
        val cx = (minX + maxX) / 2; val cy = (minY + maxY) / 2
        fun p(i: Int) = Offset((size.width / 2 + (xs[i] - cx) * scale).toFloat(), (size.height / 2 - (ys[i] - cy) * scale).toFloat())
        if (track.size > 1) {
            val path = Path().apply { moveTo(p(0).x, p(0).y); for (i in 1 until track.size) lineTo(p(i).x, p(i).y) }
            drawPath(path, Green, style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round))
        }
        drawCircle(Color.White, 7.dp.toPx(), p(0)); drawCircle(GreenDark, 5.dp.toPx(), p(0))
        val last = p(track.size - 1)
        if (live) drawCircle(Color(0x332E7DF6), 14.dp.toPx(), last)
        drawCircle(Color.White, 7.dp.toPx(), last); drawCircle(if (live) Color(0xFF2E7DF6) else Red, 5.dp.toPx(), last)
    }
}

@Composable
fun Sparkline(values: List<Float>, modifier: Modifier = Modifier, color: Color = Green) {
    Canvas(modifier) {
        if (values.size < 2) return@Canvas
        val mn = values.min(); val mx = max(values.max(), mn + 0.5f)
        val dx = size.width / (values.size - 1)
        val path = Path()
        values.forEachIndexed { i, v ->
            val px = i * dx; val py = size.height - (v - mn) / (mx - mn) * size.height
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        drawPath(path, color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
    }
}

/** Motion magnitude over time with frame markers. */
@Composable
fun MotionChart(motion: List<Pair<Long, Float>>, frameTimes: List<Long>, modifier: Modifier = Modifier) {
    Canvas(modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xFFF4F7F5))) {
        for (i in 1..3) { val y = size.height * i / 4; drawLine(GridLine, Offset(0f, y), Offset(size.width, y)) }
        if (motion.size < 2) return@Canvas
        val t0 = motion.first().first; val t1 = max(motion.last().first, t0 + 1)
        // downsample to ~2 points per px column
        val stride = max(1, motion.size / (size.width.toInt() * 2).coerceAtLeast(1))
        val pts = motion.filterIndexed { i, _ -> i % stride == 0 }
        val mn = pts.minOf { it.second }; val mx = max(pts.maxOf { it.second }, mn + 0.5f)
        fun x(t: Long) = ((t - t0).toFloat() / (t1 - t0)) * size.width
        frameTimes.forEach { ft -> if (ft in t0..t1) drawLine(Amber, Offset(x(ft), 0f), Offset(x(ft), size.height), strokeWidth = 2.dp.toPx()) }
        val path = Path()
        pts.forEachIndexed { i, (t, v) ->
            val px = x(t); val py = size.height - 6f - (v - mn) / (mx - mn) * (size.height - 12f)
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        drawPath(path, Green, style = Stroke(width = 1.5.dp.toPx()))
    }
}

/** Owner-only delete confirmation; wording is the shared contract (docs/ARCHITECTURE.md "Deleting a Moment"). */
@Composable
fun DeleteMomentDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete this Moment?") },
        text = { Text("Its recording, proof shots and feed entry are removed for good.") },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Delete", color = Red) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Delete is offered only for the signed-in user's own Moment, and never for the one being recorded right now. */
fun canDeleteMoment(c: MomentCard, uid: String?, recordingId: String?): Boolean =
    uid != null && c.ownerUid.isNotEmpty() && c.ownerUid == uid && c.id != recordingId
