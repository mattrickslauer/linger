package com.mattricks.verified.witness

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.mattricks.verified.MainActivity
import com.mattricks.verified.R

/**
 * Witness requests while the app is in the background or the screen is locked (docs/ARCHITECTURE.md v3.4):
 * a LOCAL notification on channel "witness" (no FCM, works offline). Tapping it opens the live record screen.
 */
object WitnessNotifier {
    private const val CHANNEL = "witness"
    private const val ID = 4711

    fun init(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Witness requests", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "The witness asks for evidence while you record a Moment."
            },
        )
    }

    fun inForeground(): Boolean = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    /** Posts the request only when the app isn't visible. */
    fun notifyIfBackground(ctx: Context, ask: String, why: String) {
        if (inForeground()) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val open = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("tab", 1),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_witness)
            .setContentTitle("Witness: $ask")
            .setContentText(why.ifBlank { "Open Verified to answer while you record." })
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(ID, n)
    }

    fun cancel(ctx: Context) = ctx.getSystemService(NotificationManager::class.java).cancel(ID)
}
