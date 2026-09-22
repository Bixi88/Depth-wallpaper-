package com.depthwallpaper.creator

import org.json.JSONObject

/**
 * Impostazioni di un livello di testo (orologio oppure data). I due livelli sono
 * completamente indipendenti: font, dimensione, colore, contorno, ombra, posizione
 * e deformazione si impostano separatamente.
 */
data class TextLayerConfig(
    val fontKey: String,
    val bold: Boolean,
    val italic: Boolean,
    val size: Float,        // px alla larghezza di riferimento 1080 dell'editor
    val color: String,      // "#rrggbb"
    val gradient: Boolean,  // true = riempimento testo sfumato
    val gradientDirection: String, // "horizontal" | "vertical" | "fadeDown"
    val gradientFadeOpacity: Float, // 0..1, quantita' di trasparenza in fondo quando direction = "fadeDown" (0 = minima, 1 = meta' inferiore trasparente)
    val color2: String,     // "#rrggbb", usato solo se gradient = true e direction != fadeDown
    val opacity: Float,     // 0..1
    val x: Float,           // 0..1
    val y: Float,           // 0..1
    val stretchX: Float,
    val stretchY: Float,
    val rotation: Float,    // gradi, -180..180
    val tracking: Float,    // spaziatura tra le lettere, px @1080
    // --- leggibilita' ---
    val outlineWidth: Float,   // px @1080, 0 = nessun contorno
    val outlineColor: String,
    val shadowOpacity: Float,  // 0..1
    val shadowBlur: Float,     // px @1080
    val shadowOffsetY: Float,  // px @1080
    val glowWidth: Float,      // alone morbido attorno al testo, px @1080
    val glowColor: String,
    val plateOpacity: Float,   // pannello dietro al testo, 0..1
    val plateColor: String
) {
    companion object {
        fun fromJson(o: JSONObject?, defSize: Float, defY: Float, defBold: Boolean): TextLayerConfig {
            val j = o ?: JSONObject()
            // Compatibilita' con la vecchia opzione booleana "shadow".
            val legacyShadow = if (j.has("shadow") && !j.has("shadowOpacity")) {
                if (j.optBoolean("shadow", true)) 0.45 else 0.0
            } else null
            return TextLayerConfig(
                fontKey = j.optString("fontKey", "sans"),
                bold = j.optBoolean("bold", defBold),
                italic = j.optBoolean("italic", false),
                size = j.optDouble("size", defSize.toDouble()).toFloat(),
                color = j.optString("color", "#ffffff"),
                gradient = j.optBoolean("gradient", false),
                gradientDirection = j.optString("gradientDirection", "horizontal"),
                gradientFadeOpacity = j.optDouble("gradientFadeOpacity", 0.0).toFloat(),
                color2 = j.optString("color2", "#ffc531"),
                opacity = j.optDouble("opacity", 1.0).toFloat(),
                x = j.optDouble("x", 0.5).toFloat(),
                y = j.optDouble("y", defY.toDouble()).toFloat(),
                stretchX = j.optDouble("stretchX", 1.0).toFloat(),
                stretchY = j.optDouble("stretchY", 1.0).toFloat(),
                rotation = j.optDouble("rotation", 0.0).toFloat(),
                tracking = j.optDouble("tracking", 0.0).toFloat(),
                outlineWidth = j.optDouble("outlineWidth", 0.0).toFloat(),
                outlineColor = j.optString("outlineColor", "#000000"),
                shadowOpacity = j.optDouble("shadowOpacity", legacyShadow ?: 0.45).toFloat(),
                shadowBlur = j.optDouble("shadowBlur", 10.0).toFloat(),
                shadowOffsetY = j.optDouble("shadowOffsetY", 4.0).toFloat(),
                glowWidth = j.optDouble("glowWidth", 0.0).toFloat(),
                glowColor = j.optString("glowColor", "#000000"),
                plateOpacity = j.optDouble("plateOpacity", 0.0).toFloat(),
                plateColor = j.optString("plateColor", "#000000")
            )
        }

        fun default(size: Float, y: Float, bold: Boolean) = TextLayerConfig(
            fontKey = "sans", bold = bold, italic = false, size = size,
            color = "#ffffff", gradient = false, gradientDirection = "horizontal", gradientFadeOpacity = 0f, color2 = "#ffc531", opacity = 1f, x = 0.5f, y = y,
            stretchX = 1f, stretchY = 1f, rotation = 0f, tracking = 0f,
            outlineWidth = 0f, outlineColor = "#000000",
            shadowOpacity = 0.45f, shadowBlur = 10f, shadowOffsetY = 4f,
            glowWidth = 0f, glowColor = "#000000",
            plateOpacity = 0f, plateColor = "#000000"
        )
    }
}

