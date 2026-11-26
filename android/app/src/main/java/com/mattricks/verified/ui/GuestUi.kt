package com.mattricks.verified.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.IconButton
import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseUser
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.auth.Auth
import com.mattricks.verified.auth.Gate
import com.mattricks.verified.data.Claims
import com.mattricks.verified.data.Store
import com.mattricks.verified.data.Vault
import kotlinx.coroutines.launch

/** "Sign in to <action>" (v3.1), shown by [Gate]: one hero line, three glyph tiles, one button. Resumes the action after sign-in. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInSheet(ask: Gate.Ask) {
    val activity = LocalContext.current as Activity
    val scope = rememberCoroutineScope()
    val state by Auth.signIn.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val working = busy || state == Auth.SignIn.InBrowser || state == Auth.SignIn.Finishing
    ModalBottomSheet(onDismissRequest = { Gate.dismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(64.dp).clip(CircleShape).background(SealGold), contentAlignment = Alignment.Center) {
                Icon(Glyph.Result, null, tint = SealInk, modifier = Modifier.size(36.dp))
            }
            Text("Sign in to ${ask.action}", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GlyphTile(Glyph.Cloud, "Stored", "On the server", Modifier.weight(1f))
                GlyphTile(Glyph.Ai, "Reviewed", "By cloud AI", Modifier.weight(1f))
                GlyphTile(Glyph.Result, "Sealed", "By code", Modifier.weight(1f), tint = MaterialTheme.colorScheme.tertiary)
            }
            Button(
                enabled = !working, onClick = { error = null; Auth.startSignIn(activity) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(28.dp),
            ) { Text("Sign in", style = MaterialTheme.typography.titleMedium) }
            if (BuildConfig.USE_EMULATOR) OutlinedButton(enabled = !working, onClick = {
                busy = true; error = null
                scope.launch { error = Auth.signInEmulatorTestUser(); busy = false }
            }) { Text("Emulator test user") }
            if (working) Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(if (state == Auth.SignIn.Finishing) "Signing you in…" else "Finish in the browser…", color = Ink2)
            }
            (error ?: (state as? Auth.SignIn.Failed)?.message)?.let { Text(it, color = Bad, textAlign = TextAlign.Center) }
            Text("Browsing and recording need no account.", style = MaterialTheme.typography.bodySmall, color = Ink2, textAlign = TextAlign.Center)
            TextButton(onClick = { Gate.dismiss() }) { Text("Not now") }
        }
    }
}

/** "You recorded N Moments as a guest" (v3.1 claim flow): thumbnails, keep or delete each, one Upload all. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClaimSheet() {
    val guests by Vault.guests.collectAsState()
    val uploading by Claims.uploading.collectAsState()
    val list = guests.filter { it.status == "submitted" && it.id !in uploading }
    var kept by remember { mutableStateOf(setOf<String>()) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val shown = list.filter { it.id !in kept }
    if (shown.isEmpty()) {
        androidx.compose.runtime.LaunchedEffect(Unit) { Claims.dismiss() }
        return
    }
    ModalBottomSheet(onDismissRequest = { Claims.dismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CloudUpload, null, tint = Lake)
                Spacer(Modifier.width(10.dp))
                Text(
                    "${shown.size} guest Moment${if (shown.size == 1) "" else "s"} on this phone",
                    style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f),
                )
                InfoButton("Upload guest Moments") {
                    Text("Upload them to your account to get them verified. Their hash chains stay exactly as recorded.")
                }
            }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(shown, key = { it.id }) { m ->
                    Column(Modifier.width(150.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Box(Modifier.size(150.dp, 180.dp).clip(RoundedCornerShape(16.dp))) {
                            B64Image(m.heroB64, Modifier.matchParentSize())
                            Box(Modifier.matchParentSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(0.5f to androidx.compose.ui.graphics.Color.Transparent, 1f to MediaBg.copy(alpha = 0.9f))))
                            Column(Modifier.align(Alignment.BottomStart).padding(8.dp)) {
                                Text(m.text, color = TokInk, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                                StatOverlay(Glyph.Time, fmtDuration(m.summary.durationMs))
                            }
                        }
                        Row {
                            TextButton(onClick = { kept = kept + m.id }, modifier = Modifier.weight(1f)) { Text("Keep here") }
                            IconButton(onClick = { confirmDelete = m.id }) { Icon(Icons.Filled.Delete, "Delete", tint = Bad) }
                        }
                    }
                }
            }
            Button(
                onClick = { Claims.claim(shown.map { it.id }) }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(28.dp),
            ) { Icon(Icons.Filled.CloudUpload, null); Spacer(Modifier.width(8.dp)); Text("Upload all", style = MaterialTheme.typography.titleMedium) }
            TextButton(onClick = { Claims.dismiss() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Not now") }
        }
    }
    confirmDelete?.let { id ->
        DeleteMomentDialog(onConfirm = { confirmDelete = null; Store.deleteMoment(id) }, onDismiss = { confirmDelete = null })
    }
}
