package com.mattricks.verified.data

import android.content.Context
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.util.UUID

/**
 * Verification ladder + free demo credits (docs/ARCHITECTURE.md v3.6, v3.7). The client only offers modules and
 * previews; `runLadderModule` (Cloud Function) spends credits, runs the module and recomputes the score. Clients
 * never write a score, a credit or a ledger entry.
 */
object Ladder {
    private const val TAG = "VerifiedLadder"
    var modules: List<LadderLogic.Module> = emptyList(); private set
    var needsText: Map<String, String> = emptyMap(); private set
    var freeCredits = 10; private set

    private val functions get() = FirebaseFunctions.getInstance("us-central1")

    fun init(ctx: Context) {
        runCatching {
            val j = JSONObject(ctx.assets.open("ladder.json").bufferedReader().readText())
            freeCredits = j.optInt("freeCredits", 10)
            val a = j.getJSONArray("modules")
            modules = (0 until a.length()).map { i ->
                val m = a.getJSONObject(i)
                LadderLogic.Module(
                    m.getString("id"), m.getString("title"), m.optString("blurb"), m.getInt("cost"), m.getDouble("strength"),
                    m.optBoolean("available", true),
                    m.optJSONArray("needs")?.let { n -> (0 until n.length()).map { n.getString(it) } }.orEmpty(),
                )
            }
            val n = j.optJSONObject("needs")
            needsText = n?.keys()?.asSequence()?.associateWith { n.getString(it) }.orEmpty()
        }.onFailure { Log.e(TAG, "ladder.json missing from assets", it) }
    }

    data class Credits(val balance: Int, val granted: Int, val spent: Int, val justGranted: Boolean = false)

    /** credits/{uid}, readable by its owner only; null until the first grant. */
    fun credits(uid: String): Flow<Credits?> = callbackFlow {
        val reg = Firebase.firestore.collection("credits").document(uid).addSnapshotListener { snap, e ->
            if (e != null) Log.w(TAG, "credits", e)
            trySend(snap?.takeIf { it.exists() }?.let {
                Credits((it.getLong("balance") ?: 0).toInt(), (it.getLong("granted") ?: 0).toInt(), (it.getLong("spent") ?: 0).toInt())
            })
        }
        awaitClose { reg.remove() }
    }

    /** Grants the free demo credits on first use (server-side, idempotent). */
    suspend fun getCredits(): Credits {
        @Suppress("UNCHECKED_CAST")
        val d = functions.getHttpsCallable("getCredits").call(emptyMap<String, Any>()).await().getData() as? Map<String, Any?> ?: emptyMap()
        return Credits(num(d["balance"]).toInt(), num(d["granted"]).toInt(), num(d["spent"]).toInt(), d["justGranted"] == true)
    }

    data class Run(
        val module: String, val passed: Boolean, val confidence: Double, val before: Double, val after: Double,
        val score: Double, val bar: Double, val verified: Boolean, val status: String, val cost: Int, val balance: Int,
        val reasons: List<String>, val measured: List<Measured>,
    )

    class RunError(val reason: String?, message: String) : Exception(message)

    /** One idempotent call; the requestId is made here, so a retry of the same tap never double-charges. */
    suspend fun run(momentId: String, module: String, clipSha: String? = null, requestId: String = UUID.randomUUID().toString()): Run {
        val req = mutableMapOf<String, Any>("momentId" to momentId, "module" to module, "requestId" to requestId)
        clipSha?.let { req["clipSha"] = it }
        try {
            @Suppress("UNCHECKED_CAST")
            val d = functions.getHttpsCallable("runLadderModule").call(req).await().getData() as? Map<String, Any?> ?: emptyMap()
            @Suppress("UNCHECKED_CAST")
            return Run(
                module = d["module"] as? String ?: module, passed = d["passed"] == true, confidence = num(d["confidence"]),
                before = num(d["before"]), after = num(d["after"]), score = num(d["score"]), bar = num(d["bar"]),
                verified = d["verified"] == true, status = d["status"] as? String ?: "", cost = num(d["cost"]).toInt(),
                balance = num(d["balance"]).toInt(), reasons = (d["reasons"] as? List<String>).orEmpty(),
                measured = (d["measured"] as? List<Any?>).orEmpty().mapNotNull { x ->
                    (x as? Map<String, Any?>)?.let { Measured(it["metric"] as? String ?: "", num(it["value"]), it["unit"] as? String ?: "") }
                },
            )
        } catch (e: FirebaseFunctionsException) {
            val reason = (e.details as? Map<*, *>)?.get("reason") as? String
            Log.w(TAG, "runLadderModule ${e.code} $reason", e)
            throw RunError(reason, LadderLogic.message(reason, e.message))
        }
    }

    fun errorMessage(t: Throwable): String = when (t) {
        is RunError -> t.message ?: "Something went wrong."
        is FirebaseFunctionsException -> LadderLogic.message((t.details as? Map<*, *>)?.get("reason") as? String, t.message)
        else -> t.message ?: "Something went wrong."
    }
}
