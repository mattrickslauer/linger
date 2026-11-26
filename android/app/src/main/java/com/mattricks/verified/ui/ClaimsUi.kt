package com.mattricks.verified.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mattricks.verified.data.Claim
import com.mattricks.verified.data.ClaimScore
import com.mattricks.verified.data.Ladder
import com.mattricks.verified.data.MomentDetail
import com.mattricks.verified.data.Requirement
import com.mattricks.verified.data.V3Math
import com.mattricks.verified.data.V4Detail
import com.mattricks.verified.data.evidenceLabel
import com.mattricks.verified.data.sourceLabel

/** v4 Moment (server claims present, not sealed by v3 functions). v3 Moments keep the v3 detail and v3 ladder math. */
fun isV4(d: MomentDetail): Boolean = d.v4?.claims?.isNotEmpty() == true && (d.sealVersion == 0 || d.sealVersion >= 4)

fun barOf(d: MomentDetail): Double? = d.verification?.bar?.takeIf { it > 0 } ?: d.bar?.value

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
    Surface(shape = RoundedCornerShape(14.dp), color = FillBad) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Glyph.Warning, null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Cheating detected", color = androidx.compose.ui.graphics.Color.White, fontWeight = FontWeight.Bold)
            }
            signals.forEach { Text("• $it", color = androidx.compose.ui.graphics.Color.White, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

/** The free video review (v4.4): one compact row; summary, clips and model behind a tap. */
@Composable
fun VideoReviewCard(d: MomentDetail) {
    val vr = d.v4?.videoReview
    if (vr == null && d.videos.isEmpty()) return
    if (vr?.status == "none") return
    var open by remember { mutableStateOf(false) }
    val (line, tint) = when (vr?.status) {
        // No review state yet: still uploading (Moment `recording`), else submitted after the upload, review not started.
        null -> (if (d.card.status == "recording") "Uploading video" else "Video uploaded") to Warn
        "waiting" -> "Waiting for upload" to Warn
        "running" -> "Reviewing video" to Warn
        "done" -> "Video reviewed" to Ok
        "failed" -> "Review failed · sealed without it" to Warn
        "expired" -> "Never arrived · sealed without it" to Warn
        else -> vr.status to Ink2
    }
    val summary = vr?.summary?.takeIf { it.isNotBlank() } ?: d.v4?.videoSummary
    Surface(onClick = { open = true }, color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Glyph.Video, null, tint = Lake)
                Spacer(Modifier.width(8.dp))
                if (vr?.status == "running" || vr?.status == "waiting" || vr == null) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Spacer(Modifier.width(6.dp))
                } else Icon(if (vr.status == "done") Icons.Filled.CheckCircle else Glyph.Warning, null, Modifier.size(16.dp).padding(end = 2.dp), tint = tint)
                Text(line, color = tint, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                GlyphPill(null, "free", FillOk)
                Spacer(Modifier.width(4.dp))
                HybridBadge("cloud")
            }
            if (d.card.status == "recording" && d.videos.isNotEmpty()) VideoUploadLine(d.card.id)
            summary?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Ink2, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
    }
    if (open) InfoSheet("Video review", { open = false }, icon = Glyph.Video) {
        Text(line, color = tint, fontWeight = FontWeight.SemiBold)
        summary?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        vr?.clips?.forEach { c ->
            Bullet(
                "${fmtDuration(c.durationMs)} · " + when {
                    !c.uploaded -> "not uploaded"
                    c.hashOk == false -> "hash mismatch"
                    c.hashOk == true -> "hash ✓"
                    else -> "uploaded"
                },
            )
        }
        vr?.model?.let { Text("$it · in the cloud", style = MaterialTheme.typography.labelSmall, color = Ink2) }
    }
}

/**
 * One row per claim (v4.11): kind glyph, the claim, its score against the bar, its minimum evidence as glyph pips
 * (filled = met, amber ring = not met, grey = decided at the seal). Tap for the words and [extra] (the modules that can
 * still back it, step 5).
 */
@Composable
fun ClaimsSection(d: MomentDetail, extra: @Composable (Claim, ClaimScore?) -> Unit = { _, _ -> }) {
    val v4 = d.v4 ?: return
    val bar = barOf(d)
    val backedN = bar?.let { b -> v4.claimScores.count { it.p >= b } }
    BlockTitle(Glyph.Result, "Claims") { backedN?.let { Text("$it/${v4.claims.size}", style = Tnum.merge(MaterialTheme.typography.titleMedium), color = Ink2) } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        v4.claims.forEach { c -> ClaimRow(c, v4.claimScores.firstOrNull { it.id == c.id }, bar, v4, extra) }
        if (v4.plan?.source == "default" || v4.plan == null) Text("Evidence plan set by the server.", style = MaterialTheme.typography.labelSmall, color = Ink2)
    }
}

