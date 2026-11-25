package com.mattricks.verified.auth

import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Sign-in on write (docs/ARCHITECTURE.md v3.1). There is no sign-in wall: guests browse and record locally. An action
 * that must write to the server calls [require]; signed in it runs now, otherwise the "Sign in to <action>" sheet
 * opens and the action resumes once sign-in finishes.
 */
object Gate {
    data class Ask(val action: String, val then: () -> Unit)

    private val _ask = MutableStateFlow<Ask?>(null)
    val ask: StateFlow<Ask?> = _ask

    fun require(action: String, then: () -> Unit) {
        if (Firebase.auth.currentUser != null) then() else _ask.value = Ask(action, then)
    }

    /** Opens the sheet with no action to resume (the quiet "Sign in" button). */
    fun signIn() { _ask.value = Ask("sync your Moments") {} }

    /** Called when a user is signed in: resume the pending action. */
    fun onSignedIn() {
        val a = _ask.value ?: return
        _ask.value = null
        a.then()
    }

    fun dismiss() { _ask.value = null }
}
