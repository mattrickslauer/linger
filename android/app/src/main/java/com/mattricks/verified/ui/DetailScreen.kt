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
import androidx.compose.material.icons.filled.Delete
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
import androidx.compose.runtime.collectAsState
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
import com.mattricks.verified.data.Score
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.data.Store
import com.mattricks.verified.record.RecordViewModel
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(momentId: String, fromMe: Boolean = false, onBack: () -> Unit) {
    var detail by remember { mutableStateOf<MomentDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var confirmDelete by remember { mutableStateOf(false) }
    val recordingId by RecordViewModel.recording.collectAsState()
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
            actions = {
                // Only from "my Moments", only the owner's own, never the one being recorded (ARCHITECTURE.md).
                val card = detail?.card
                if (fromMe && card != null && canDeleteMoment(card, Firebase.auth.currentUser?.uid, recordingId)) {
                    IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, "Delete Moment") }
                }
            },
        )
    }) { pad ->
        if (confirmDelete) DeleteMomentDialog(
            onConfirm = { confirmDelete = false; Store.deleteMoment(momentId); onBack() },
            onDismiss = { confirmDelete = false },
        )
        val d = detail
        var ladderOpen by remember { mutableStateOf(false) }
        val ctx = androidx.compose.ui.platform.LocalContext.current
        // full_video: the chained clip must still be on this phone (it never left it).
        val clipRef = d?.videos?.lastOrNull()
        var clipUri by remember { mutableStateOf<android.net.Uri?>(null) }
        LaunchedEffect(clipRef?.sha256, ladderOpen) { clipUri = clipRef?.let { com.mattricks.verified.data.Clips.find(ctx, it) } }
        val runVideo: (suspend (String) -> com.mattricks.verified.data.Ladder.Run)? = clipRef?.let { ref ->
            clipUri?.let { uri ->
                { requestId: String ->
                    val uid = Firebase.auth.currentUser?.uid ?: throw com.mattricks.verified.data.Ladder.RunError("sign_in", "Sign in first.")
                    val sha = com.mattricks.verified.data.Clips.upload(ctx, uid, momentId, ref, uri)
                    com.mattricks.verified.data.Ladder.run(momentId, "full_video", clipSha = sha, requestId = requestId)
                }
            }
        }
        if (ladderOpen && d != null) LadderSheet(
            d, clipOnPhone = clipUri != null, runVideo = runVideo,
            onDone = { refresh++ }, onDismiss = { ladderOpen = false; refresh++ },
        )
        when {
            d != null -> DetailBody(d, Modifier.padding(pad)) {
                com.mattricks.verified.auth.Gate.require("run a verification module") { ladderOpen = true }
            }
            error != null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error ?: "", color = Red) }
            else -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
    }
}