@Composable
private fun ClaimRow(c: Claim, s: ClaimScore?, bar: Double?, v4: V4Detail, extra: @Composable (Claim, ClaimScore?) -> Unit) {
    val backed = s != null && bar != null && s.p >= bar
    val reqs = v4.plan?.requirements.orEmpty().filter { it.claimId == c.id }
    var open by remember { mutableStateOf(false) }
    val state = when { s == null -> "pending"; backed -> "backed"; else -> "below the bar" }
    Surface(
        onClick = { open = true }, color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${c.text}: $state" + (s?.let { ", ${V3Math.fmt(it.p)}" } ?: "") },
    ) {
        Row(Modifier.padding(12.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
                Icon(claimGlyph(c.kind), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(c.text, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                    reqs.forEach { r -> ReqPip(r, metOf(r, s, v4)) }
                    if (s != null && bar != null) {
                        Spacer(Modifier.width(4.dp))
                        BarMeter(s.p, bar, Modifier.weight(1f), height = 6.dp)
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            when {
                s == null -> Text("…", color = Ink2)
                backed -> Icon(Icons.Filled.CheckCircle, "backed", tint = Ok)
                else -> Text(V3Math.fmt(s.p), style = Tnum.merge(MaterialTheme.typography.labelLarge), color = Warn)
            }
            Icon(Icons.Filled.ChevronRight, null, tint = Ink2)
        }
    }
    if (open) InfoSheet(c.text, { open = false }, icon = claimGlyph(c.kind)) {
        Text(c.kind, style = MaterialTheme.typography.labelLarge, color = Ink2)
        when {
            s == null -> Text("Pending: scored when sealed.", color = Ink2)
            backed -> Text(
                "Backed by " + s.backedBy.map { sourceLabel(it, ::moduleTitle) }.ifEmpty { listOf("the minimum evidence") }.joinToString(" · "),
                color = Ok, fontWeight = FontWeight.SemiBold,
            )
            else -> Text("${V3Math.fmt(s.p)} / bar ${bar?.let(V3Math::fmt) ?: "–"}", color = Warn, fontWeight = FontWeight.SemiBold, style = Tnum)
        }
        if (s != null && bar != null) BarMeter(s.p, bar, Modifier.fillMaxWidth())
        Text("Minimum evidence", style = MaterialTheme.typography.titleSmall)
        if (reqs.isEmpty()) Text("No minimum evidence for this claim — it can't earn the bar for free.", style = MaterialTheme.typography.bodySmall, color = Ink2)
        reqs.forEach { r -> RequirementLine(r, metOf(r, s, v4)) }
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
private fun ReqPip(r: Requirement, met: Boolean?) {
    val okC = Ok; val warnC = Warn; val pend = MaterialTheme.colorScheme.outline
    Box(
        Modifier.size(22.dp).clip(CircleShape).then(
            when (met) {
                true -> Modifier.background(okC)
                false -> Modifier.border(1.5.dp, warnC, CircleShape)
                null -> Modifier.border(1.5.dp, pend.copy(alpha = 0.6f), CircleShape)
            },
        ).semantics { contentDescription = evidenceLabel(r.evidence) + when (met) { true -> " met"; false -> " not met"; null -> " pending" } },
        contentAlignment = Alignment.Center,
    ) {
        Icon(evidenceIcon(r.evidence), null, Modifier.size(13.dp), tint = when (met) { true -> contentOn(okC); false -> warnC; null -> pend })
    }
}

@Composable
private fun RequirementLine(r: Requirement, met: Boolean?) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        ReqPip(r, met)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(r.ask, style = MaterialTheme.typography.bodyMedium)
            Text(
                when (met) { true -> "met"; false -> "not met"; null -> "checked when sealed" } + (r.minSeconds?.let { " · ≥ ${fmtNum(it)} s" } ?: ""),
                style = MaterialTheme.typography.labelSmall, color = Ink2,
            )
        }
    }
}

fun moduleTitle(id: String): String? = Ladder.modules.firstOrNull { it.id == id }?.title