/** Stile separato per ore e minuti (facoltativo, solo modalita' "time"): colore
 *  e grassetto indipendenti, e possibilita' di mettere l'uno sopra e l'altro
 *  sotto il soggetto ritagliato. Il resto (font, dimensione, contorno, alone,
 *  ombra, posizione) resta condiviso dallo style base dell'orologio. Ore e
 *  minuti condividono sempre la stessa posizione (layer) e la stessa
 *  posizione/rotazione sullo schermo: formano un unico blocco che si
 *  trascina e si posiziona solo insieme, mai singolarmente. "arrangement"
 *  sceglie la disposizione RECIPROCA di ore e minuti dentro quel blocco:
 *  "horizontal" = ore a sinistra, minuti a destra (comportamento di sempre);
 *  "vertical" = ore sopra, minuti sotto. */
data class ClockSplitConfig(
    val enabled: Boolean,
    val hourColor: String,
    val hourBold: Boolean,
    val minuteColor: String,
    val minuteBold: Boolean,
    val layer: String,      // "back" (sotto al soggetto) | "front" (sopra), condiviso da ore e minuti
    val arrangement: String // "horizontal" | "vertical", condiviso da ore e minuti
) {
    companion object {
        fun fromJson(o: JSONObject?, defBold: Boolean): ClockSplitConfig {
            val j = o ?: JSONObject()
            return ClockSplitConfig(
                enabled = j.optBoolean("enabled", false),
                hourColor = j.optString("hourColor", "#ffffff"),
                hourBold = j.optBoolean("hourBold", defBold),
                minuteColor = j.optString("minuteColor", "#ffffff"),
                minuteBold = j.optBoolean("minuteBold", defBold),
                layer = j.optString("layer", "back"),
                arrangement = j.optString("arrangement", "horizontal")
            )
        }

        fun default(bold: Boolean) = ClockSplitConfig(
            enabled = false,
            hourColor = "#ffffff", hourBold = bold,
            minuteColor = "#ffffff", minuteBold = bold,
            layer = "back",
            arrangement = "horizontal"
        )
    }
}

/** Livello 1a: orologio. */
data class ClockConfig(
    val enabled: Boolean,
    val mode: String,       // "time" | "custom"
    val customText: String,
    val format: String,     // "24" | "24short" | "12" | "12ampm"
    /** Se true, tra ore e minuti compaiono due puntini centrali (stile ":"),
     * disegnati come forme separate e non come glifo del font: i due gruppi
     * di cifre si distanziano automaticamente per lasciargli spazio. */
    val centerDots: Boolean = false,
    val style: TextLayerConfig,
    val splitStyle: ClockSplitConfig? = null
)

/** Livello 1b: data (indipendente dall'orologio). */
data class DateConfig(
    val enabled: Boolean,
    val format: String,
    val uppercase: Boolean,
    val style: TextLayerConfig
)

data class WallpaperConfig(
    val clock: ClockConfig,
    val date: DateConfig,
    val bgDim: Float,
    val bgScale: Float,
    val bgOffX: Float,
    val bgOffY: Float,
    val bgRotation: Float,
    val fgScale: Float,
    val fgOffX: Float,
    val fgOffY: Float,
    /** Se true, zoom/spostamento/rotazione dello sfondo trascinano anche il soggetto. */
    val linkFgToBg: Boolean
) {
    companion object {

        fun default(): WallpaperConfig = WallpaperConfig(
            clock = ClockConfig(
                enabled = true, mode = "time", customText = "", format = "24",
                centerDots = false,
                style = TextLayerConfig.default(150f, 0.30f, true),
                splitStyle = ClockSplitConfig.default(true)
            ),
            date = DateConfig(
                enabled = true, format = "full", uppercase = false,
                style = TextLayerConfig.default(38f, 0.38f, false)
            ),
            bgDim = 0f, bgScale = 1f, bgOffX = 0f, bgOffY = 0f, bgRotation = 0f,
            fgScale = 1f, fgOffX = 0f, fgOffY = 0f,
            linkFgToBg = false
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
                    centerDots = c.optBoolean("centerDots", false),
                    style = TextLayerConfig.fromJson(c.optJSONObject("style"), 150f, 0.30f, true),
                    splitStyle = ClockSplitConfig.fromJson(c.optJSONObject("splitStyle"), true)
                )

                val d = root.optJSONObject("date") ?: JSONObject()
                val date = DateConfig(
                    enabled = d.optBoolean("enabled", true),
                    format = d.optString("format", "full"),
                    uppercase = d.optBoolean("uppercase", false),
                    style = TextLayerConfig.fromJson(d.optJSONObject("style"), 38f, 0.38f, false)
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
                    fgOffY = root.optDouble("fgOffY", 0.0).toFloat(),
                    linkFgToBg = root.optBoolean("linkFgToBg", false)
                )
            } catch (e: Throwable) {
                default()
            }
        }
    }
}
