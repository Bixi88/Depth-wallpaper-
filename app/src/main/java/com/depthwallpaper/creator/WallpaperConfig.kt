package com.depthwallpaper.creator

import org.json.JSONObject

/**
 * Rappresenta le impostazioni dell'orologio (Livello 1) cosi' come configurate
 * nell'editor (assets/js/app.js -> stato "clock").
 */
data class ClockConfig(
    val mode: String,       // "time" | "custom"
    val customText: String,
    val showDate: Boolean,
    val fontKey: String,    // "sans" | "serif" | "monospace" | "condensed"
    val bold: Boolean,
    val size: Float,        // in px, alla risoluzione logica 1080x1920 dell'editor
    val color: String,      // "#rrggbb"
    val opacity: Float,     // 0..1
    val x: Float,           // 0..1 relativo alla larghezza
    val y: Float,           // 0..1 relativo all'altezza
    val stretchX: Float,    // 1 = normale; >1 allarga orizzontalmente, <1 restringe
    val stretchY: Float     // 1 = normale; >1 allunga verticalmente, <1 schiaccia
)

/** Configurazione completa dei 3 layer, cosi' come esportata dall'editor. */
data class WallpaperConfig(
    val clock: ClockConfig,
    val bgDim: Float,       // 0..100
    val bgScale: Float,
    val bgOffX: Float,      // -1..1
    val bgOffY: Float,
    val fgScale: Float,
    val fgOffX: Float,      // -1..1
    val fgOffY: Float,
    val parallaxEnabled: Boolean
) {
    companion object {

        /** Configurazione di sicurezza usata se il JSON manca o non è valido. */
        fun default(): WallpaperConfig = WallpaperConfig(
            clock = ClockConfig(
                mode = "time",
                customText = "",
                showDate = true,
                fontKey = "sans",
                bold = true,
                size = 140f,
                color = "#ffffff",
                opacity = 1f,
                x = 0.5f,
                y = 0.35f,
                stretchX = 1f,
                stretchY = 1f
            ),
            bgDim = 0f,
            bgScale = 1f,
            bgOffX = 0f,
            bgOffY = 0f,
            fgScale = 1f,
            fgOffX = 0f,
            fgOffY = 0f,
            parallaxEnabled = true
        )

        fun fromJson(json: String?): WallpaperConfig {
            if (json.isNullOrBlank()) return default()
            return try {
                val root = JSONObject(json)
                val c = root.optJSONObject("clock") ?: JSONObject()
                val clock = ClockConfig(
                    mode = c.optString("mode", "time"),
                    customText = c.optString("customText", ""),
                    showDate = c.optBoolean("showDate", true),
                    fontKey = c.optString("fontKey", "sans"),
                    bold = c.optBoolean("bold", true),
                    size = c.optDouble("size", 140.0).toFloat(),
                    color = c.optString("color", "#ffffff"),
                    opacity = c.optDouble("opacity", 1.0).toFloat(),
                    x = c.optDouble("x", 0.5).toFloat(),
                    y = c.optDouble("y", 0.35).toFloat(),
                    stretchX = c.optDouble("stretchX", 1.0).toFloat(),
                    stretchY = c.optDouble("stretchY", 1.0).toFloat()
                )
                WallpaperConfig(
                    clock = clock,
                    bgDim = root.optDouble("bgDim", 0.0).toFloat(),
                    bgScale = root.optDouble("bgScale", 1.0).toFloat(),
                    bgOffX = root.optDouble("bgOffX", 0.0).toFloat(),
                    bgOffY = root.optDouble("bgOffY", 0.0).toFloat(),
                    fgScale = root.optDouble("fgScale", 1.0).toFloat(),
                    fgOffX = root.optDouble("fgOffX", 0.0).toFloat(),
                    fgOffY = root.optDouble("fgOffY", 0.0).toFloat(),
                    parallaxEnabled = root.optBoolean("parallaxEnabled", true)
                )
            } catch (e: Exception) {
                default()
            }
        }
    }
}
