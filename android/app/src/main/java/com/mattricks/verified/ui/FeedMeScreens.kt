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
import com.mattricks.verified.data.MomentCard
import com.mattricks.verified.data.Store
import com.mattricks.verified.judge.Judging
import kotlinx.coroutines.launch

@Composable
fun FeedScreen(onOpen: (String) -> Unit) {
    val items by remember { Store.feed() }.collectAsState(initial = null)
    CardList(items, empty = "No sealed Moments yet. Record one!", header = "Verified Moments", onOpen = onOpen)
}

@Composable
fun MeScreen(user: FirebaseUser?, onOpen: (String) -> Unit) {
    if (user == null) { SignInCard(); return }
    val items by remember(user.uid) { Store.myMoments(user.uid) }.collectAsState(initial = null)
    val judging by Judging.status.collectAsState()
    val nano by Ai.onDeviceState.collectAsState()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Card(Modifier.fillMaxWidth().padding(16.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text(user.displayName ?: "Signed in", style = MaterialTheme.typography.titleMedium)
                Text(user.email ?: if (user.isAnonymous) "test user" else "", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                Spacer(Modifier.height(6.dp))
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
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { scope.launch { Auth.signOut(ctx) } }) { Text("Sign out") }
            }
        }
        CardList(items, empty = "Your Moments will show up here.", header = null, onOpen = onOpen)
    }
}

@Composable
private fun CardList(items: List<MomentCard>?, empty: String, header: String?, onOpen: (String) -> Unit) {
    when {
        items == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        items.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Text(empty, textAlign = TextAlign.Center, color = Color.Gray)
        }
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (header != null) item { Text(header, style = MaterialTheme.typography.headlineSmall) }
            items(items, key = { it.id }) { MomentCardView(it) { onOpen(it.id) } }
        }
    }
}

@Composable
fun SignInCard() {
    val activity = LocalContext.current as Activity
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.Verified, null, tint = Green, modifier = Modifier.size(64.dp))
        Spacer(Modifier.height(12.dp))
        Text("Verified", style = MaterialTheme.typography.headlineMedium)
        Text("Record proof that a real moment happened.", textAlign = TextAlign.Center, color = Color.Gray)
        Spacer(Modifier.height(24.dp))
        Button(enabled = !busy, onClick = {
            busy = true; error = null
            scope.launch { error = Auth.signInWithGoogle(activity); busy = false }
        }) { Text("Sign in with Google") }
        if (BuildConfig.USE_EMULATOR) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(enabled = !busy, onClick = {
                busy = true; error = null
                scope.launch { error = Auth.signInEmulatorTestUser(); busy = false }
            }) { Text("Emulator test user") }
        }
        if (busy) { Spacer(Modifier.height(12.dp)); CircularProgressIndicator() }
        error?.let { Spacer(Modifier.height(12.dp)); Text(it, color = Red, textAlign = TextAlign.Center) }
        Row {}
    }
}
