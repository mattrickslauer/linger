package com.mattricks.verified.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.auth
import com.google.firebase.auth.userProfileChangeRequest
import com.google.firebase.options
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Sign-in goes through accounts.mattrickslauer.com (the shared Mattricks login):
 *   1. AppAuth opens a Custom Tab: OIDC authorization code + PKCE, redirect com.mattricks.verified:/oauth2redirect
 *   2. the code is exchanged for an accounts access token
 *   3. accounts swaps that for a Firebase custom token: POST {issuer}/v1/firebase/{projectId}/token
 *   4. signInWithCustomToken — Firebase Auth stays underneath for rules, App Check and AI Logic.
 * The Firebase uid is the accounts user id. Firebase persists the session; accounts keeps its own cookie,
 * so signing in again after sign-out is one tap.
 */
object Auth {
    private const val TAG = "VerifiedAuth"
    private val REDIRECT: Uri = Uri.parse("com.mattricks.verified:/oauth2redirect")

    fun user(): Flow<FirebaseUser?> = callbackFlow {
        val l = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        Firebase.auth.addAuthStateListener(l)
        awaitClose { Firebase.auth.removeAuthStateListener(l) }
    }

    private suspend fun discover(): AuthorizationServiceConfiguration = suspendCancellableCoroutine { c ->
        AuthorizationServiceConfiguration.fetchFromIssuer(Uri.parse(BuildConfig.ACCOUNTS_ISSUER)) { cfg, ex ->
            if (cfg != null) c.resume(cfg) else c.resumeWithException(ex ?: IllegalStateException("discovery failed"))
        }
    }

    /** Step 1: the Custom Tab intent. Launch it for a result and pass the result to [finishSignIn]. */
    suspend fun signInIntent(ctx: Context): Intent {
        val request = AuthorizationRequest.Builder(discover(), BuildConfig.ACCOUNTS_CLIENT_ID, ResponseTypeValues.CODE, REDIRECT)
            .setScope("openid email")
            .build()
        return AuthorizationService(ctx).getAuthorizationRequestIntent(request)
    }

    /** Steps 2-4. Returns an error message, or null when signed in (or cancelled with no message). */
    suspend fun finishSignIn(ctx: Context, data: Intent?): String? {
        if (data == null) return null // back button: not an error
        val response = AuthorizationResponse.fromIntent(data)
        val authError = AuthorizationException.fromIntent(data)
        if (response == null) {
            return if (authError?.code == AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW.code) null
            else authError?.errorDescription ?: authError?.error ?: "Sign-in failed"
        }
        val service = AuthorizationService(ctx)
        return try {
            val accessToken = suspendCancellableCoroutine { c ->
                service.performTokenRequest(response.createTokenExchangeRequest()) { tr, ex ->
                    val t = tr?.accessToken
                    if (t != null) c.resume(t) else c.resumeWithException(ex ?: IllegalStateException("no access token"))
                }
            }
            val bridge = firebaseToken(accessToken)
            val user = Firebase.auth.signInWithCustomToken(bridge.getString("token")).await().user
                ?: return "Sign-in failed"
            if (user.displayName.isNullOrBlank()) {
                val email = bridge.optString("email")
                val name = email.substringBefore('@').replace('.', ' ').replaceFirstChar { it.uppercase() }.ifBlank { "Verified user" }
                user.updateProfile(userProfileChangeRequest { displayName = name }).await()
            }
            Store.upsertUser(Firebase.auth.currentUser ?: user)
            null
        } catch (e: Exception) {
            Log.e(TAG, "sign-in", e)
            e.message ?: e.javaClass.simpleName
        } finally {
            service.dispose()
        }
    }

    /** accounts → Firebase custom token for this app's Firebase project. */
    private suspend fun firebaseToken(accessToken: String): JSONObject = withContext(Dispatchers.IO) {
        val project = Firebase.options.projectId ?: error("Firebase project id missing")
        val conn = URL("${BuildConfig.ACCOUNTS_ISSUER}/v1/firebase/$project/token").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.setRequestProperty("Authorization", "Bearer $accessToken")
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.outputStream.use { }
            val ok = conn.responseCode in 200..299
            val body = (if (ok) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (!ok) error(runCatching { JSONObject(body).getString("message") }.getOrNull() ?: "Firebase token: HTTP ${conn.responseCode}")
            JSONObject(body)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Emulator only: a local user without leaving the app (the Auth emulator accepts an unsigned
     * google.com id_token). Real sign-in above also works against the emulators.
     */
    suspend fun signInEmulatorTestUser(name: String = "Android Tester"): String? {
        if (!BuildConfig.USE_EMULATOR) return "Test sign-in is only available in emulator mode"
        return try {
            val claims = JSONObject()
                .put("sub", "android-tester")
                .put("email", "android.tester@example.com")
                .put("email_verified", true)
                .put("name", name)
            val user = try {
                Firebase.auth.signInWithCredential(com.google.firebase.auth.GoogleAuthProvider.getCredential(claims.toString(), null)).await().user
            } catch (e: Exception) {
                Log.w(TAG, "fake google credential rejected, falling back to anonymous", e)
                Firebase.auth.signInAnonymously().await().user?.also {
                    it.updateProfile(userProfileChangeRequest { displayName = name }).await()
                }
            }
            user?.let { Store.upsertUser(it) }
            null
        } catch (e: Exception) {
            Log.e(TAG, "emulator sign-in", e)
            e.message ?: e.javaClass.simpleName
        }
    }

    fun signOut() {
        Firebase.auth.signOut()
    }
}
