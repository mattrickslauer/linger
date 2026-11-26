package com.mattricks.verified.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight

// Shared design tokens (docs/superpowers/specs/2026-11-25-ui-overhaul-visual-first.md "Identity"): deep-lake ink,
// lichen paper, seal gold as the one loud element, GPS orange for tracks. Same table on web and iOS.

/** One theme's semantic colours, for the places Material's ColorScheme has no slot (ok / bad / warn / gold / track). */
data class VPalette(
    val dark: Boolean,
    val paper: Color,
    val sheet: Color,
    val ink: Color,
    val ink2: Color,
    val lake: Color,
    val ok: Color,
    val bad: Color,
    /** Warn for "pending / below the bar" text; a darkened gold so it holds AA on paper. */
    val warn: Color,
    val gold: Color,
    val track: Color,
)

val LightV = VPalette(
    dark = false, paper = Color(0xFFE8ECE4), sheet = Color(0xFFF5F7F2), ink = Color(0xFF10242B), ink2 = Color(0xFF3F5459),
    lake = Color(0xFF1F6F78), ok = Color(0xFF2F7A4B), bad = Color(0xFFB8322A), warn = Color(0xFF8A6100),
    gold = Color(0xFFE7B425), track = Color(0xFFD9480F),
)
val DarkV = VPalette(
    dark = true, paper = Color(0xFF0F2127), sheet = Color(0xFF17303A), ink = Color(0xFFE4EBE3), ink2 = Color(0xFFB4C4C0),
    lake = Color(0xFF6CC3C6), ok = Color(0xFF7FD19B), bad = Color(0xFFF08A78), warn = Color(0xFFE7B425),
    gold = Color(0xFFE7B425), track = Color(0xFFFF8A4C),
)

/** Feed / media background: the same deep near-black in both themes. */
val MediaBg = Color(0xFF071419)

val LocalV = staticCompositionLocalOf { LightV }

/** Theme-aware semantic colours (text-safe on the current background). */
val Ok: Color @Composable @ReadOnlyComposable get() = LocalV.current.ok
val Bad: Color @Composable @ReadOnlyComposable get() = LocalV.current.bad
val Warn: Color @Composable @ReadOnlyComposable get() = LocalV.current.warn
val Lake: Color @Composable @ReadOnlyComposable get() = LocalV.current.lake
val Ink2: Color @Composable @ReadOnlyComposable get() = LocalV.current.ink2
val Gold: Color @Composable @ReadOnlyComposable get() = LocalV.current.gold
val Track: Color @Composable @ReadOnlyComposable get() = LocalV.current.track

/** Solid fills for badges: fixed in both themes so white / ink text on them always passes AA. */
val FillOk = Color(0xFF2F7A4B)
val FillBad = Color(0xFFB8322A)
val FillLake = Color(0xFF1F6F78)
val FillInk = Color(0xFF3F5459)

val VerifiedLight = lightColorScheme(
    primary = LightV.lake, onPrimary = Color.White,
    primaryContainer = Color(0xFFCBE6E6), onPrimaryContainer = Color(0xFF0B3A40),
    secondary = LightV.ink2, onSecondary = Color.White,
    secondaryContainer = Color(0xFFD5DED5), onSecondaryContainer = LightV.ink,
    tertiary = Color(0xFF7A5A00), onTertiary = Color.White,
    tertiaryContainer = LightV.gold, onTertiaryContainer = LightV.ink,
    error = LightV.bad, onError = Color.White, errorContainer = Color(0xFFF7DAD6), onErrorContainer = Color(0xFF5C120D),
    background = LightV.paper, onBackground = LightV.ink,
    surface = LightV.sheet, onSurface = LightV.ink,
    surfaceVariant = Color(0xFFDCE3DA), onSurfaceVariant = LightV.ink2,
    surfaceTint = LightV.lake,
    outline = Color(0xFF6F8186), outlineVariant = Color(0xFFC3CCC4),
    inverseSurface = LightV.ink, inverseOnSurface = LightV.paper, inversePrimary = DarkV.lake,
    surfaceContainerLowest = Color(0xFFFBFCF9), surfaceContainerLow = Color(0xFFF1F4EE),
    surfaceContainer = Color(0xFFECF0E8), surfaceContainerHigh = Color(0xFFE4E9E1), surfaceContainerHighest = Color(0xFFDDE3DA),
    surfaceBright = LightV.sheet, surfaceDim = Color(0xFFD6DCD2),
)

val VerifiedDark = darkColorScheme(
    primary = DarkV.lake, onPrimary = Color(0xFF00363A),
    primaryContainer = Color(0xFF1F4F56), onPrimaryContainer = Color(0xFFCDEDEE),
    secondary = DarkV.ink2, onSecondary = DarkV.paper,
    secondaryContainer = Color(0xFF2A454E), onSecondaryContainer = DarkV.ink,
    tertiary = DarkV.gold, onTertiary = LightV.ink,
    tertiaryContainer = Color(0xFF5A4500), onTertiaryContainer = Color(0xFFFFE08A),
    error = DarkV.bad, onError = Color(0xFF4A0D08), errorContainer = Color(0xFF6E1F18), onErrorContainer = Color(0xFFFFDAD4),
    background = DarkV.paper, onBackground = DarkV.ink,
    surface = DarkV.paper, onSurface = DarkV.ink,
    surfaceVariant = Color(0xFF24414B), onSurfaceVariant = DarkV.ink2,
    surfaceTint = DarkV.lake,
    outline = Color(0xFF7E9297), outlineVariant = Color(0xFF2F4A53),
    inverseSurface = DarkV.ink, inverseOnSurface = DarkV.paper, inversePrimary = LightV.lake,
    surfaceContainerLowest = Color(0xFF0B1A1F), surfaceContainerLow = Color(0xFF132A31),
    surfaceContainer = DarkV.sheet, surfaceContainerHigh = Color(0xFF1D3842), surfaceContainerHighest = Color(0xFF24414B),
    surfaceBright = Color(0xFF2A4752), surfaceDim = DarkV.paper,
)

private val Base = Typography()

/** Default Material type (Roboto Flex on recent Android), a touch heavier and tighter for display sizes. */
val VerifiedType = Base.copy(
    displaySmall = Base.displaySmall.copy(fontWeight = FontWeight.ExtraBold),
    headlineLarge = Base.headlineLarge.copy(fontWeight = FontWeight.ExtraBold),
    headlineMedium = Base.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
    headlineSmall = Base.headlineSmall.copy(fontWeight = FontWeight.Bold),
    titleLarge = Base.titleLarge.copy(fontWeight = FontWeight.Bold),
    titleMedium = Base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
)

/** Tabular figures for every number that changes (timers, scores, counts). */
val Tnum = TextStyle(fontFeatureSettings = "tnum")

@Composable
fun VerifiedTheme(dark: Boolean, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalV provides if (dark) DarkV else LightV) {
        MaterialTheme(colorScheme = if (dark) VerifiedDark else VerifiedLight, typography = VerifiedType, content = content)
    }
}

/** Always-dark media screens (feed, live camera) use the dark palette whatever the system theme. */
@Composable
fun MediaTheme(content: @Composable () -> Unit) = VerifiedTheme(dark = true, content = content)
