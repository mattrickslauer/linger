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
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import com.mattricks.verified.ui.DetailScreen
import com.mattricks.verified.ui.FeedScreen
import com.mattricks.verified.ui.MeScreen
import com.mattricks.verified.ui.RecordScreen
import com.mattricks.verified.ui.VerifiedTheme

class MainActivity : ComponentActivity() {
    override fun onResume() {
        super.onResume()
        Auth.onAppResumed()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            VerifiedTheme(dark = isSystemInDarkTheme()) {
                val user by remember { Auth.user() }.collectAsState(initial = Firebase.auth.currentUser)
                var tab by rememberSaveable { mutableStateOf(0) }
                var open by rememberSaveable { mutableStateOf<String?>(null) }

                val o = open
                if (o != null) {
                    BackHandler { open = null }
                    DetailScreen(o) { open = null }
                    return@VerifiedTheme
                }
                Scaffold(bottomBar = {
                    NavigationBar {
                        listOf(
                            Triple("Feed", Icons.Filled.ViewAgenda, 0),
                            Triple("Record", Icons.Filled.FiberManualRecord, 1),
                            Triple("Me", Icons.Filled.Person, 2),
                        ).forEach { (label, icon, i) ->
                            NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Icon(icon, label) }, label = { Text(label) })
                        }
                    }
                }) { pad ->
                    Box(Modifier.padding(pad)) {
                        when (tab) {
                            0 -> FeedScreen { open = it }
                            1 -> RecordScreen(user) { open = it }
                            else -> MeScreen(user) { open = it }
                        }
                    }
                }
            }
        }
    }
}
