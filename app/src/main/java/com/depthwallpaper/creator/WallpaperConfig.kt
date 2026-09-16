package com.depthwallpaper.creator

import org.json.JSONObject

/**
 * Impostazioni comuni a un livello di testo (orologio oppure data).
 * Orologio e data sono due livelli COMPLETAMENTE indipendenti: font, dimensione,
 * colore, opacita', posizione e deformazione si impostano separatamente.
 */
data class TextLayerConfig(
    val fontKey: String,    // vedi DepthRenderer.typefaceFor
    val bold: Boolean,
    val italic: Boolean,
    val size: Float,        // px alla larghezza di riferimento 1080 dell'editor
    val color: String,      // "#rrggbb"
    val opacity: Float,     // 0..1
    val x: Float,           // 0..1 relativo alla larghezza
    val y: Float,           // 0..1 relativo all'altezza
    val stretchX: Float,    // 1 = normale
    val stretchY: Float,    // 1 = normale
    val tracking: Float,    // spaziatura tra le lettere, px @1080
    val shadow: Boolean
) {
    companion object {
        fun fromJson(o: JSONObject?, defSize: Float, defY: Float): TextLayerConfig {
            val j = o ?: JSONObject()
            return TextLayerConfig(
                fontKey = j.optString("fontKey", "sans"),
                bold = j.optBoolean("bold", true),
                italic = j.optBoolean("italic", false),
                size = j.optDouble("size", defSize.toDouble()).toFloat(),
                color = j.optString("color", "#ffffff"),
                opacity = j.optDouble("opacity", 1.0).toFloat(),
                x = j.optDouble("x", 0.5).toFloat(),
                y = j.optDouble("y", defY.toDouble()).toFloat(),
                stretchX = j.optDouble("stretchX", 1.0).toFloat(),
                stretchY = j.optDouble("stretchY", 1.0).toFloat(),
                tracking = j.optDouble("tracking", 0.0).toFloat(),
                shadow = j.optBoolean("shadow", true)
            )
        }

        fun default(size: Float, y: Float) = TextLayerConfig(
            fontKey = "sans", bold = true, italic = false, size = size,
            color = "#ffffff", opacity = 1f, x = 0.5f, y = y,
            stretchX = 1f, stretchY = 1f, tracking = 0f, shadow = true
        )
    }
}

/** Livello 1a: orologio. */
data class ClockConfig(
    val enabled: Boolean,
    val mode: String,       // "time" | "custom"
    val customText: String,
    val format: String,     // "24" | "24short" | "12" | "12ampm"
    val style: TextLayerConfig
)

/** Livello 1b: data (indipendente dall'orologio, puo' essere nascosta). */
data class DateConfig(
    val enabled: Boolean,
    val format: String,     // "full" | "fullYear" | "dayMonth" | "short" | "numeric" | "weekday"
    val uppercase: Boolean,
    val style: TextLayerConfig
)

/** Configurazione completa esportata dall'editor. */
data class WallpaperConfig(
    val clock: ClockConfig,
    val date: DateConfig,
    val bgDim: Float,       // 0..100
    val bgScale: Float,
    val bgOffX: Float,      // -1..1
    val bgOffY: Float,
    val bgRotation: Float,  // gradi
    val fgScale: Float,     // 1 = soggetto esattamente dov'era nella foto
    val fgOffX: Float,      // -1..1, scostamento aggiuntivo
    val fgOffY: Float
) {
    companion object {

        fun default(): WallpaperConfig = WallpaperConfig(
            clock = ClockConfig(
                enabled = true,
                mode = "time",
                customText = "",
                format = "24",
                style = TextLayerConfig.default(150f, 0.30f)
            ),
            date = DateConfig(
                enabled = true,
                format = "full",
                uppercase = false,
                style = TextLayerConfig.default(38f, 0.38f).copy(bold = false)
            ),
            bgDim = 0f,
            bgScale = 1f,
            bgOffX = 0f,
            bgOffY = 0f,
            bgRotation = 0f,
            fgScale = 1f,
            fgOffX = 0f,
            fgOffY = 0f
        )

        fun fromJson(json: String?): WallpaperConfig {
            if (json.isNullOrBlank()) return default()
            return try {
                val root = JSONObject(json)

                val c = root.optJSONObject("clock") ?: JSONObject()
                val clock = ClockConfig(
                    enabled = c.optBoolean("enabled", true),
                    mode = c.optString("mode", "time"),
                    customText = c.optString("customText", ""),
                    format = c.optString("format", "24"),
                    style = TextLayerConfig.fromJson(c.optJSONObject("style"), 150f, 0.30f)
                )

                val d = root.optJSONObject("date") ?: JSONObject()
                val date = DateConfig(
                    enabled = d.optBoolean("enabled", true),
                    format = d.optString("format", "full"),
                    uppercase = d.optBoolean("uppercase", false),
                    style = TextLayerConfig.fromJson(d.optJSONObject("style"), 38f, 0.38f)
                )

                WallpaperConfig(
                    clock = clock,
                    date = date,
                    bgDim = root.optDouble("bgDim", 0.0).toFloat(),
                    bgScale = root.optDouble("bgScale", 1.0).toFloat(),
                    bgOffX = root.optDouble("bgOffX", 0.0).toFloat(),
                    bgOffY = root.optDouble("bgOffY", 0.0).toFloat(),
                    bgRotation = root.optDouble("bgRotation", 0.0).toFloat(),
                    fgScale = root.optDouble("fgScale", 1.0).toFloat(),
                    fgOffX = root.optDouble("fgOffX", 0.0).toFloat(),
                    fgOffY = root.optDouble("fgOffY", 0.0).toFloat()
                )
            } catch (e: Throwable) {
                default()
            }
        }
    }
}
