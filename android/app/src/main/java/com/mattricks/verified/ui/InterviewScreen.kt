package com.mattricks.verified.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DirectionsRun
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Visibility
import com.mattricks.verified.data.CATEGORIES
import com.mattricks.verified.data.Claim
import com.mattricks.verified.data.Intention
import com.mattricks.verified.data.Plan
import com.mattricks.verified.data.Requirement
import com.mattricks.verified.data.evidenceLabel
import com.mattricks.verified.data.Prefs
import com.mattricks.verified.data.V3Math
import com.mattricks.verified.devices.Devices
import com.mattricks.verified.record.InterviewUi
import com.mattricks.verified.record.InterviewViewModel
import com.mattricks.verified.record.RecUi
import com.mattricks.verified.record.RecordViewModel
import com.mattricks.verified.voice.Voice

/** Permissions for a session, then start (camera, location, mic for video/witness, BLE if a device is saved). */
@Composable
private fun rememberStart(vm: RecordViewModel): () -> Unit {
    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.start() }
    return {
        val want = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.RECORD_AUDIO)
        if (android.os.Build.VERSION.SDK_INT >= 33) want += Manifest.permission.POST_NOTIFICATIONS // witness asks while backgrounded
        if (Devices.state.value.savedAddress != null) want += Devices.permissions()
        perms.launch(want.distinct().toTypedArray())
    }
}

/** Record tab before a session: the voice interview (v3.2), or the typed one-sentence form. */
@Composable
fun SetupView(ui: RecUi, vm: RecordViewModel) {
    var typedForm by rememberSaveable { mutableStateOf(false) }
    val start = rememberStart(vm)
    val ivm: InterviewViewModel = viewModel()
    if (typedForm) TypedForm(ui, vm, start, onPlan = { ivm.structureTyped(ui.intention); typedForm = false }) { typedForm = false; vm.useStructured(null) }
    else InterviewView(vm, start) { typedForm = true; vm.useStructured(null) }
}

@Composable
private fun TypedForm(ui: RecUi, vm: RecordViewModel, start: () -> Unit, onPlan: () -> Unit, onVoice: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Declare your intention", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        OutlinedTextField(
            value = ui.intention, onValueChange = vm::setIntention, modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Catch and release a largemouth bass at Lake Mission Viejo") }, minLines = 2,
        )
        CategoryChips(ui.category, vm::setCategory)
        Spacer(Modifier.height(8.dp))
        StartButton(enabled = ui.intention.isNotBlank(), onClick = start)
        // v4.1: optional cloud structuring of the typed sentence → claims + "To get this verified" before Start.
        if (com.mattricks.verified.judge.Judging.online()) OutlinedButton(
            enabled = ui.intention.isNotBlank(), onClick = onPlan, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp),
        ) { Text("Plan the evidence") }
        Text(
            "GPS, motion and proof shots are hash-chained as you go. Works offline — the server sets the bar and the claims when it syncs.",
            style = MaterialTheme.typography.bodySmall, color = Color.Gray,
        )
        TextButton(onClick = onVoice) { Icon(Icons.Filled.Mic, null); Text(" Use the voice interview") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CategoryChips(selected: String, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        CATEGORIES.forEach { c -> FilterChip(selected = selected == c, onClick = { onPick(c) }, label = { Text(c) }) }
    }
}