@Composable
private fun DetailBody(d: MomentDetail, modifier: Modifier, onOpenLadder: () -> Unit) {
    var selected by remember(d.frames.size) { mutableIntStateOf((d.frames.size - 1).coerceAtLeast(0)) }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(d.card.intention, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            StatusBadge(d.card.status, d.local)
        }
        Text(
            "${d.card.ownerName} · ${d.card.category} · ${d.card.platform} · ${fmtDuration(d.card.summary.durationMs)} · ${fmtDistance(d.card.summary.distanceM)}",
            color = Color.Gray, style = MaterialTheme.typography.bodySmall,
        )
        if (d.local) LocalBanner(d)
        else Pill(onDeviceLabel(d.card.onDeviceMode), MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)

        // v4: overall verdict on top, the free video review, then one row per claim (docs/ARCHITECTURE.md v4.11).
        if (isV4(d)) {
            VerdictHeader(d)
            VideoReviewCard(d)
            ClaimsSection(d) { c, s -> ClaimOffers(d, c, s) }
        } else if (!d.local && d.card.status == "recording" && d.videos.isNotEmpty()) VideoUploadLine(d.card.id)

        if (d.frames.isNotEmpty()) {
            val f = d.frames[selected.coerceIn(0, d.frames.size - 1)]
            B64Image(f.jpegB64, Modifier.fillMaxWidth().height(260.dp).clip(RoundedCornerShape(16.dp)))
            f.check?.let { c ->
                Text(
                    (if (c.ok) "Keep going" else "Retake: ${c.reason}") + (if (c.label.isNotBlank()) " · ${c.label}" else "") + " · " + onDeviceLabel(c.mode),
                    style = MaterialTheme.typography.bodySmall, color = if (c.ok) Green else Red,
                )
            }
            f.witnessAsk?.let { Pill("Witness asked: $it", MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer) }
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

        if (d.witness.isNotEmpty()) WitnessSection(d)

        Section("Track")
        TrackMap(d.track, Modifier.fillMaxWidth().height(260.dp))
        Text("${d.track.size} GPS fixes", style = MaterialTheme.typography.bodySmall, color = Color.Gray)

        if (d.motion.isNotEmpty()) {
            Section("Motion")
            MotionChart(d.motion, d.frames.map { it.t }, Modifier.fillMaxWidth().height(120.dp))
            Text("|acceleration| m/s² · ${d.motion.size} samples · amber = proof shot", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        }

        d.intention?.takeIf { it.structured }?.let { IntentionSection(it, d.card.summary.distanceM) }

        Section("AI opinions")
        OpinionCard("Judge", d.judge, d.judgeReasons)
        OpinionCard("Skeptic", d.skeptic, emptyList())
        ScoreCard(d.score, d.bar?.value ?: 0.5, baseline = d.verification?.modules?.isNotEmpty() == true)
        BarCard(d)
        LadderSection(d, isOwner = d.ownerUid.isNotEmpty() && d.ownerUid == Firebase.auth.currentUser?.uid, onOpenLadder = onOpenLadder)

        Section("Seal")
        val checks = d.seal?.checks?.takeIf { it.isNotEmpty() } ?: d.feedChecks
        val labels = if (d.sealVersion >= 4) linkedMapOf(
            "chain" to "Hash chain intact", "timing" to "Timing consistent", "physics" to "Physics plausible",
            "frames" to "Proof frames match",
            "ai" to "The proof frames don't contradict the intention",
            "cheating" to "No cheating detected",
            "bar" to "Every claim reaches the bar" + (barOf(d)?.let { " (${com.mattricks.verified.data.V3Math.fmt(it)})" } ?: ""),
        ) else linkedMapOf(
            "chain" to "Hash chain intact", "timing" to "Timing consistent", "physics" to "Physics plausible",
            "frames" to "Proof frames match",
            "ai" to if (d.sealVersion >= 3) "Judge consistent, skeptic found nothing" else "Judge consistent, skeptic found nothing, score ≥ 50%",
            "bar" to "Score reaches the bar" + (d.bar?.let { " (${com.mattricks.verified.data.V3Math.fmt(it.value)})" } ?: ""),
        )
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (checks.isEmpty()) {
                    Text(
                        if (d.card.status == "submitted") "Waiting for judge, skeptic + scorer, then the Cloud Function seals." else "Not sealed yet.",
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

/** A guest Moment on this phone only (v3.1): nothing is on the server yet. */
@Composable
private fun LocalBanner(d: MomentDetail) {
    val uploading by com.mattricks.verified.data.Claims.uploading.collectAsState()
    val guest = remember(d.card.id, uploading) { com.mattricks.verified.data.Vault.isGuest(d.card.id) }
    if (!guest) {
        // A signed-in Moment the server doesn't have yet: the raw vault uploads it by itself, no claim needed.
        Pill("Kept on this phone · syncs when online", Amber)
        return
    }
    Card(Modifier.fillMaxWidth(), colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("On this device · sign in to verify", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(
                "Recorded as a guest. The hash chain binds only this Moment's id, so it uploads unchanged to your account.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            when {
                d.card.id in uploading -> Text("Uploading…", color = Green)
                d.card.status == "submitted" -> androidx.compose.material3.Button(onClick = {
                    com.mattricks.verified.auth.Gate.require("verify this Moment") { com.mattricks.verified.data.Claims.claim(listOf(d.card.id)) }
                }) { Text("Upload & verify") }
            }
        }
    }
}

/** v3.4 witness requests read back from the hash chain, with how each was answered. */
@Composable
private fun WitnessSection(d: MomentDetail) {
    Section("Witness")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val answered = d.witness.count { it.outcome != null && it.outcome != "skipped" }
            Text("${d.witness.size} asked · $answered answered · all in the hash chain", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            d.witness.forEach { w ->
                Row(verticalAlignment = Alignment.Top) {
                    val (mark, color) = when (w.outcome) {
                        null -> "…" to Color.Gray
                        "skipped" -> "–" to Amber
                        else -> "✓" to Green
                    }
                    Text(mark, color = color, fontWeight = FontWeight.Bold, modifier = Modifier.width(22.dp))
                    Column(Modifier.weight(1f)) {
                        Text(w.ask, fontWeight = FontWeight.SemiBold)
                        Text(
                            buildString {
                                append(w.kind).append(" · ").append(modeChip(w.by))
                                when (w.outcome) {
                                    "frame" -> append(" · answered with a proof shot")
                                    "voice" -> append(" · answered by voice")
                                    "text" -> append(" · answered in text")
                                    "done" -> append(" · done")
                                    "skipped" -> append(" · skipped")
                                }
                            },
                            fontSize = 11.sp, color = Color.Gray,
                        )
                        w.answer?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}

/** v3.2 structured intention as recorded (frozen once the Moment is submitted). */
@Composable
private fun IntentionSection(i: com.mattricks.verified.data.Intention, distanceM: Double) {
    Section("Intention")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (i.goal.isNotBlank()) Text(i.goal, fontWeight = FontWeight.SemiBold)
            listOfNotNull(
                i.activity.takeIf { it.isNotBlank() },
                i.place?.label()?.takeIf { it.isNotBlank() },
                i.expectedMinutes?.let { "~${it.toInt()} min" },
            ).takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
            i.quantities.forEach { q -> Text("• ${q.metric}: ${fmtNum(q.value)} ${q.unit} (by ${q.measuredBy})", style = MaterialTheme.typography.bodyMedium) }
            measuredHint(i, distanceM)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Green) }
            if (i.conditions.isNotEmpty()) Text("Conditions: " + i.conditions.joinToString(", "), style = MaterialTheme.typography.bodySmall)
            if (i.assumptions.isNotEmpty()) Text("Assumed: " + i.assumptions.joinToString("; "), style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            Text("Interview: ${i.interviewTurns} answer(s) · ${modeChip(i.interviewMode)}", fontSize = 11.sp, color = Color.Gray)
        }
    }
}

/**
 * Sensor-countable numbers measured deterministically on this phone (distance from GPS). The count_measure module
 * re-measures them server-side; this is only a preview next to the claim.
 */
fun measuredHint(i: com.mattricks.verified.data.Intention, distanceM: Double): String? {
    val q = i.quantities.firstOrNull { it.metric.equals("distance", true) } ?: return null
    if (distanceM <= 0) return null
    val claimedM = when (q.unit.lowercase()) {
        "km", "kilometers", "kilometres" -> q.value * 1000
        "mi", "mile", "miles" -> q.value * 1609.344
        "m", "meters", "metres" -> q.value
        else -> return "GPS measured ${fmtDistance(distanceM)}"
    }
    val pct = (100 * distanceM / claimedM).toInt()
    return "GPS measured ${fmtDistance(distanceM)} · $pct% of the claimed ${fmtNum(q.value)} ${q.unit}"
}

/** The AI-set bar (v3.3, server-side) against the final score (v3.5). Public on sealed posts. */
@Composable
private fun BarCard(d: MomentDetail) {
    val bar = d.bar
    val preview = d.intention?.preview
    val score = d.verification?.score ?: d.score?.probability
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("The bar", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                when {
                    bar != null -> Pill(if (bar.source == "default") "standard bar" else "set by AI · cloud", MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
                    preview != null -> Pill("preview · ${modeChip(preview.mode)}", MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            when {
                bar != null -> {
                    Row(verticalAlignment = Alignment.Bottom) {
                        if (score != null) {
                            Text(com.mattricks.verified.data.V3Math.fmt(score), fontSize = 30.sp, fontWeight = FontWeight.Bold, color = if (score >= bar.value) Green else Amber)
                            Text("  score", color = Color.Gray, modifier = Modifier.padding(bottom = 6.dp))
                            Spacer(Modifier.width(16.dp))
                        }
                        Text(com.mattricks.verified.data.V3Math.fmt(bar.value), fontSize = 30.sp, fontWeight = FontWeight.Bold)
                        Text("  bar", color = Color.Gray, modifier = Modifier.padding(bottom = 6.dp))
                    }
                    BarMeter(score, bar.value, Modifier.fillMaxWidth())
                    if (bar.rationale.isNotBlank()) Text(bar.rationale, style = MaterialTheme.typography.bodyMedium)
                    bar.factors.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                    Text(
                        "Difficulty ${com.mattricks.verified.data.V3Math.fmt(bar.difficulty)} → bar = 0.5 + 0.45 × difficulty. The score must reach it to be Verified.",
                        style = MaterialTheme.typography.bodySmall, color = Color.Gray,
                    )
                }
                preview != null -> {
                    Text("Bar ≈ ${com.mattricks.verified.data.V3Math.fmt(preview.bar)} (preview)", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    BarMeter(null, preview.bar, Modifier.fillMaxWidth())
                    Text("The binding bar is set in the cloud once the Moment is submitted.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                }
                else -> Text(
                    if (d.local) "Set in the cloud once you sign in and upload." else "Set in the cloud once the Moment is submitted.",
                    color = Color.Gray,
                )
            }
        }
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

@Composable
private fun ScoreCard(s: Score?, bar: Double, baseline: Boolean) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (baseline) "Baseline score (before the ladder)" else "Verification score", fontWeight = FontWeight.Bold)
            if (s == null) {
                Text("Not scored", color = Color.Gray)
            } else {
                Text(
                    "${(s.probability * 100).toInt()}%", fontSize = 36.sp, fontWeight = FontWeight.Bold,
                    color = if (s.probability >= bar) Green else Red,
                )
                Text(
                    "Chance the claim is true given the evidence, assuming most submissions are cheating (prior 20%).",
                    style = MaterialTheme.typography.bodySmall, color = Color.Gray,
                )
                s.reasons.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
                if (s.model.isNotBlank()) Text(s.model + " · in the cloud", fontSize = 11.sp, color = Color.Gray)
            }
        }
    }
}
