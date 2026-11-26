package com.mattricks.verified.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
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
import androidx.compose.foundation.layout.imePadding
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
    Column(Modifier.fillMaxSize().safeTopAndSides().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("What will you do?", style = MaterialTheme.typography.headlineMedium)
        OutlinedTextField(
            value = ui.intention, onValueChange = vm::setIntention, modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Catch and release a largemouth bass at Lake Mission Viejo") }, minLines = 2, shape = RoundedCornerShape(18.dp),
        )
        StartButton(enabled = ui.intention.isNotBlank(), onClick = start)
        // v4.1: optional cloud structuring of the typed sentence → claims + "To get this verified" before Start.
        if (com.mattricks.verified.judge.Judging.online()) OutlinedButton(
            enabled = ui.intention.isNotBlank(), onClick = onPlan, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(26.dp),
        ) { Icon(Glyph.Ai, null); Spacer(Modifier.width(8.dp)); Text("Plan the evidence") }
        TextButton(onClick = onVoice, modifier = Modifier.align(Alignment.CenterHorizontally)) { Icon(Icons.Filled.Mic, null); Spacer(Modifier.width(6.dp)); Text("Use the voice interview") }
    }
}

@Composable
private fun StartButton(enabled: Boolean, onClick: () -> Unit) {
    val view = LocalView.current
    Button(
        onClick = { view.hapticConfirm(); onClick() }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp), shape = RoundedCornerShape(32.dp),
    ) {
        Icon(Icons.Filled.FiberManualRecord, null, tint = if (enabled) Color(0xFFFF8A80) else Color.Unspecified)
        Spacer(Modifier.width(10.dp))
        Text("Start Moment", fontSize = 20.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun InterviewView(vm: RecordViewModel, start: () -> Unit, onTyped: () -> Unit) {
    val ivm: InterviewViewModel = viewModel()
    val s by ivm.ui.collectAsState()
    val partial by Voice.partial.collectAsState()
    val level by Voice.level.collectAsState()
    val micPerms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { ivm.talk() }
    InterviewContent(
        s, partial, level,
        onTalk = { micPerms.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) },
        onTyped = ivm::typed, onFinishNow = ivm::finishNow, onSkipToTyped = onTyped, onReset = ivm::reset,
        onEdit = ivm::edit, onRemoveClaim = ivm::removeClaim, onPreview = ivm::preview,
        onStart = { i -> vm.useStructured(i, ivm.transcript()); start() },
    )
}

/** The interview as a chat: bubbles, a big mic, a type-it field; then the intention card and Start. */
@Composable
internal fun InterviewContent(
    s: InterviewUi, partial: String, level: Float,
    onTalk: () -> Unit, onTyped: (String) -> Unit, onFinishNow: () -> Unit, onSkipToTyped: () -> Unit, onReset: () -> Unit,
    onEdit: ((Intention) -> Intention) -> Unit, onRemoveClaim: (String) -> Unit, onPreview: () -> Unit, onStart: (Intention) -> Unit,
) {
    var typed by rememberSaveable { mutableStateOf("") }
    val scroll = rememberScrollState()
    LaunchedEffect(s.turns.size, s.phase) { scroll.animateScrollTo(scroll.maxValue) }

    // Insets outside the scroll: the chat never scrolls under the status bar, and the type-it row rides on the keyboard.
    BoxWithConstraints(Modifier.fillMaxSize().safeTopAndSides().imePadding()) {
        // Short (keyboard up on a small phone, landscape): the big mic folds into the text row so the chat keeps room.
        val compact = maxHeight < 480.dp
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.weight(1f).verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("What are you about to do?", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
                    InfoButton("The interview") {
                        Text("Say it in a few words — \"going fishing\" is enough. The witness asks up to 3 quick questions, assumes the rest from where and when you are, and sets the bar.")
                        Text("Questions run on the phone first (Gemini Nano); structuring and the bar run in the cloud.", color = Ink2, style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (s.turns.isEmpty()) Text("A few words is enough.", style = MaterialTheme.typography.bodyLarge, color = Ink2)
                s.turns.forEach { Bubble(it.me, it.text, it.mode) }
                if (s.phase == InterviewUi.Phase.Listening && partial.isNotBlank()) Bubble(true, partial, null, live = true)
                s.note?.let { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Glyph.Warning, null, Modifier.size(16.dp), tint = Warn); Spacer(Modifier.width(6.dp)); Text(it, style = MaterialTheme.typography.bodySmall, color = Warn) } }
                val i = s.intention
                if (s.phase == InterviewUi.Phase.Ready && i != null) {
                    IntentionCard(i, s.previewBusy, onEdit, onRemoveClaim, onPreview)
                    StartButton(enabled = i.text.isNotBlank()) { onStart(i) }
                    TextButton(onClick = onReset, modifier = Modifier.align(Alignment.CenterHorizontally)) { Icon(Icons.Filled.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Start over") }
                }
            }
            if (s.phase != InterviewUi.Phase.Ready) Column(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!compact) MicButton(s.phase, level, onTalk)
                if (!compact || s.phase != InterviewUi.Phase.Idle) Row(verticalAlignment = Alignment.CenterVertically) {
                    if (s.phase == InterviewUi.Phase.Thinking) { HybridBadge("on_device"); Spacer(Modifier.width(6.dp)) }
                    if (s.phase == InterviewUi.Phase.Structuring) { HybridBadge("cloud"); Spacer(Modifier.width(6.dp)) }
                    Text(
                        when (s.phase) {
                            InterviewUi.Phase.Idle -> if (s.turns.isEmpty()) "Tap to talk" else "Tap to answer"
                            InterviewUi.Phase.Listening -> "Listening…"
                            InterviewUi.Phase.Thinking -> "Thinking…"
                            InterviewUi.Phase.Speaking -> "Speaking…"
                            InterviewUi.Phase.Structuring -> "Structuring…"
                            InterviewUi.Phase.Ready -> ""
                        },
                        style = MaterialTheme.typography.labelLarge, color = Ink2,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (compact) { MicButton(s.phase, level, onTalk, small = true); Spacer(Modifier.width(8.dp)) }
                    OutlinedTextField(
                        value = typed, onValueChange = { typed = it.take(200) }, modifier = Modifier.weight(1f), singleLine = true,
                        placeholder = { Text(if (s.turns.isEmpty()) "Or type: going fishing" else "Type your answer") },
                        shape = RoundedCornerShape(28.dp),
                    )
                    IconButton(enabled = typed.isNotBlank(), onClick = { onTyped(typed); typed = "" }) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
                }
                Row {
                    if (s.turns.any { it.me }) TextButton(onClick = onFinishNow) { Icon(Icons.Filled.Check, null); Spacer(Modifier.width(4.dp)); Text("Set it up") }
                    TextButton(onClick = onSkipToTyped) { Icon(Icons.Filled.Keyboard, null); Spacer(Modifier.width(4.dp)); Text("Just type it") }
                }
            }
        }
    }
}

@Composable
private fun MicButton(phase: InterviewUi.Phase, level: Float, onClick: () -> Unit, small: Boolean = false) {
    val busy = phase == InterviewUi.Phase.Thinking || phase == InterviewUi.Phase.Structuring
    val listening = phase == InterviewUi.Phase.Listening
    val pulse by animateFloatAsState(if (listening) 1f + level * 0.25f else 1f, label = "mic")
    val lake = MaterialTheme.colorScheme.primary
    // small: the inline 56dp mic beside the text field (keyboard up, or a landscape phone).
    val k = if (small) 0.5f else 1f
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(112.dp * k)) {
        if (listening) Box(Modifier.size(104.dp * k).scale(pulse * 1.06f).clip(CircleShape).background(FillBad.copy(alpha = 0.18f)))
        Box(
            Modifier.size(if (small) 52.dp else 88.dp).scale(pulse).clip(CircleShape).background(if (listening) FillBad else lake)
                .clickable(enabled = !busy, role = Role.Button, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            when {
                busy -> CircularProgressIndicator(color = Color.White, modifier = Modifier.size(32.dp * k), strokeWidth = 3.dp)
                listening || phase == InterviewUi.Phase.Speaking -> Icon(Icons.Filled.Stop, "Stop", tint = Color.White, modifier = Modifier.size(38.dp * k))
                else -> Icon(Icons.Filled.Mic, "Talk", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(40.dp * k))
            }
        }
    }
}

/** A chat bubble; AI bubbles carry the hybrid badge (on-device / cloud), so the routing is visible. */
@Composable
fun Bubble(me: Boolean, text: String, mode: String?, live: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (me) Arrangement.End else Arrangement.Start) {
        Column(horizontalAlignment = if (me) Alignment.End else Alignment.Start) {
            Surface(
                color = if (me) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh,
                shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = if (me) 20.dp else 6.dp, bottomEnd = if (me) 6.dp else 20.dp),
                modifier = Modifier.widthIn(max = 300.dp),
            ) {
                Text(
                    text, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp), style = MaterialTheme.typography.bodyLarge,
                    color = if (me) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    fontStyle = if (live) FontStyle.Italic else FontStyle.Normal,
                )
            }
            if (!me && mode != null) HybridBadge(mode, Modifier.padding(top = 4.dp))
        }
    }
}

