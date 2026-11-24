package com.mattricks.verified.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mattricks.verified.data.MomentDetail
import com.mattricks.verified.data.Opinion
import com.mattricks.verified.data.Store
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(momentId: String, onBack: () -> Unit) {
    var detail by remember { mutableStateOf<MomentDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    LaunchedEffect(momentId, refresh) {
        runCatching { Store.detail(momentId) }.onSuccess { detail = it; error = null }.onFailure { error = it.message }
        // While it is being judged/sealed, poll so the checklist fills in live.
        val st = detail?.card?.status
        if (st == "recording" || st == "submitted") { delay(4_000); refresh++ }
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Moment") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        )
    }) { pad ->
        val d = detail
        when {
            d != null -> DetailBody(d, Modifier.padding(pad))
            error != null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error ?: "", color = Red) }
            else -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
    }
}

@Composable
private fun DetailBody(d: MomentDetail, modifier: Modifier) {
    var selected by remember(d.frames.size) { mutableIntStateOf((d.frames.size - 1).coerceAtLeast(0)) }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(d.card.intention, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            StatusBadge(d.card.status)
        }
        Text(
            "${d.card.ownerName} · ${d.card.category} · ${d.card.platform} · ${fmtDuration(d.card.summary.durationMs)} · ${fmtDistance(d.card.summary.distanceM)}",
            color = Color.Gray, style = MaterialTheme.typography.bodySmall,
        )
        Pill(onDeviceLabel(d.card.onDeviceMode), MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)

        if (d.frames.isNotEmpty()) {
            val f = d.frames[selected.coerceIn(0, d.frames.size - 1)]
            B64Image(f.jpegB64, Modifier.fillMaxWidth().height(260.dp).clip(RoundedCornerShape(16.dp)))
            f.check?.let { c ->
                Text(
                    (if (c.ok) "Keep going" else "Retake: ${c.reason}") + (if (c.label.isNotBlank()) " · ${c.label}" else "") + " · " + onDeviceLabel(c.mode),
                    style = MaterialTheme.typography.bodySmall, color = if (c.ok) Green else Red,
                )
            }
            Section("Frame timeline")
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(d.frames.indices.toList()) { i ->
                    val fr = d.frames[i]
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Card(onClick = { selected = i }) { B64Image(fr.jpegB64, Modifier.size(width = 84.dp, height = 64.dp)) }
                        Text(
                            if (d.startedAt > 0 && fr.t > 0) "+${(fr.t - d.startedAt) / 1000}s" else "#${fr.seq}",
                            fontSize = 11.sp, color = if (fr.check?.ok == false) Red else Color.Gray,
                            fontWeight = if (i == selected) FontWeight.Bold else FontWeight.Normal,
                        )
                    }
                }
            }
        }

        Section("Track")
        TrackMap(d.track, Modifier.fillMaxWidth().height(260.dp))
        Text("${d.track.size} GPS fixes", style = MaterialTheme.typography.bodySmall, color = Color.Gray)

        if (d.motion.isNotEmpty()) {
            Section("Motion")
            MotionChart(d.motion, d.frames.map { it.t }, Modifier.fillMaxWidth().height(120.dp))
            Text("|acceleration| m/s² · ${d.motion.size} samples · amber = proof shot", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        }

        Section("AI opinions")
        OpinionCard("Judge", d.judge, d.judgeReasons)
        OpinionCard("Skeptic", d.skeptic, emptyList())

        Section("Seal")
        val checks = d.seal?.checks?.takeIf { it.isNotEmpty() } ?: d.feedChecks
        val labels = linkedMapOf(
            "chain" to "Hash chain intact", "timing" to "Timing consistent", "physics" to "Physics plausible",
            "frames" to "Proof frames match", "ai" to "Judge consistent, skeptic found nothing",
        )
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (checks.isEmpty()) {
                    Text(
                        if (d.card.status == "submitted") "Waiting for judge + skeptic, then the Cloud Function seals." else "Not sealed yet.",
                        color = Color.Gray,
                    )
                    d.chainOk?.let { CheckRow("Hash chain (checked on this phone, ${d.chunkCount} chunks)", it) }
                } else {
                    labels.forEach { (k, label) -> checks[k]?.let { CheckRow(label, it) } }
                    (d.seal?.reason ?: d.feedReason)?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Section(t: String) = Text(t, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))

@Composable
private fun CheckRow(label: String, ok: Boolean) = Row(verticalAlignment = Alignment.CenterVertically) {
    Text(if (ok) "✓" else "✗", color = if (ok) Green else Red, fontWeight = FontWeight.Bold, modifier = Modifier.width(24.dp))
    Text(label)
}

@Composable
private fun OpinionCard(title: String, o: Opinion?, fallbackReasons: List<String>) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (o != null) Pill(
                    "${o.verdict} · ${(o.confidence * 100).toInt()}%",
                    when (o.verdict) { "consistent" -> Green; "inconsistent" -> Red; else -> Amber },
                )
            }
            val reasons = o?.reasons ?: fallbackReasons
            if (reasons.isEmpty()) Text(if (o == null) "Runs in the cloud once the Moment is synced." else "No reasons given.", color = Color.Gray)
            reasons.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
            if (o != null && o.model.isNotBlank()) Text(o.model + " · in the cloud", fontSize = 11.sp, color = Color.Gray)
        }
    }
}
