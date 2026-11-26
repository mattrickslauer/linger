package com.mattricks.verified.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mattricks.verified.data.Claim
import com.mattricks.verified.data.ClaimScore
import com.mattricks.verified.data.Ladder
import com.mattricks.verified.data.MomentDetail
import com.mattricks.verified.data.Requirement
import com.mattricks.verified.data.V3Math
import com.mattricks.verified.data.V4Detail
import com.mattricks.verified.data.sourceLabel

/** v4 Moment (server claims present, not sealed by v3 functions). v3 Moments keep the v3 detail and v3 ladder math. */
fun isV4(d: MomentDetail): Boolean = d.v4?.claims?.isNotEmpty() == true && (d.sealVersion == 0 || d.sealVersion >= 4)

fun barOf(d: MomentDetail): Double? = d.verification?.bar?.takeIf { it > 0 } ?: d.bar?.value

/** v4.11 detail top: Verified ✓ / Not verified, "score 0.52 · bar 0.52", "2/2 claims backed"; cheating banner below. */
@Composable
fun VerdictHeader(d: MomentDetail) {
    val v4 = d.v4 ?: return
    val bar = barOf(d)
    val sealed = d.card.status == "sealed"
    val rejected = d.card.status == "rejected"
    val score = d.verification?.score ?: v4.claimScores.takeIf { it.isNotEmpty() }?.minOf { it.p }
    val backed = v4.claimsBacked ?: bar?.let { b -> v4.claimScores.count { it.p >= b } }
    val total = v4.claims.size
    val (title, color) = when {
        sealed -> "Verified ✓" to Ok
        rejected -> "Not verified" to Bad
        else -> "Sealing…" to Warn
    }
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.10f))) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = color, modifier = Modifier.weight(1f))
                if (backed != null && (sealed || rejected)) Pill("$backed/$total claims backed", color)
            }
            if (score != null && bar != null && (sealed || rejected)) {
                Text("score ${V3Math.fmt(score)} · bar ${V3Math.fmt(bar)}", fontWeight = FontWeight.SemiBold)
                BarMeter(score, bar, Modifier.fillMaxWidth())
            } else {
                Text(sealingWords(d), color = Color.Gray, style = MaterialTheme.typography.bodySmall)
            }
            if (v4.cheatingDetected) CheatingBanner(v4.cheatingSignals)
        }
    }
}

/** What the seal is waiting for, in the v4.11 words. */
fun sealingWords(d: MomentDetail): String {
    val vr = d.v4?.videoReview
    return when {
        d.card.status == "recording" && d.videos.isNotEmpty() -> "Uploading video — the Moment is submitted once the clip is up."
        vr?.status == "waiting" -> "Waiting for video upload"
        vr?.status == "running" -> "Reviewing video"
        d.judge == null -> "Judge, skeptic + scorer run in the cloud, then the seal is computed."
        else -> "The Cloud Function is sealing this Moment."
    }
}

@Composable
fun CheatingBanner(signals: List<String>) {
    Surface(shape = RoundedCornerShape(12.dp), color = Bad) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Warning, null, tint = Color.White, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Cheating detected", color = Color.White, fontWeight = FontWeight.Bold)
            }
            signals.forEach { Text("• $it", color = Color.White, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

/** The free video review (v4.4) in the v4.11 words. */
@Composable
fun VideoReviewCard(d: MomentDetail) {
    val vr = d.v4?.videoReview
    if (vr == null && d.videos.isEmpty()) return
    if (vr?.status == "none") return
    val (line, color) = when (vr?.status) {
        // No review state yet: still uploading (Moment `recording`), else submitted after the upload, review not started.
        null -> (if (d.card.status == "recording") "Uploading video" else "Video uploaded") to Warn
        "waiting" -> "Waiting for video upload" to Warn
        "running" -> "Reviewing video" to Warn
        "done" -> "Video reviewed" to Ok
        "failed" -> "The video review failed · sealed without it" to Warn
        "expired" -> "Video never arrived · sealed without it" to Warn
        else -> vr.status to Color.Gray
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Video review", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Pill("free · cloud", MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (vr?.status == "running" || vr?.status == "waiting" || vr == null) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp))
                }
                Text(line, color = color, fontWeight = FontWeight.SemiBold)
            }
            if (d.card.status == "recording" && d.videos.isNotEmpty()) VideoUploadLine(d.card.id)
            (vr?.summary?.takeIf { it.isNotBlank() } ?: d.v4?.videoSummary)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            vr?.clips?.takeIf { it.isNotEmpty() }?.let { clips ->
                Text(
                    clips.joinToString(" · ") { c ->
                        "${fmtDuration(c.durationMs)} " + when {
                            !c.uploaded -> "not uploaded"
                            c.hashOk == false -> "hash mismatch"
                            c.hashOk == true -> "hash ✓"
                            else -> "uploaded"
                        }
                    },
                    fontSize = 11.sp, color = Color.Gray,
                )
            }
            vr?.model?.let { Text("$it · in the cloud", fontSize = 11.sp, color = Color.Gray) }
        }
    }
}

