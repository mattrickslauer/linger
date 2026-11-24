package com.mattricks.verified.auth

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.auth
import com.google.firebase.auth.userProfileChangeRequest
import com.google.firebase.options
import com.mattricks.verified.BuildConfig
import com.mattricks.verified.data.Store
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Sign-in goes through accounts.mattrickslauer.com (the shared Mattricks login), as the public client `verified-app`:
 *   1. a Custom Tab opens the accounts login: OIDC authorization code + PKCE
 *   2. the redirect lands on a loopback port in this app (RFC 8252 §7.3). Chrome won't follow a server redirect
 *      to a custom scheme after the Google account chooser, but an http page always loads; that page then sends
 *      the browser back to com.mattricks.verified://signed-in (with a tap-able link as a fallback)
 *   3. once the app is in front again (MIUI stalls background network), the code is traded for an access token
 *   4. accounts swaps that for a Firebase custom token: POST {issuer}/v1/firebase/{projectId}/token
 *   5. signInWithCustomToken. Firebase Auth stays underneath for rules, App Check and AI Logic; the Firebase uid
 *      is the accounts user id, and Firebase persists the session.
 * Same pattern as puq-android (puq-city/apps/puq-native/android/.../data/Auth.kt).
 */
object Auth {
    private const val TAG = "VerifiedAuth"
    private const val PORT = 47231 // puq-android uses 47219
    private const val REDIRECT = "http://127.0.0.1:$PORT/auth"
    private const val RETURN = "com.mattricks.verified://signed-in"

    sealed interface SignIn {
        data object Idle : SignIn
        /** The login page is open in the browser. */
        data object InBrowser : SignIn
        /** The browser came back with a code; finishing. */
        data object Finishing : SignIn
        data class Failed(val message: String) : SignIn
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _signIn = MutableStateFlow<SignIn>(SignIn.Idle)
    val signIn: StateFlow<SignIn> = _signIn
    @Volatile private var server: ServerSocket? = null
    @Volatile private var codeArrived = false

    fun user(): Flow<FirebaseUser?> = callbackFlow {
        val l = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        Firebase.auth.addAuthStateListener(l)
        awaitClose { Firebase.auth.removeAuthStateListener(l) }
    }

    private class Cancelled : Exception()

    /** Opens the accounts login; progress and errors arrive in [signIn]. Safe to call again: the old attempt closes. */
    fun startSignIn(context: Context) {
        closeServer()
        scope.launch {
            _signIn.value = try {
                run(context)
                SignIn.Idle
            } catch (e: Cancelled) {
                SignIn.Idle
            } catch (e: Exception) {
                Log.e(TAG, "sign-in", e)
                SignIn.Failed(e.message ?: "Sign-in didn't finish. Try again.")
            }
        }
    }

    private suspend fun run(context: Context) {
        val verifier = random(48)
        val challenge = b64(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = random(16)
        val url = Uri.parse("${BuildConfig.ACCOUNTS_ISSUER}/auth").buildUpon()
            .appendQueryParameter("client_id", BuildConfig.ACCOUNTS_CLIENT_ID)
            .appendQueryParameter("redirect_uri", REDIRECT)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("scope", "openid email")
            .appendQueryParameter("state", state)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .build()
        val socket = withContext(Dispatchers.IO) { ServerSocket(PORT, 1, InetAddress.getByName("127.0.0.1")) }
        server = socket
        codeArrived = false
        _signIn.value = SignIn.InBrowser
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, url)
        val (code, gotState) = try {
            withContext(Dispatchers.IO) { awaitRedirect(socket) }
        } catch (e: SocketException) {
            throw Cancelled() // closed by onAppResumed: the login page was left without signing in
        } finally {
            closeServer()
        }
        if (gotState != state) throw Cancelled()
        if (code == null) error("Sign-in was declined.")
        _signIn.value = SignIn.Finishing
        // Trade the code only once we're in front again (it is good for 60 s; wait at most 10).
        withTimeoutOrNull(10_000) {
            while (!ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) delay(100)
        }
        val tokens = post(
            "${BuildConfig.ACCOUNTS_ISSUER}/token",
            form = mapOf(
                "client_id" to BuildConfig.ACCOUNTS_CLIENT_ID, "grant_type" to "authorization_code", "code" to code,
                "redirect_uri" to REDIRECT, "code_verifier" to verifier,
            ),
        )
        val project = Firebase.options.projectId ?: error("Firebase project id missing")
        val bridge = post("${BuildConfig.ACCOUNTS_ISSUER}/v1/firebase/$project/token", bearer = tokens.getString("access_token"))
        val user = Firebase.auth.signInWithCustomToken(bridge.getString("token")).await().user ?: error("Sign-in failed")
        if (user.displayName.isNullOrBlank()) {
            val name = bridge.optString("email").substringBefore('@').replace('.', ' ')
                .replaceFirstChar { it.uppercase() }.ifBlank { "Verified user" }
            user.updateProfile(userProfileChangeRequest { displayName = name }).await()
        }
        Store.upsertUser(Firebase.auth.currentUser ?: user)
    }

    /**
     * MainActivity calls this when the app comes back. If the login page was left without signing in (tab closed),
     * no redirect will ever come: give the browser a moment, then stop waiting.
     */
    fun onAppResumed() {
        if (_signIn.value != SignIn.InBrowser) return
        scope.launch {
            delay(1500)
            if (_signIn.value == SignIn.InBrowser && !codeArrived) closeServer()
        }
    }

    private fun closeServer() { runCatching { server?.close() }; server = null }

    /** Reads one request on the loopback port and answers it by sending the browser back to the app. */
    private fun awaitRedirect(server: ServerSocket): Pair<String?, String?> {
        while (true) {
            server.accept().use { s ->
                val path = s.getInputStream().bufferedReader().readLine()?.split(" ")?.getOrNull(1) ?: ""
                if (!path.startsWith("/auth")) { // favicon or a stray request: answer and keep waiting
                    s.getOutputStream().write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    return@use
                }
                codeArrived = true
                val q = Uri.parse("http://127.0.0.1$path")
                val html = """<!doctype html><meta name=viewport content="width=device-width">
                    <body style="font-family:sans-serif;background:#14121a;color:#eee;text-align:center;padding:48px 16px">
                    <h2>Signed in</h2><p><a href="$RETURN" style="color:#6fd6a0">Back to Verified</a></p>
                    <script>location.replace("$RETURN")</script>"""
                val bytes = html.toByteArray()
                s.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray() + bytes)
                s.getOutputStream().flush()
                return q.getQueryParameter("code") to q.getQueryParameter("state")
            }
        }
    }

    private suspend fun post(url: String, form: Map<String, String>? = null, bearer: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            bearer?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            val body = form?.entries?.joinToString("&") { (k, v) -> "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}" }.orEmpty()
            if (form != null) conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            conn.outputStream.use { it.write(body.toByteArray()) }
            val ok = conn.responseCode in 200..299
            val text = (if (ok) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (!ok) {
                val j = runCatching { JSONObject(text) }.getOrNull()
                error(j?.optString("message")?.takeIf { it.isNotBlank() } ?: j?.optString("error_description")?.takeIf { it.isNotBlank() }
                    ?: "Sign-in failed (HTTP ${conn.responseCode})")
            }
            JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }

    private fun random(n: Int) = b64(ByteArray(n).also { SecureRandom().nextBytes(it) })
    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

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
