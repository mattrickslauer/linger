package com.mattricks.verified.data

import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.judge.Judging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Claim-on-sign-in (docs/ARCHITECTURE.md v3.1): guest Moments are offered for upload once per session, on sign-in
 * or app start while signed in. Accepted ones get the owner in the journal; the raw vault then re-creates them on
 * the server and the cloud review (judge + skeptic + scorer) runs as for any Moment.
 */
object Claims {
    private const val TAG = "VerifiedClaims"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var offeredThisSession = false

    private val _offer = MutableStateFlow(false)
    /** True while the "You recorded N Moments as a guest" sheet should show. */
    val offer: StateFlow<Boolean> = _offer

    private val _uploading = MutableStateFlow<Set<String>>(emptySet())
    val uploading: StateFlow<Set<String>> = _uploading

    fun claimable(): List<Vault.LocalMoment> = Vault.guests.value.filter { it.status == "submitted" }

    /** On sign-in / app start while signed in: at most once per session. */
    fun maybeOffer() {
        if (Firebase.auth.currentUser == null || offeredThisSession) return
        if (claimable().isEmpty()) return
        offeredThisSession = true
        _offer.value = true
    }

    /** A guest Moment finished while the user is signed in (it was still recording at sign-in): offer it now. */
    fun offerAfterFinish() {
        if (Firebase.auth.currentUser == null || claimable().isEmpty()) return
        _offer.value = true
    }

    fun dismiss() { _offer.value = false }

    /** Upload these guest Moments to the signed-in account. */
    fun claim(ids: List<String>) {
        val u = Firebase.auth.currentUser ?: return
        _offer.value = false
        _uploading.value = _uploading.value + ids
        scope.launch {
            for (id in ids) {
                runCatching { Vault.claim(id, u.uid, u.displayName ?: "Anonymous", u.photoUrl?.toString()) }
                    .onFailure { Log.e(TAG, "claim $id", it) }
            }
            runCatching { Vault.verifyAll() }.onFailure { Log.w(TAG, "verify after claim", it) }
            _uploading.value = _uploading.value - ids.toSet()
            Judging.kick()
        }
    }
}
