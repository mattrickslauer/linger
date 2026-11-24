package com.mattricks.verified.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Small user settings (Settings tab), backed by SharedPreferences. */
object Prefs {
    enum class CaptureMode { Photo, Video }

    private lateinit var sp: SharedPreferences
    private val _captureMode = MutableStateFlow(CaptureMode.Photo)
    private val _videoAudio = MutableStateFlow(true)
    val captureMode: StateFlow<CaptureMode> = _captureMode
    val videoAudio: StateFlow<Boolean> = _videoAudio

    fun init(ctx: Context) {
        sp = ctx.getSharedPreferences("settings", Context.MODE_PRIVATE)
        _captureMode.value = runCatching { CaptureMode.valueOf(sp.getString("captureMode", null) ?: "Photo") }.getOrDefault(CaptureMode.Photo)
        _videoAudio.value = sp.getBoolean("videoAudio", true)
    }

    fun setCaptureMode(m: CaptureMode) { _captureMode.value = m; sp.edit().putString("captureMode", m.name).apply() }
    fun setVideoAudio(on: Boolean) { _videoAudio.value = on; sp.edit().putBoolean("videoAudio", on).apply() }
}