@Composable
private fun StartButton(enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().height(64.dp), shape = RoundedCornerShape(32.dp),
    ) { Text("Start Moment", fontSize = 20.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun InterviewView(vm: RecordViewModel, start: () -> Unit, onTyped: () -> Unit) {
    val ivm: InterviewViewModel = viewModel()
    val s by ivm.ui.collectAsState()
    val partial by Voice.partial.collectAsState()
    val level by Voice.level.collectAsState()
    var typed by rememberSaveable { mutableStateOf("") }
    val micPerms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { ivm.talk() }
    val scroll = rememberScrollState()
    LaunchedEffect(s.turns.size, s.phase) { scroll.animateScrollTo(scroll.maxValue) }

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("What are you about to do?", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "Say it in a few words — \"going fishing\" is enough. The witness asks up to 3 quick questions, " +
                    "assumes the rest from where and when you are, and sets the bar.",
                style = MaterialTheme.typography.bodyMedium, color = Color.Gray,
            )
            s.turns.forEach { Bubble(it.me, it.text, it.mode) }
            if (s.phase == InterviewUi.Phase.Listening && partial.isNotBlank()) Bubble(true, partial, null, live = true)
            s.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Warn) }
            val i = s.intention
            if (s.phase == InterviewUi.Phase.Ready && i != null) {
                IntentionCard(i, s.previewBusy, ivm)
                StartButton(enabled = i.text.isNotBlank()) {
                    vm.useStructured(i, ivm.transcript())
                    start()
                }
                TextButton(onClick = { ivm.reset() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Start over") }
            }
        }
        if (s.phase != InterviewUi.Phase.Ready) Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MicButton(s.phase, level) {
                micPerms.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }
            Text(
                when (s.phase) {
                    InterviewUi.Phase.Idle -> if (s.turns.isEmpty()) "Tap to talk" else "Tap to answer"
                    InterviewUi.Phase.Listening -> "Listening…"
                    InterviewUi.Phase.Thinking -> "Thinking (on-device first)…"
                    InterviewUi.Phase.Speaking -> "Speaking…"
                    InterviewUi.Phase.Structuring -> "Structuring your intention in the cloud…"
                    InterviewUi.Phase.Ready -> ""
                },
                style = MaterialTheme.typography.labelLarge, color = Color.Gray,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = typed, onValueChange = { typed = it.take(200) }, modifier = Modifier.weight(1f), singleLine = true,
                    placeholder = { Text(if (s.turns.isEmpty()) "Or type it: going fishing" else "Type your answer") },
                    shape = RoundedCornerShape(24.dp),
                )
                IconButton(enabled = typed.isNotBlank(), onClick = { ivm.typed(typed); typed = "" }) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
            }
            Row {
                if (s.turns.any { it.me }) TextButton(onClick = { ivm.finishNow() }) { Text("That's it — set it up") }
                TextButton(onClick = onTyped) { Text("Skip — just type it") }
            }
        }
    }
}

@Composable
private fun MicButton(phase: InterviewUi.Phase, level: Float, onClick: () -> Unit) {
    val busy = phase == InterviewUi.Phase.Thinking || phase == InterviewUi.Phase.Structuring
    val pulse by animateFloatAsState(if (phase == InterviewUi.Phase.Listening) 1f + level * 0.25f else 1f, label = "mic")
    Box(contentAlignment = Alignment.Center) {
        if (phase == InterviewUi.Phase.Listening) Box(Modifier.size(96.dp).scale(pulse * 1.08f).clip(CircleShape).background(Ok.copy(alpha = 0.18f)))
        Box(
            Modifier.size(80.dp).scale(pulse).clip(CircleShape)
                .background(if (phase == InterviewUi.Phase.Listening) Bad else Ok)
                .clickable(enabled = !busy, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            when {
                busy -> CircularProgressIndicator(color = Color.White, modifier = Modifier.size(30.dp), strokeWidth = 3.dp)
                phase == InterviewUi.Phase.Listening || phase == InterviewUi.Phase.Speaking -> Icon(Icons.Filled.Stop, "Stop", tint = Color.White, modifier = Modifier.size(34.dp))
                else -> Icon(Icons.Filled.Mic, "Talk", tint = Color.White, modifier = Modifier.size(36.dp))
            }
        }
    }
}

/** A chat bubble; AI bubbles carry the hybrid chip (on-device / cloud), so the routing is visible. */
@Composable
fun Bubble(me: Boolean, text: String, mode: String?, live: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (me) Arrangement.End else Arrangement.Start) {
        Column(horizontalAlignment = if (me) Alignment.End else Alignment.Start) {
            Surface(
                color = if (me) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = if (me) 18.dp else 4.dp, bottomEnd = if (me) 4.dp else 18.dp),
                modifier = Modifier.widthIn(max = 300.dp),
            ) {
                Text(
                    text, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    color = if (me) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontStyle = if (live) FontStyle.Italic else FontStyle.Normal,
                )
            }
            if (!me && mode != null) Text(modeChip(mode), fontSize = 10.sp, color = Color.Gray, modifier = Modifier.padding(start = 6.dp, top = 2.dp))
        }
    }
}

fun modeChip(mode: String) = when (mode) {
    "on_device" -> "on-device · Gemini Nano"
    "cloud" -> "cloud · ${com.mattricks.verified.ai.Ai.cloudModel()}"
    "mixed" -> "on-device + cloud"
    else -> mode
}

