package com.mattricks.verified.ui

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.mattricks.verified.data.Ladder
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Buying credits through pay.mattrickslauer.com (same backend as the web): a pack opens pay's hosted checkout in a
 * Custom Tab; when the app comes back to the front, `confirmCreditPurchase` settles it (the signed webhook does the
 * same, whichever is first, once). The balance pill updates by itself: credits/{uid} is a live Firestore listener.
 */
@Composable
fun BuyCreditsSheet(onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val uid = Firebase.auth.currentUser?.uid
    val live by remember(uid) { uid?.let { Ladder.credits(it) } ?: flowOf(null) }.collectAsState(initial = null)
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var statusOk by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    /** The purchase whose checkout is open in the Custom Tab; survives the activity going to the background. */
    var awaiting by rememberSaveable { mutableStateOf<String?>(null) }

    fun settle(purchaseId: String) {
        checking = true
        status = "Confirming your payment…"
        statusOk = false
        scope.launch {
            try {
                repeat(4) { attempt ->
                    val r = runCatching { Ladder.confirmPurchase(purchaseId) }
                    r.onFailure { e ->
                        if ((e as? Ladder.RunError)?.reason != "pay_unavailable") {
                            status = null; error = Ladder.errorMessage(e); return@launch
                        }
                    }
                    r.getOrNull()?.let { p ->
                        when (p.status) {
                            "paid" -> { status = "Payment received: +${p.credits} credits. You now have ${p.balance}."; statusOk = true; return@launch }
                            "refunded" -> { status = null; error = "That payment was refunded, so no credits were added."; return@launch }
                        }
                    }
                    if (attempt < 3) delay(2000)
                }
                status = "No payment confirmed yet. If you paid by ACH or crypto, credits are added automatically once it clears."
            } finally {
                checking = false
            }
        }
    }

    // Back from the Custom Tab (paid, cancelled or not yet): settle the open purchase.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        awaiting?.let { id -> awaiting = null; settle(id) }
    }

    fun buy(p: Ladder.Pack) {
        error = null; status = null; busy = p.id
        scope.launch {
            try {
                val c = Ladder.buyCredits(p.id)
                awaiting = c.purchaseId
                CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, Uri.parse(c.url))
            } catch (e: Exception) {
                awaiting = null
                error = Ladder.errorMessage(e)
            } finally {
                busy = null
            }
        }
    }

    InfoSheet("Buy credits", { if (busy == null) onDismiss() }, icon = Glyph.Credits) {
        live?.let { c ->
            GlyphPill(Glyph.Credits, "${c.balance} credit${if (c.balance == 1) "" else "s"}", MaterialTheme.colorScheme.tertiaryContainer,
                fg = MaterialTheme.colorScheme.onTertiaryContainer)
        }
        Text("Credits run verification checks on your Moments. They buy scrutiny, never a score, and don't expire.", color = Ink2)
        Ladder.packs.forEach { p ->
            Surface(
                onClick = { buy(p) }, enabled = busy == null && !checking,
                shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp).semantics { contentDescription = "${p.credits} credits for ${price(p.priceCents)}" },
            ) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Glyph.Credits, null, Modifier.size(28.dp), tint = Gold)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("${p.credits} credits", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("${price(p.priceCents / maxOf(1, p.credits))} each", style = MaterialTheme.typography.bodySmall, color = Ink2)
                    }
                    if (busy == p.id) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    else GlyphPill(null, price(p.priceCents), FillLake)
                }
            }
        }
        status?.let {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (checking) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                Text(it, color = if (statusOk) Ok else Ink2, fontWeight = if (statusOk) FontWeight.SemiBold else null, style = MaterialTheme.typography.bodyMedium)
            }
        }
        error?.let { Text(it, color = Bad, style = MaterialTheme.typography.bodyMedium) }
        Text("Checkout is on pay.mattrickslauer.com: card, ACH or crypto. Close the page when you're done to come back.",
            style = MaterialTheme.typography.bodySmall, color = Ink2, modifier = Modifier.padding(top = 4.dp))
    }
}

private fun price(cents: Int): String =
    if (cents % 100 == 0) "$${cents / 100}" else String.format(Locale.US, "$%.2f", cents / 100.0)
