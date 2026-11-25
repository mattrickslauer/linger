package com.mattricks.verified.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseUser
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.ai.Ai
import com.mattricks.verified.auth.Auth
import com.mattricks.verified.auth.Gate
import com.mattricks.verified.data.Claims
import com.mattricks.verified.data.Vault
import kotlinx.coroutines.flow.flowOf
import androidx.compose.ui.text.font.FontWeight
import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Store
import com.mattricks.verified.judge.Judging
import com.mattricks.verified.record.RecordViewModel
import kotlinx.coroutines.launch

@Composable
fun FeedScreen(user: FirebaseUser?, onOpen: (String) -> Unit, onRecord: () -> Unit) {
    val items by remember { Store.feed() }.collectAsState(initial = null)
    CardList(
        items, empty = "No sealed Moments yet. Be the first: record one.", onOpen = onOpen,
        header = {
            FeedHero(user, onRecord)
            Spacer(Modifier.height(8.dp))
            Text("Latest Moments", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        },
    )
}

@Composable
fun MeScreen(user: FirebaseUser?, onOpen: (String) -> Unit) {
    val items by remember(user?.uid) { user?.let { Store.myMoments(it.uid) } ?: flowOf(emptyList()) }.collectAsState(initial = null)
    val guests by Vault.guests.collectAsState()
    val uploading by Claims.uploading.collectAsState()
    val judging by Judging.status.collectAsState()
    val nano by Ai.onDeviceState.collectAsState()
    val recordingId by RecordViewModel.recording.collectAsState()
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val local = guests.map { Store.localCard(it) }
    val all = items?.let { local + it }
    CardList(
        all, empty = "Your Moments will show up here.", onOpen = onOpen,
        onDelete = { c ->
            val mine = c.local || canDeleteMoment(c, user?.uid, recordingId)
            if (mine && c.id != recordingId) ({ confirmDelete = c.id }) else null
        },
        onUpload = { c ->
            if (c.local && c.status == "submitted" && c.id !in uploading) ({
                Gate.require("verify this Moment") { Claims.claim(listOf(c.id)) }
            }) else null
        },
        header = {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (user == null) {
                        Text("You're browsing as a guest", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(
                            "Moments you record stay on this phone. Sign in to upload them, run the cloud review and get them sealed.",
                            style = MaterialTheme.typography.bodySmall, color = Color.Gray,
                        )
                    } else {
                        Text(user.displayName ?: "Signed in", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(user.email ?: if (user.isAnonymous) "test user" else "", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "On-device model (Gemini Nano): " + when (nano) {
                            "available" -> "ready"
                            "downloading" -> "downloading…"
                            "checking" -> "checking…"
                            else -> "not on this phone — checks run in the cloud"
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (BuildConfig.USE_EMULATOR) Text("Emulator mode · ${BuildConfig.EMULATOR_HOST}", style = MaterialTheme.typography.bodySmall, color = Amber)
                    judging?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Green) }
                    if (uploading.isNotEmpty()) Text("Uploading ${uploading.size} guest Moment(s)…", style = MaterialTheme.typography.bodySmall, color = Green)
                    if (user != null) {
                        val held by Vault.held.collectAsState()
                        val conflicts = held.count { it.value == Vault.State.Conflict }
                        Text(
                            when {
                                held.isEmpty() -> "Raw data: all safely stored on the server ✓"
                                conflicts > 0 -> "Raw data: $conflicts Moment(s) differ from the server — kept on this phone"
                                else -> "Raw data: ${held.size} Moment(s) kept on this phone until the server confirms every chunk"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (held.isEmpty()) Green else Amber,
                        )
                    }
                    if (local.isNotEmpty()) Text(
                        "${local.size} guest Moment(s) on this phone only",
                        style = MaterialTheme.typography.bodySmall, color = Amber,
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (user == null) Button(onClick = { Gate.signIn() }) { Text("Sign in") }
                        else {
                            if (local.any { it.status == "submitted" }) Button(onClick = { Claims.claim(local.filter { it.status == "submitted" }.map { it.id }) }) {
                                Text("Upload guest Moments")
                            }
                            OutlinedButton(onClick = { Auth.signOut() }) { Text("Sign out") }
                        }
                    }
                }
            }
            if (user != null) CreditsRow()
        },
    )
    confirmDelete?.let { id ->
        DeleteMomentDialog(
            onConfirm = { confirmDelete = null; Store.deleteMoment(id) },
            onDismiss = { confirmDelete = null },
        )
    }
}

@Composable
private fun CardList(
    items: List<MomentCard>?, empty: String, onOpen: (String) -> Unit,
    header: (@Composable () -> Unit)? = null,
    onDelete: (MomentCard) -> (() -> Unit)? = { null },
    onUpload: (MomentCard) -> (() -> Unit)? = { null },
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (header != null) item { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { header() } }
        when {
            items == null -> item { Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            items.isEmpty() -> item {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { Text(empty, textAlign = TextAlign.Center, color = Color.Gray) }
            }
            else -> items(items, key = { it.id }) { MomentCardView(it, onDelete = onDelete(it), onUpload = onUpload(it)) { onOpen(it.id) } }
        }
    }
}
