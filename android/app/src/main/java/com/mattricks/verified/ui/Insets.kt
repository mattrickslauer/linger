package com.mattricks.verified.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ViewAgenda
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// Edge-to-edge rules (MainActivity enables it, cutout mode ALWAYS): every screen keeps its text and controls clear of
// the status bar, the display cutout (top in portrait, a side in landscape) and the navigation bar; only media
// (feed photo, live camera, evidence-room hero) draws under them. The keyboard is handled per text field (imePadding).

/** System bars + display cutout, without the keyboard: what content and controls must stay clear of. */
val WindowInsets.Companion.safeBars: WindowInsets
    @Composable get() = WindowInsets.systemBars.union(WindowInsets.displayCutout)

/** Top + side safe area, for a full-bleed (media) screen whose bottom the tab bar already clears. */
@Composable
fun Modifier.safeTopAndSides(): Modifier = windowInsetsPadding(WindowInsets.safeBars.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))

/** Side safe area only (landscape: the cutout or the 3-button nav bar on a side). */
@Composable
fun Modifier.safeSides(): Modifier = windowInsetsPadding(WindowInsets.safeBars.only(WindowInsetsSides.Horizontal))

/**
 * The app shell: the current tab over the tab bar. [mediaTab] (feed, live camera) draws full-bleed under the status bar
 * and cutout and insets its own controls ([safeTopAndSides]); the other tabs get the top + side safe area as padding.
 * Only what is applied is consumed, so nested inset modifiers never double-pad or come out zero.
 *
 * A plain Column rather than Scaffold: Scaffold's innerPadding kept the tab bar's old height when the insets arrived
 * after the first layout, so the bottom of each tab slid under the bar (the live shutter, the last button).
 */
@Composable
internal fun AppFrame(tab: Int, mediaTab: Boolean, onTab: (Int) -> Unit, content: @Composable () -> Unit) {
    val safe = WindowInsets.safeBars
    Column(Modifier.fillMaxSize()) {
        // The tab bar covers the nav bar inset plus its own height: both count as consumed for the tab, so imePadding
        // inside nets them out of the keyboard height.
        Box(
            Modifier.weight(1f).fillMaxWidth()
                .consumeWindowInsets(safe.only(WindowInsetsSides.Bottom)).consumeWindowInsets(PaddingValues(bottom = TabBarHeight))
                .then(if (mediaTab) Modifier else Modifier.safeTopAndSides()),
        ) { content() }
        NavigationBar(
            containerColor = if (mediaTab) MediaBg else MaterialTheme.colorScheme.surfaceContainer,
            windowInsets = safe.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
        ) {
            val itemColors = if (mediaTab) NavigationBarItemDefaults.colors(
                selectedIconColor = MediaBg, selectedTextColor = TokInk, indicatorColor = TokInk,
                unselectedIconColor = TokInk2, unselectedTextColor = TokInk2,
            ) else NavigationBarItemDefaults.colors()
            listOf(
                Triple("Feed", if (tab == 0) Icons.Filled.ViewAgenda else Icons.Outlined.ViewAgenda, 0),
                Triple("Record", Icons.Filled.FiberManualRecord, 1),
                Triple("Me", if (tab == 2) Icons.Filled.Person else Icons.Outlined.Person, 2),
                Triple("Settings", if (tab == 3) Icons.Filled.Settings else Icons.Outlined.Settings, 3),
            ).forEach { (label, icon, i) ->
                NavigationBarItem(
                    selected = tab == i, onClick = { onTab(i) }, colors = itemColors, label = { Text(label, maxLines = 1) },
                    icon = { Icon(icon, null, tint = if (i == 1 && tab != 1) FillBad else Color.Unspecified) },
                )
            }
        }
    }
}

/** Material 3 navigation bar height (without the nav bar inset under it). */
private val TabBarHeight = 80.dp