fun modeChip(mode: String) = when (mode) {
    "on_device" -> "on-device · Gemini Nano"
    "cloud" -> "cloud · ${com.mattricks.verified.ai.Ai.cloudModel()}"
    "mixed" -> "on-device + cloud"
    else -> mode
}

/** The structured intention: editable sentence, claim chips with glyphs, the plan as a strip, the bar preview ring. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun IntentionCard(
    i: Intention, previewBusy: Boolean, onEdit: ((Intention) -> Intention) -> Unit, onRemoveClaim: (String) -> Unit, onPreview: () -> Unit,
) {
    var assumptionsOpen by remember { mutableStateOf(false) }
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = RoundedCornerShape(24.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Glyph.Intent, null, tint = Track)
                Spacer(Modifier.width(8.dp))
                Text("Your intention", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                HybridBadge(i.interviewMode)
            }
            OutlinedTextField(
                value = i.text, onValueChange = { t -> onEdit { it.copy(text = t.take(200)) } }, modifier = Modifier.fillMaxWidth(), minLines = 2,
                shape = RoundedCornerShape(16.dp), textStyle = MaterialTheme.typography.titleMedium,
            )
            // Facts the witness filled in: one chip each, tap × to drop.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (i.goal.isNotBlank()) AssistChip(onClick = {}, label = { Text(i.goal, maxLines = 1, overflow = TextOverflow.Ellipsis) }, leadingIcon = { Icon(claimGlyph("outcome"), null, Modifier.size(16.dp)) })
                i.place?.label()?.takeIf { it.isNotBlank() }?.let { AssistChip(onClick = {}, label = { Text(it, maxLines = 1) }, leadingIcon = { Icon(Glyph.Place, null, Modifier.size(16.dp)) }) }
                i.expectedMinutes?.let { AssistChip(onClick = {}, label = { Text("~${it.toInt()} min") }, leadingIcon = { Icon(Glyph.Time, null, Modifier.size(16.dp)) }) }
                i.quantities.forEach { q ->
                    InputChip(
                        selected = false, onClick = { onEdit { it.copy(quantities = it.quantities - q) } },
                        label = { Text("${q.metric} ${fmtNum(q.value)} ${q.unit}") },
                        leadingIcon = { Icon(claimGlyph("measure"), null, Modifier.size(16.dp)) },
                        trailingIcon = { Icon(Icons.Filled.Close, "Remove ${q.metric}", Modifier.size(16.dp)) },
                    )
                }
                i.conditions.forEach { c ->
                    InputChip(
                        selected = false, onClick = { onEdit { it.copy(conditions = it.conditions - c) } }, label = { Text(c) },
                        leadingIcon = { Icon(Icons.Filled.Check, null, Modifier.size(16.dp)) },
                        trailingIcon = { Icon(Icons.Filled.Close, "Remove $c", Modifier.size(16.dp)) },
                    )
                }
            }
            if (i.claims.isNotEmpty()) {
                Text("Claims", style = MaterialTheme.typography.labelLarge, color = Ink2)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    i.claims.forEach { c ->
                        InputChip(
                            selected = true, onClick = { onRemoveClaim(c.id) }, label = { Text(c.text) },
                            leadingIcon = { Icon(claimGlyph(c.kind), c.kind, Modifier.size(16.dp)) },
                            trailingIcon = { Icon(Icons.Filled.Close, "Remove claim", Modifier.size(16.dp)) },
                        )
                    }
                }
            }
            if (i.assumptions.isNotEmpty()) {
                AssistChip(
                    onClick = { assumptionsOpen = !assumptionsOpen }, label = { Text("Assumed · ${i.assumptions.size}") },
                    leadingIcon = { Icon(Glyph.Ai, null, Modifier.size(16.dp)) },
                    trailingIcon = { Icon(if (assumptionsOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, Modifier.size(16.dp)) },
                )
                if (assumptionsOpen) i.assumptions.forEach { a ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp).clickable(onClickLabel = "Remove") { onEdit { it.copy(assumptions = it.assumptions - a) } }) {
                        Text("• $a", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        Icon(Icons.Filled.Close, "Remove", Modifier.size(16.dp), tint = Ink2)
                    }
                }
            }
            i.plan?.takeIf { it.requirements.isNotEmpty() }?.let { PlanList(it, i.claims) }
            BarPreviewRow(i, previewBusy, onPreview)
        }
    }
}

/** "To get this verified": the evidence plan as a horizontal strip of glyph cards (v4.11). */
@Composable
fun PlanList(plan: Plan, claims: List<Claim>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("To get this verified", style = MaterialTheme.typography.labelLarge, color = Ink2, modifier = Modifier.weight(1f))
            GlyphPill(if (plan.recordMode == "video") Glyph.Video else Glyph.Proof, if (plan.recordMode == "video") "Video" else "Photo", FillLake)
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(plan.requirements) { r ->
                Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp), modifier = Modifier.width(170.dp)) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(30.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                                Icon(evidenceIcon(r.evidence), null, Modifier.size(17.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                evidenceLabel(r.evidence) + (r.minSeconds?.let { " ≥ ${fmtNum(it)} s" } ?: ""),
                                style = MaterialTheme.typography.labelMedium, color = Ink2, maxLines = 1,
                            )
                        }
                        Text(r.ask, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        claims.firstOrNull { it.id == r.claimId }?.let { c ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(claimGlyph(c.kind), null, Modifier.size(13.dp), tint = Ink2); Spacer(Modifier.width(4.dp))
                                Text(c.text, style = MaterialTheme.typography.labelSmall, color = Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
        if (plan.note.isNotBlank()) Text(plan.note, style = MaterialTheme.typography.bodySmall, color = Ink2)
    }
}

fun evidenceIcon(e: String) = when (e) {
    "video" -> Glyph.Video
    "frames" -> Glyph.Proof
    "gps" -> Glyph.Place
    "motion" -> Glyph.Motion
    "witness" -> Glyph.Witness
    else -> Icons.Filled.CheckCircle
}

/** The bar preview as a ring (tick = the bar), with the hybrid badge; prose behind (i). */
@Composable
private fun BarPreviewRow(i: Intention, busy: Boolean, onRefresh: () -> Unit) {
    val p = i.preview
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(18.dp)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            when {
                busy -> { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp); Spacer(Modifier.width(12.dp)); Text("Estimating the bar", color = Ink2, modifier = Modifier.weight(1f)) }
                p != null -> {
                    ScoreRing(null, p.bar, size = 64.dp, centerText = "${(p.bar * 100).toInt()}", caption = "bar")
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Bar ≈ ${V3Math.fmt(p.bar)}", style = Tnum.merge(MaterialTheme.typography.titleMedium))
                        HybridBadge(p.mode)
                    }
                    InfoButton("The bar (preview)") {
                        if (p.rationale.isNotBlank()) Text(p.rationale)
                        p.factors.forEach { Bullet(it) }
                        Text("The binding bar is set in the cloud when the Moment is submitted. The score must reach it to be Verified.", style = MaterialTheme.typography.bodySmall, color = Ink2)
                    }
                }
                else -> {
                    ScoreRing(null, null, size = 48.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Bar set when it syncs", color = Ink2, modifier = Modifier.weight(1f))
                    TextButton(onClick = onRefresh) { Text("Preview") }
                }
            }
        }
    }
}

fun fmtNum(v: Double): String = if (v == Math.rint(v)) v.toLong().toString() else String.format(java.util.Locale.US, "%.1f", v)
