package com.azyvion.crm.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Colores de la marca Azyvion (los mismos de la web)
val Azul = Color(0xFF1F5F99)
val Marino = Color(0xFF12345A)
val Magenta = Color(0xFFC2185B)
val Verde = Color(0xFF16845B)
val Rojo = Color(0xFFC0392B)
val Ambar = Color(0xFFB7791F)

private val Claro = lightColorScheme(
    primary = Azul, onPrimary = Color.White, primaryContainer = Color(0xFFDCE8F5), onPrimaryContainer = Marino,
    secondary = Marino, onSecondary = Color.White, tertiary = Magenta,
    background = Color(0xFFF5F7FA), surface = Color.White, surfaceVariant = Color(0xFFEEF2F7),
    onBackground = Color(0xFF172B4D), onSurface = Color(0xFF172B4D), onSurfaceVariant = Color(0xFF5B6B80),
    error = Rojo, outline = Color(0xFFD5DDE7), outlineVariant = Color(0xFFE2E8F0),
)
private val Oscuro = darkColorScheme(
    primary = Color(0xFF8DB8E6), onPrimary = Color(0xFF0B2440), primaryContainer = Color(0xFF1C3D63), onPrimaryContainer = Color(0xFFDCE8F5),
    secondary = Color(0xFFA9C3E0), tertiary = Color(0xFFF48FB1),
    background = Color(0xFF0D1626), surface = Color(0xFF142035), surfaceVariant = Color(0xFF1C2A42),
    onBackground = Color(0xFFE6ECF4), onSurface = Color(0xFFE6ECF4), onSurfaceVariant = Color(0xFFA3B1C4),
    error = Color(0xFFFF8A80), outline = Color(0xFF34445E), outlineVariant = Color(0xFF26354D),
)

@Composable
fun AzyvionTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Oscuro else Claro, content = content)
}
