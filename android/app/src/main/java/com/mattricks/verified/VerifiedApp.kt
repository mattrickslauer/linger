package com.mattricks.verified

import android.app.Application
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.auth.auth
import com.google.firebase.firestore.firestore
import com.google.firebase.firestore.firestoreSettings
import com.google.firebase.firestore.persistentCacheSettings
import com.google.firebase.initialize
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import com.mattricks.verified.ai.Ai
import com.mattricks.verified.data.Claims
import com.mattricks.verified.data.Prefs
import com.mattricks.verified.data.Vault
import com.mattricks.verified.devices.Devices
import com.mapbox.common.MapboxOptions
import com.mattricks.verified.judge.Judging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class VerifiedApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Firebase.initialize(this)

        if (BuildConfig.DEBUG) {
            // Debug token is logged by DebugAppCheckProvider; register it in the console (App Check > Apps).
            Firebase.appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
        } else {
            // Release (Play installs): Play Integrity. Needs the Play app-signing SHA-256 in Firebase App Check.
            Firebase.appCheck.installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
        }

        val db = Firebase.firestore
        // Offline-first: persistent cache (on by default; made explicit + roomy for frames).
        db.firestoreSettings = firestoreSettings {
            setLocalCacheSettings(persistentCacheSettings { setSizeBytes(200L * 1024 * 1024) })
        }
        if (BuildConfig.USE_EMULATOR) {
            val host = BuildConfig.EMULATOR_HOST
            db.useEmulator(host, 8080)
            Firebase.auth.useEmulator(host, 9099)
            Log.i(TAG, "Using Firebase Emulator Suite at $host (firestore 8080, auth 9099)")
        }

        // Model name from Remote Config key `cloud_model` (contract default gemini-3.5-flash).
        runCatching {
            val rc = Firebase.remoteConfig
            rc.setConfigSettingsAsync(remoteConfigSettings { minimumFetchIntervalInSeconds = 3600 })
            rc.setDefaultsAsync(mapOf("cloud_model" to BuildConfig.DEFAULT_CLOUD_MODEL))
            rc.fetchAndActivate()
        }.onFailure { Log.w(TAG, "remote config", it) }

        Prefs.init(this)
        com.mattricks.verified.voice.Voice.init(this)
        Devices.init(this)
        if (BuildConfig.MAPBOX_TOKEN.isNotBlank()) MapboxOptions.accessToken = BuildConfig.MAPBOX_TOKEN

        Ai.warmUp(this)
        Judging.init(this)
        Vault.init(this)
        Firebase.auth.addAuthStateListener {
            if (it.currentUser != null) { Judging.kick(); vaultScope.launch { Vault.verifyAll() }; Claims.maybeOffer() }
        }
        // Raw data leaves the phone only once the server provably has all of it; re-check while the app runs.
        vaultScope.launch {
            while (true) {
                delay(30_000)
                runCatching { Vault.verifyAll() }.onFailure { Log.w(TAG, "vault", it) }
            }
        }
    }

    private val vaultScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    companion object { const val TAG = "Verified" }
}
