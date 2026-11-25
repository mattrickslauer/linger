package com.mattricks.verified

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.auth.Auth
import com.mattricks.verified.auth.Gate
import com.mattricks.verified.data.Claims
import com.mattricks.verified.ui.ClaimSheet
import com.mattricks.verified.ui.SignInSheet
import com.mattricks.verified.ui.DetailScreen
import com.mattricks.verified.ui.FeedScreen
import com.mattricks.verified.ui.MeScreen
import com.mattricks.verified.ui.RecordScreen
import com.mattricks.verified.ui.SettingsScreen
import com.mattricks.verified.ui.VerifiedTheme

class MainActivity : ComponentActivity() {
    companion object {
        /** Tab requested by an intent (the witness notification opens Record = 1). */
        val tabRequest = kotlinx.coroutines.flow.MutableStateFlow<Int?>(null)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        if (intent.hasExtra("tab")) tabRequest.value = intent.getIntExtra("tab", 0)
    }

    override fun onResume() {
        super.onResume()
        Auth.onAppResumed()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent?.hasExtra("tab") == true) tabRequest.value = intent.getIntExtra("tab", 0)
        enableEdgeToEdge()
        setContent {
            VerifiedTheme(dark = isSystemInDarkTheme()) {
                // No sign-in wall (v3.1): the app opens on the Feed as a guest; sign-in is asked for on write.
                val user by remember { Auth.user() }.collectAsState(initial = Firebase.auth.currentUser)
                val ask by Gate.ask.collectAsState()
                val offerClaims by Claims.offer.collectAsState()
                LaunchedEffect(user?.uid) {
                    if (user != null) { Gate.onSignedIn(); Claims.maybeOffer() }
                }
                ask?.let { if (user == null) SignInSheet(it) }
                if (offerClaims && user != null) ClaimSheet()
                var tab by rememberSaveable { mutableStateOf(0) }
                val requested by tabRequest.collectAsState()
                LaunchedEffect(requested) { requested?.let { tab = it; tabRequest.value = null } }
                var open by rememberSaveable { mutableStateOf<String?>(null) }
                var openFromMe by rememberSaveable { mutableStateOf(false) }

                val o = open
                if (o != null) {
                    BackHandler { open = null }
                    DetailScreen(o, fromMe = openFromMe) { open = null }
                    return@VerifiedTheme
                }
                Scaffold(bottomBar = {
                    NavigationBar {
                        listOf(
                            Triple("Feed", Icons.Filled.ViewAgenda, 0),
                            Triple("Record", Icons.Filled.FiberManualRecord, 1),
                            Triple("Me", Icons.Filled.Person, 2),
                            Triple("Settings", Icons.Filled.Settings, 3),
                        ).forEach { (label, icon, i) ->
                            NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Icon(icon, label) }, label = { Text(label) })
                        }
                    }
                }) { pad ->
                    Box(Modifier.padding(pad)) {
                        when (tab) {
                            0 -> FeedScreen(user, onOpen = { open = it; openFromMe = false }, onRecord = { tab = 1 })
                            1 -> RecordScreen(user) { open = it; openFromMe = false }
                            2 -> MeScreen(user) { open = it; openFromMe = true }
                            else -> SettingsScreen()
                        }
                    }
                }
            }
        }
    }
}