/** The structured intention, editable, with the hybrid bar preview (v3.2 step 4–5). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IntentionCard(i: Intention, previewBusy: Boolean, ivm: InterviewViewModel) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Your intention", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Pill(modeChip(i.interviewMode), MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
            }
            OutlinedTextField(value = i.text, onValueChange = { t -> ivm.edit { it.copy(text = t.take(200)) } }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            CategoryChips(i.category) { c -> ivm.edit { it.copy(category = c) } }
            if (i.goal.isNotBlank()) Field("Goal", i.goal)
            i.place?.label()?.takeIf { it.isNotBlank() }?.let { Field("Place", it) }
            i.expectedMinutes?.let { Field("Expected", "${it.toInt()} min") }
            if (i.quantities.isNotEmpty()) {
                Label("Numbers to prove")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    i.quantities.forEach { q ->
                        InputChip(
                            selected = false, onClick = { ivm.edit { it.copy(quantities = it.quantities - q) } },
                            label = { Text("${q.metric} ${fmtNum(q.value)} ${q.unit} · ${q.measuredBy}") },
                            trailingIcon = { Icon(Icons.Filled.Close, "Remove", Modifier.size(14.dp)) },
                        )
                    }
                }
            }
            if (i.conditions.isNotEmpty()) {
                Label("Conditions")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    i.conditions.forEach { c ->
                        InputChip(selected = false, onClick = { ivm.edit { it.copy(conditions = it.conditions - c) } }, label = { Text(c) },
                            trailingIcon = { Icon(Icons.Filled.Close, "Remove", Modifier.size(14.dp)) })
                    }
                }
            }
            if (i.assumptions.isNotEmpty()) {
                Label("I assumed (tap to remove)")
                i.assumptions.forEach { a ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { ivm.edit { it.copy(assumptions = it.assumptions - a) } }) {
                        Text("• $a", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        Icon(Icons.Filled.Close, "Remove", Modifier.size(14.dp), tint = Color.Gray)
                    }
                }
            }
            if (i.claims.isNotEmpty()) {
                Label("Claims (tap to remove)")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    i.claims.forEach { c ->
                        InputChip(
                            selected = true, onClick = { ivm.removeClaim(c.id) }, label = { Text(c.text) },
                            leadingIcon = { Text(c.kind, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)) },
                            trailingIcon = { Icon(Icons.Filled.Close, "Remove", Modifier.size(14.dp)) },
                        )
                    }
                }
            }
            i.plan?.takeIf { it.requirements.isNotEmpty() }?.let { PlanList(it, i.claims) }
            BarPreviewRow(i, previewBusy) { ivm.preview() }
        }
    }
}

/** "To get this verified": one row per requirement of the evidence plan (v4.11). */
@Composable
fun PlanList(plan: Plan, claims: List<Claim>) {
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("To get this verified", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Pill(if (plan.recordMode == "video") "Video" else "Photo", MaterialTheme.colorScheme.primary)
            }
            plan.requirements.forEach { r ->
                Row(verticalAlignment = Alignment.Top) {
                    Icon(evidenceIcon(r.evidence), null, Modifier.size(18.dp).padding(top = 2.dp), tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(r.ask, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            listOfNotNull(
                                evidenceLabel(r.evidence),
                                r.minSeconds?.let { "≥ ${fmtNum(it)} s" },
                                claims.firstOrNull { it.id == r.claimId }?.text,
                            ).joinToString(" · "),
                            fontSize = 11.sp, color = Color.Gray,
                        )
                    }
                }
            }
            if (plan.note.isNotBlank()) Text(plan.note, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
        }
    }
}

fun evidenceIcon(e: String) = when (e) {
    "video" -> Icons.Filled.Videocam
    "frames" -> Icons.Filled.PhotoCamera
    "gps" -> Icons.Filled.Place
    "motion" -> Icons.Filled.DirectionsRun
    "witness" -> Icons.Filled.Visibility
    else -> Icons.Filled.CheckCircle
}

@Composable
private fun BarPreviewRow(i: Intention, busy: Boolean, onRefresh: () -> Unit) {
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val p = i.preview
            Row(verticalAlignment = Alignment.CenterVertically) {
                when {
                    busy -> { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Text("  Estimating the bar…", color = Color.Gray) }
                    p != null -> {
                        Text("Bar ≈ ${V3Math.fmt(p.bar)}", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                        Text(" (preview)", color = Color.Gray, modifier = Modifier.weight(1f))
                        Text(modeChip(p.mode), fontSize = 10.sp, color = Color.Gray)
                    }
                    else -> {
                        Text("Bar set by the server when it syncs", color = Color.Gray, modifier = Modifier.weight(1f))
                        TextButton(onClick = onRefresh) { Text("Preview") }
                    }
                }
            }
            if (p != null) {
                BarMeter(null, p.bar, Modifier.fillMaxWidth())
                if (p.rationale.isNotBlank()) Text(p.rationale, style = MaterialTheme.typography.bodySmall)
                Text("The binding bar is set in the cloud when the Moment is submitted. The score must reach it to be Verified.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String) = Column {
    Label(label)
    Text(value, style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun Label(t: String) = Text(t.uppercase(), fontSize = 11.sp, letterSpacing = 1.sp, color = Color.Gray, fontWeight = FontWeight.SemiBold)

fun fmtNum(v: Double): String = if (v == Math.rint(v)) v.toLong().toString() else String.format(java.util.Locale.US, "%.1f", v)