/**
 * One row per claim (v4.11): `clapping ✓ backed by video review` or `50 claps · 0.40 / bar 0.52`, its requirements
 * `✓ met` / `○ not met`, and [extra] below (the modules that can still back it, step 5).
 */
@Composable
fun ClaimsSection(d: MomentDetail, extra: @Composable (Claim, ClaimScore?) -> Unit = { _, _ -> }) {
    val v4 = d.v4 ?: return
    val bar = barOf(d)
    Text("Claims", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            v4.claims.forEachIndexed { i, c ->
                if (i > 0) HorizontalDivider()
                ClaimRow(c, v4.claimScores.firstOrNull { it.id == c.id }, bar, v4, extra)
            }
            if (v4.plan?.source == "default" || v4.plan == null) Text(
                "Evidence plan set by the server.", fontSize = 11.sp, color = Color.Gray,
            )
        }
    }
}

@Composable
private fun ClaimRow(c: Claim, s: ClaimScore?, bar: Double?, v4: V4Detail, extra: @Composable (Claim, ClaimScore?) -> Unit) {
    val backed = s != null && bar != null && s.p >= bar
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(c.text, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(8.dp))
            when {
                s == null -> Text("· pending", color = Color.Gray)
                backed -> Text(
                    "✓ backed by " + s.backedBy.map { sourceLabel(it, ::moduleTitle) }.ifEmpty { listOf("the minimum evidence") }.joinToString(" · "),
                    color = Ok, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                )
                else -> Text("· ${V3Math.fmt(s.p)} / bar ${bar?.let(V3Math::fmt) ?: "–"}", color = Warn, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            }
        }
        Text(c.kind, fontSize = 11.sp, color = Color.Gray)
        val reqs = v4.plan?.requirements.orEmpty().filter { it.claimId == c.id }
        reqs.forEach { r -> RequirementLine(r, metOf(r, s, v4)) }
        if (reqs.isEmpty()) Text("No minimum evidence for this claim — it can't earn the bar for free.", fontSize = 12.sp, color = Color.Gray)
        extra(c, s)
    }
}

/** true met · false not met · null not decided yet (no seal). */
private fun metOf(r: Requirement, s: ClaimScore?, v4: V4Detail): Boolean? = when {
    s != null && r.id in s.met -> true
    s != null && r.id in s.unmet -> false
    r.id in v4.feedMet -> v4.feedMet[r.id]
    else -> null
}

@Composable
private fun RequirementLine(r: Requirement, met: Boolean?) {
    Row(verticalAlignment = Alignment.Top) {
        Text(
            when (met) { true -> "✓"; false -> "○"; null -> "·" },
            color = when (met) { true -> Ok; false -> Warn; null -> Color.Gray }, fontWeight = FontWeight.Bold, modifier = Modifier.width(20.dp),
        )
        Icon(evidenceIcon(r.evidence), null, Modifier.size(14.dp).padding(top = 2.dp), tint = Color.Gray)
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f)) {
            Text(r.ask, style = MaterialTheme.typography.bodySmall)
            Text(
                when (met) { true -> "met"; false -> "not met"; null -> "checked when sealed" } + (r.minSeconds?.let { " · ≥ ${fmtNum(it)} s" } ?: ""),
                fontSize = 11.sp, color = Color.Gray,
            )
        }
    }
}

fun moduleTitle(id: String): String? = Ladder.modules.firstOrNull { it.id == id }?.title
