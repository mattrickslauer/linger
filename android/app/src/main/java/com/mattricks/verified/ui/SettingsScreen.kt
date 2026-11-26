package com.mattricks.verified.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.BluetoothConnected
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mattricks.verified.data.Prefs
import com.mattricks.verified.devices.Devices

@Composable
fun SettingsScreen() {
    val dev by Devices.state.collectAsState()
    val mode by Prefs.captureMode.collectAsState()
    val audio by Prefs.videoAudio.collectAsState()
    val scanPerms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { Devices.startScan() }
    val micPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { Prefs.setVideoAudio(it) }
    DisposableEffect(Unit) { onDispose { Devices.stopScan() } }
    val scan = { if (Devices.hasPermissions()) Devices.startScan() else scanPerms.launch(Devices.permissions()) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))

        // ---------- Devices ----------
        Heading("Heart-rate device")
        dev.savedName?.let { name ->
            ListItem(
                headlineContent = { Text(name) },
                supportingContent = {
                    Text(
                        when (dev.link) {
                            Devices.Link.Connected -> "Connected" + (dev.battery?.let { " · battery $it%" } ?: "")
                            Devices.Link.Connecting -> "Connecting…"
                            Devices.Link.Off -> "Reconnects when you start a Moment"
                        },
                    )
                },
                leadingContent = { Icon(if (dev.link == Devices.Link.Connected) Icons.Filled.BluetoothConnected else Icons.Filled.Bluetooth, null, tint = Lake) },
                trailingContent = dev.bpm?.let { bpm ->
                    {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Favorite, null, tint = Bad, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("$bpm", style = Tnum.merge(MaterialTheme.typography.titleLarge))
                        }
                    }
                },
            )
            Row(Modifier.padding(start = 72.dp, end = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (dev.link == Devices.Link.Off) FilledTonalButton(onClick = {
                    if (Devices.hasPermissions()) Devices.reconnect() else scanPerms.launch(Devices.permissions())
                }) { Text("Connect") }
                else OutlinedButton(onClick = { Devices.disconnect() }) { Text("Disconnect") }
                TextButton(onClick = { Devices.disconnect(forget = true) }) { Text("Forget") }
            }
        }
        ListItem(
            headlineContent = { Text(if (dev.scanning) "Scanning…" else if (dev.savedName == null) "Scan for devices" else "Scan for another device") },
            supportingContent = { Text("Straps and watches that broadcast heart rate") },
            leadingContent = { if (dev.scanning) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) else Icon(Icons.Filled.BluetoothSearching, null, tint = Lake) },
            modifier = Modifier.clickable(enabled = !dev.scanning, onClick = scan),
        )
        dev.error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 72.dp)) }
        dev.found.forEach { f ->
            val current = f.address == dev.savedAddress && dev.link != Devices.Link.Off
            ListItem(
                headlineContent = { Text(f.name) },
                supportingContent = { Text((if (f.heartRate) "Heart rate · " else "") + "${f.rssi} dBm") },
                leadingContent = { Icon(if (f.heartRate) Icons.Filled.Favorite else Icons.Filled.Bluetooth, null, tint = if (f.heartRate) Bad else Ink2) },
                trailingContent = { if (current) Icon(Icons.Filled.CheckCircle, "Connected", tint = Ok) else Text("Connect", color = Lake, style = MaterialTheme.typography.labelLarge) },
                modifier = Modifier.clickable(enabled = !current) { Devices.connect(f.address, f.name) },
            )
        }
        InfoLine("Readings are hash-chained into the Moment alongside GPS and motion.")

        // ---------- Camera ----------
        Heading("Camera")
        ListItem(
            headlineContent = { Text("Default capture") },
            leadingContent = { Icon(Glyph.Proof, null, tint = Lake) },
            supportingContent = {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Prefs.CaptureMode.entries.forEachIndexed { i, m ->
                        SegmentedButton(
                            selected = mode == m, onClick = { Prefs.setCaptureMode(m) },
                            shape = SegmentedButtonDefaults.itemShape(i, Prefs.CaptureMode.entries.size),
                            icon = { Icon(if (m == Prefs.CaptureMode.Photo) Glyph.Proof else Glyph.Video, null, Modifier.size(SegmentedButtonDefaults.IconSize)) },
                        ) { Text(if (m == Prefs.CaptureMode.Photo) "Photo" else "Video") }
                    }
                }
            },
        )
        ListItem(
            headlineContent = { Text("Record sound with video") },
            supportingContent = { Text("Clips stay in Movies/Verified; their hash goes in the chain") },
            leadingContent = { Icon(Icons.Filled.Mic, null, tint = Lake) },
            trailingContent = { Switch(checked = audio, onCheckedChange = null) },
            modifier = Modifier.toggleable(audio, role = Role.Switch) { on -> if (on) micPerm.launch(Manifest.permission.RECORD_AUDIO) else Prefs.setVideoAudio(false) },
        )

        // ---------- Map ----------
        Heading("Map")
        ListItem(
            headlineContent = { Text(if (mapboxEnabled) "Mapbox Outdoors" else "Offline track sketch") },
            supportingContent = {
                Text(if (mapboxEnabled) "Live track while recording" else "No Mapbox token in this build: set MAPBOX_ACCESS_TOKEN in android/local.properties and rebuild.")
            },
            leadingContent = { Icon(Icons.Filled.Map, null, tint = Lake) },
        )

        // ---------- About ----------
        Heading("About")
        ListItem(
            headlineContent = { Text("Verified ${com.mattricks.verified.BuildConfig.VERSION_NAME}") },
            supportingContent = { Text("Gemini Nano on device, Gemini in the cloud, sealed by a Cloud Function") },
            leadingContent = { Icon(Glyph.Result, null, tint = MaterialTheme.colorScheme.tertiary) },
        )
    }
}

@Composable
private fun Heading(text: String) {
    Text(
        text, style = MaterialTheme.typography.titleSmall, color = Lake,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp).semantics { heading() },
    )
}

@Composable
private fun InfoLine(text: String) = Text(text, style = MaterialTheme.typography.bodySmall, color = Ink2, modifier = Modifier.padding(start = 72.dp, end = 16.dp, bottom = 4.dp))
