package com.mattricks.verified.ui

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

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall)

        // ---------- Devices ----------
        Heading("Devices")
        Text(
            "Connect a Bluetooth heart-rate strap, or a watch that broadcasts heart rate. While you record, readings are " +
                "hash-chained into the Moment alongside GPS and motion.",
            style = MaterialTheme.typography.bodySmall, color = Color.Gray,
        )
        dev.savedName?.let { name ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (dev.link == Devices.Link.Connected) Icons.Filled.BluetoothConnected else Icons.Filled.Bluetooth, null)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(name, fontWeight = FontWeight.SemiBold)
                            Text(
                                when (dev.link) {
                                    Devices.Link.Connected -> "Connected" + (dev.battery?.let { " · battery $it%" } ?: "")
                                    Devices.Link.Connecting -> "Connecting…"
                                    Devices.Link.Off -> "Not connected · reconnects when you start a Moment"
                                },
                                style = MaterialTheme.typography.bodySmall, color = Color.Gray,
                            )
                        }
                        dev.bpm?.let {
                            Icon(Icons.Filled.Favorite, null, tint = Red, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("$it", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (dev.link == Devices.Link.Off) Button(onClick = {
                            if (Devices.hasPermissions()) Devices.reconnect() else scanPerms.launch(Devices.permissions())
                        }) { Text("Connect") }
                        else OutlinedButton(onClick = { Devices.disconnect() }) { Text("Disconnect") }
                        TextButton(onClick = { Devices.disconnect(forget = true) }) { Text("Forget") }
                    }
                }
            }
        }
        Button(
            onClick = { if (Devices.hasPermissions()) Devices.startScan() else scanPerms.launch(Devices.permissions()) },
            enabled = !dev.scanning, modifier = Modifier.fillMaxWidth(),
        ) {
            if (dev.scanning) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White); Spacer(Modifier.width(8.dp)); Text("Scanning…") }
            else Text(if (dev.savedName == null) "Scan for devices" else "Scan for another device")
        }
        dev.error?.let { Text(it, color = Red, style = MaterialTheme.typography.bodySmall) }
        if (dev.found.isNotEmpty()) Card(Modifier.fillMaxWidth()) {
            dev.found.forEachIndexed { i, f ->
                if (i > 0) HorizontalDivider()
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(f.name, fontWeight = FontWeight.SemiBold)
                        Text(
                            (if (f.heartRate) "Heart rate · " else "") + "${f.rssi} dBm",
                            style = MaterialTheme.typography.bodySmall, color = if (f.heartRate) Green else Color.Gray,
                        )
                    }
                    val current = f.address == dev.savedAddress && dev.link != Devices.Link.Off
                    TextButton(enabled = !current, onClick = { Devices.connect(f.address, f.name) }) { Text(if (current) "Connected" else "Connect") }
                }
            }
        } else if (dev.scanning) Text("Looking for nearby Bluetooth devices…", style = MaterialTheme.typography.bodySmall, color = Color.Gray)

        // ---------- Camera ----------
        Heading("Camera")
        Text("Default capture mode", style = MaterialTheme.typography.bodyMedium)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            Prefs.CaptureMode.entries.forEachIndexed { i, m ->
                SegmentedButton(
                    selected = mode == m, onClick = { Prefs.setCaptureMode(m) },
                    shape = SegmentedButtonDefaults.itemShape(i, Prefs.CaptureMode.entries.size),
                ) { Text(if (m == Prefs.CaptureMode.Photo) "Proof photo" else "Video clip") }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Record sound with video", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Clips are saved to Movies/Verified on this phone. Their SHA-256 and a poster frame go into the chain.",
                    style = MaterialTheme.typography.bodySmall, color = Color.Gray,
                )
            }
            Switch(checked = audio, onCheckedChange = { on -> if (on) micPerm.launch(Manifest.permission.RECORD_AUDIO) else Prefs.setVideoAudio(false) })
        }

        // ---------- Map ----------
        Heading("Map")
        Text(
            if (mapboxEnabled) "Mapbox Outdoors · live track while recording."
            else "No Mapbox token in this build, so tracks are drawn without map tiles. Set MAPBOX_ACCESS_TOKEN in android/local.properties and rebuild.",
            style = MaterialTheme.typography.bodySmall, color = Color.Gray,
        )
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
}
