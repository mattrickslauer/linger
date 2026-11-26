package com.mattricks.verified

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import com.mattricks.verified.record.RecordViewModel
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.auth.Auth
import com.mattricks.verified.auth.Gate
import com.mattricks.verified.data.Claims
import com.mattricks.verified.ui.AppFrame
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
                var open by rememberSaveable { mutableStateOf<String?>(null) }
                var openFromMe by rememberSaveable { mutableStateOf(false) }
                val requested by tabRequest.collectAsState()
                // The witness notification opens the live record screen, even from a Moment's detail.
                LaunchedEffect(requested) { requested?.let { tab = it; open = null; tabRequest.value = null } }

                // Keeps the Feed pager (page, tab) while an evidence room or another tab is shown: back lands on the same slide.
                val screens = rememberSaveableStateHolder()
                val recordingId by RecordViewModel.recording.collectAsState()
                // Status / nav bar icons: light over the dark media screens (feed, live camera, evidence-room hero).
                val darkTheme = isSystemInDarkTheme()
                val lightIcons = darkTheme || open != null || tab == 0 || (tab == 1 && recordingId != null)
                LaunchedEffect(lightIcons) {
                    val style = if (lightIcons) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                    else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                }
                val o = open
                if (o != null) {
                    BackHandler { open = null }
                    DetailScreen(o, fromMe = openFromMe) { open = null }
                    return@VerifiedTheme
                }
                // The feed and the live camera are always dark: the bottom bar goes dark with them.
                val mediaTab = tab == 0 || (tab == 1 && recordingId != null)
                AppFrame(tab, mediaTab, onTab = { tab = it }) {
                    when (tab) {
                        0 -> screens.SaveableStateProvider("feed") {
                            FeedScreen(user, onOpen = { open = it; openFromMe = false }, onRecord = { tab = 1 })
                        }
                        1 -> RecordScreen(user) { open = it; openFromMe = false }
                        2 -> MeScreen(user) { open = it; openFromMe = true }
                        else -> SettingsScreen()
                    }
                }
            }
        }
    }
}
