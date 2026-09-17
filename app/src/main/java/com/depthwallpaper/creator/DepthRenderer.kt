package com.depthwallpaper.creator

import android.content.Context
import android.content.res.AssetManager
import android.graphics.BlurMaskFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Porting nativo 1:1 del render() dell'editor (assets/js/app.js).
 *
 * Livelli: sfondo -> velo scuro -> orologio -> data -> soggetto ritagliato.
 *
 * Il PNG del soggetto conserva l'inquadratura completa della foto originale: disegnato
 * con la geometria "cover" neutra (scala 1, nessuno scostamento) ricade esattamente
 * dove si trovava nella foto. Le trasformazioni dello SFONDO non lo toccano, a meno
 * che l'utente non attivi linkFgToBg.
 */
object DepthRenderer {

    private const val EDITOR_REFERENCE_WIDTH = 1080f

    fun render(
        canvas: Canvas,
        width: Int,
        height: Int,
        config: WallpaperConfig,
        bg: Bitmap?,
        fg: Bitmap?,
        /**
         * Larghezza (px) su cui calcolare la scala dei testi. Normalmente e' la
         * larghezza dello SCHERMO: la superficie di un live wallpaper puo' essere
         * piu' larga (launcher con sfondo scorrevole) e usarla renderebbe i testi
         * di una dimensione diversa da quella vista nell'anteprima.
         */
        scaleReferenceWidth: Int = width
    ) {
        val w = width.toFloat()
        val h = height.toFloat()
        val k = (if (scaleReferenceWidth > 0) scaleReferenceWidth.toFloat() else w) / EDITOR_REFERENCE_WIDTH

        canvas.drawColor(Color.BLACK)

        if (bg != null) {
            drawCover(canvas, bg, w, h, config.bgScale, config.bgOffX, config.bgOffY, config.bgRotation)
        }

        if (config.bgDim > 0f) {
            val paint = Paint()
            paint.color = Color.argb((config.bgDim / 100f * 0.75f * 255f).toInt(), 0, 0, 0)
            canvas.drawRect(0f, 0f, w, h, paint)
        }

        if (config.clock.enabled) {
            drawTextLayer(
                canvas, w, h, k, config.clock.style,
                clockText(config.clock),
                multiline = config.clock.mode == "custom"
            )
        }

        if (config.date.enabled) {
            drawTextLayer(canvas, w, h, k, config.date.style, dateText(config.date), multiline = false)
        }

        if (fg != null) {
            val link = config.linkFgToBg
            drawCover(
                canvas, fg, w, h,
                if (link) config.bgScale * config.fgScale else config.fgScale,
                if (link) config.bgOffX + config.fgOffX else config.fgOffX,
                if (link) config.bgOffY + config.fgOffY else config.fgOffY,
                if (link) config.bgRotation else 0f
            )
        }
    }

    // -------------------------------------------------------------------------------
    // Immagini
    // -------------------------------------------------------------------------------
    private fun drawCover(
        canvas: Canvas,
        bmp: Bitmap,
        rectW: Float,
        rectH: Float,
        scale: Float,
        offXFrac: Float,
        offYFrac: Float,
        rotationDeg: Float
    ) {
        if (bmp.width <= 0 || bmp.height <= 0) return
        val base = maxOf(rectW / bmp.width.toFloat(), rectH / bmp.height.toFloat())
        val s = base * (if (scale <= 0f) 1f else scale)
        val drawW = bmp.width * s
        val drawH = bmp.height * s

        val cx = rectW / 2f + offXFrac * rectW * 0.5f
        val cy = rectH / 2f + offYFrac * rectH * 0.5f

        canvas.save()
        canvas.translate(cx, cy)
        if (rotationDeg != 0f) canvas.rotate(rotationDeg)
        val dst = RectF(-drawW / 2f, -drawH / 2f, drawW / 2f, drawH / 2f)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        canvas.drawBitmap(bmp, null, dst, paint)
        canvas.restore()
    }

    // -------------------------------------------------------------------------------
    // Testo
    // -------------------------------------------------------------------------------
    /**
     * Font inclusi in assets/fonts: le chiavi devono restare identiche a quelle
     * dell'editor (FONTS in assets/js/app.js). Per ogni famiglia il file "bold"
     * e' opzionale: se manca, il grassetto viene sintetizzato da Android.
     */
    // "oswald" e "bigShoulders" puntano a file chiamati "-Regular.ttf" per non
    // toccare le chiavi gia' salvate nelle configurazioni, ma il contenuto e'
    // stato sostituito con il peso ExtraLight: al peso normale risultavano
    // troppo larghi.
    private val BUNDLED_FONTS: Map<String, Pair<String, String?>> = mapOf(
        "bebas" to Pair("fonts/BebasNeue-Regular.ttf", null),
        "anton" to Pair("fonts/Anton-Regular.ttf", null),
        "fjalla" to Pair("fonts/FjallaOne-Regular.ttf", null),
        "staatliches" to Pair("fonts/Staatliches-Regular.ttf", null),
        "wireOne" to Pair("fonts/WireOne-Regular.ttf", null),
        "oswald" to Pair("fonts/Oswald-Regular.ttf", "fonts/Oswald-Bold.ttf"),
        "oswaldLight" to Pair("fonts/Oswald-Light.ttf", null),
        "bigShoulders" to Pair("fonts/BigShoulders-Regular.ttf", "fonts/BigShoulders-Bold.ttf"),
        "bigShouldersBlack" to Pair("fonts/BigShoulders-Black.ttf", null),
        // --- font acquistati dall'utente ---
        "diosaRubia" to Pair("fonts/DiosaRubia-Light.ttf", null),
        "tightenCaps" to Pair("fonts/TightenCaps-ExtraLight.otf", null),
        "skyscraper" to Pair("fonts/Skyscraper-Condensed.ttf", null),
        "sensationalSans" to Pair("fonts/SensationalSans-Light.ttf", null),
        // ATTENZIONE: file demo (uso personale) - vedi nota di licenza in style.css.
        "calcio" to Pair("fonts/Calcio-Demo.ttf", null)
    )

    private var assetManager: AssetManager? = null
    private val typefaceCache = HashMap<String, Typeface>()

    /**
     * Va chiamato una volta prima del primo render (vedi DepthWallpaperService):
     * senza AssetManager i font inclusi ricadono sul sans-serif di sistema.
     */
    fun attach(context: Context) {
        if (assetManager == null) assetManager = context.applicationContext.assets
    }

    private fun bundledTypeface(path: String): Typeface? {
        typefaceCache[path]?.let { return it }
        val am = assetManager ?: return null
        return try {
            val tf = Typeface.createFromAsset(am, path)
            typefaceCache[path] = tf
            tf
        } catch (e: Throwable) {
            null
        }
    }

    private fun typefaceFor(fontKey: String, bold: Boolean, italic: Boolean): Typeface {
        val bundled = BUNDLED_FONTS[fontKey]
        if (bundled != null) {
            val path = if (bold && bundled.second != null) bundled.second!! else bundled.first
            val loaded = bundledTypeface(path)
            if (loaded != null) {
                // Se la famiglia ha gia' il file bold non serve il grassetto sintetico.
                val needsFakeBold = bold && bundled.second == null
                val style = when {
                    needsFakeBold && italic -> Typeface.BOLD_ITALIC
                    needsFakeBold -> Typeface.BOLD
                    italic -> Typeface.ITALIC
                    else -> Typeface.NORMAL
                }
                return if (style == Typeface.NORMAL) loaded else Typeface.create(loaded, style)
            }
        }

        // Le varianti Sans e "condensed" non sono piu' offerte dall'editor: le
        // configurazioni salvate in precedenza ricadono sul font rimasto piu' vicino.
        val family = when (fontKey) {
            "condensedLight", "condensed" -> "sans-serif-condensed-light"
            "smallcaps" -> "sans-serif-smallcaps"
            "serif" -> "serif"
            "monospace" -> "monospace"
            "cursive" -> "cursive"
            else -> "sans-serif"
        }
        val style = when {
            bold && italic -> Typeface.BOLD_ITALIC
            bold -> Typeface.BOLD
            italic -> Typeface.ITALIC
            else -> Typeface.NORMAL
        }
        return Typeface.create(family, style)
    }

    private fun parseColor(value: String, fallback: Int): Int =
        try { Color.parseColor(value) } catch (e: Exception) { fallback }

    private fun drawTextLayer(
        canvas: Canvas,
        w: Float,
        h: Float,
        k: Float,
        style: TextLayerConfig,
        text: String,
        multiline: Boolean
    ) {
        if (text.isEmpty()) return
        var sizePx = style.size * k
        if (sizePx <= 0f) return

        var tracking = style.tracking * k
        val sx = if (style.stretchX <= 0f) 1f else style.stretchX
        val sy = if (style.stretchY <= 0f) 1f else style.stretchY
        val alpha = style.opacity.coerceIn(0f, 1f)

        val base = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        base.typeface = typefaceFor(style.fontKey, style.bold, style.italic)
        base.textSize = sizePx

        // Adattamento automatico su una riga (specchio della stessa logica nell'editor
        // in assets/js/app.js): il motore di testo di Android puo' misurare lo stesso
        // font a parita' di "size" con una larghezza diversa da quella di WebView. Se il
        // testo naturale sfora il canvas lo restringiamo qui in proporzione, cosi' il
        // risultato reale sul dispositivo resta coerente con l'anteprima dell'editor.
        var effK = k
        if (!multiline) {
            val naturalW = measureTracked(base, text, tracking) * sx
            val maxAllowed = w * 0.94f
            if (naturalW > maxAllowed && naturalW > 0f) {
                val fit = maxAllowed / naturalW
                sizePx *= fit
                tracking *= fit
                effK *= fit
                base.textSize = sizePx
            }
        }

        val lines: List<String> = if (multiline) {
            wrapLines(base, text, (w * 0.92f) / sx, tracking)
        } else {
            listOf(text)
        }
        val lineHeight = sizePx * 1.12f
        val firstY = -(lines.size - 1) * lineHeight / 2f

        canvas.save()
        canvas.translate(style.x * w, style.y * h)
        if (style.rotation != 0f) canvas.rotate(style.rotation)
        canvas.scale(sx, sy)

        var shadowPending = style.shadowOpacity > 0f

        // Larghezza massima tra le righe: serve sia al pannello dietro sia al
        // gradiente del riempimento (calcolata una sola volta).
        var maxLineWidth = 0f
        for (line in lines) maxLineWidth = maxOf(maxLineWidth, measureTracked(base, line, tracking))

        // --- pannello dietro al testo ---
        if (style.plateOpacity > 0f) {
            val maxW = maxLineWidth
            val padX = sizePx * 0.32f
            val padY = sizePx * 0.22f
            val rect = RectF(
                -maxW / 2f - padX,
                firstY - lineHeight / 2f - padY,
                maxW / 2f + padX,
                firstY + (lines.size - 1) * lineHeight + lineHeight / 2f + padY
            )
            val platePaint = Paint(Paint.ANTI_ALIAS_FLAG)
            platePaint.color = parseColor(style.plateColor, Color.BLACK)
            platePaint.alpha = (style.plateOpacity.coerceIn(0f, 1f) * alpha * 255).toInt()
            if (shadowPending) {
                platePaint.setShadowLayer(
                    style.shadowBlur * effK, 0f, style.shadowOffsetY * effK,
                    Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0)
                )
                shadowPending = false
            }
            canvas.drawRoundRect(rect, sizePx * 0.28f, sizePx * 0.28f, platePaint)
        }

        // --- alone morbido ---
        if (style.glowWidth > 0f) {
            val glowPath = buildTrackedPath(base, lines, firstY, lineHeight, tracking)
            val glow = Paint(base)
            glow.style = Paint.Style.STROKE
            glow.strokeJoin = Paint.Join.ROUND
            glow.strokeCap = Paint.Cap.ROUND
            glow.strokeWidth = style.glowWidth * effK * 2f
            glow.color = parseColor(style.glowColor, Color.BLACK)
            glow.alpha = (alpha * 255).toInt()
            try {
                glow.maskFilter = BlurMaskFilter(maxOf(1f, style.glowWidth * effK), BlurMaskFilter.Blur.NORMAL)
            } catch (e: Throwable) {
                // dispositivi senza supporto: resta un contorno netto
            }
            canvas.drawPath(glowPath, glow)
        }

        // --- contorno netto ---
        if (style.outlineWidth > 0f) {
            if (shadowPending) {
                drawUnifiedShadow(
                    canvas, base, lines, firstY, lineHeight, tracking,
                    Paint.Style.STROKE, style.outlineWidth * effK * 2f,
                    Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0),
                    style.shadowBlur * effK, style.shadowOffsetY * effK
                )
                shadowPending = false
            }
            val outline = Paint(base)
            outline.style = Paint.Style.STROKE
            outline.strokeJoin = Paint.Join.ROUND
            outline.strokeCap = Paint.Cap.ROUND
            outline.strokeWidth = style.outlineWidth * effK * 2f
            outline.color = parseColor(style.outlineColor, Color.BLACK)
            outline.alpha = (alpha * 255).toInt()
            drawLines(canvas, outline, lines, firstY, lineHeight, tracking)
        }

        // --- riempimento ---
        if (shadowPending) {
            drawUnifiedShadow(
                canvas, base, lines, firstY, lineHeight, tracking,
                Paint.Style.FILL, 0f,
                Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0),
                style.shadowBlur * effK, style.shadowOffsetY * effK
            )
            shadowPending = false
        }
        val fill = Paint(base)
        fill.style = Paint.Style.FILL
        fill.color = parseColor(style.color, Color.WHITE)
        fill.alpha = (alpha * 255).toInt()
        if (style.gradient && maxLineWidth > 0f) {
            val dir = style.gradientDirection
            if (dir == "vertical" || dir == "fadeDown") {
                val top = firstY - lineHeight / 2f
                val bottom = firstY + (lines.size - 1) * lineHeight + lineHeight / 2f
                val startColor = parseColor(style.color, Color.WHITE)
                // "fadeDown": stesso colore ma alpha 0 in fondo, cosi' il testo
                // dissolve nello sfondo invece di passare a un secondo colore.
                val endColor = if (dir == "fadeDown") {
                    startColor and 0x00FFFFFF
                } else {
                    parseColor(style.color2, Color.WHITE)
                }
                fill.shader = LinearGradient(
                    0f, top, 0f, bottom,
                    startColor, endColor,
                    Shader.TileMode.CLAMP
                )
            } else {
                val half = maxLineWidth / 2f
                fill.shader = LinearGradient(
                    -half, 0f, half, 0f,
                    parseColor(style.color, Color.WHITE),
                    parseColor(style.color2, Color.WHITE),
                    Shader.TileMode.CLAMP
                )
            }
        }
        drawLines(canvas, fill, lines, firstY, lineHeight, tracking)

        canvas.restore()
    }

    private fun drawLines(
        canvas: Canvas,
        paint: Paint,
        lines: List<String>,
        firstY: Float,
        lineHeight: Float,
        tracking: Float
    ) {
        var y = firstY
        for (line in lines) {
            drawTracked(canvas, paint, line, y, tracking)
            y += lineHeight
        }
    }

    /** Disegna il testo centrato in (0, y), con spaziatura personalizzata tra le lettere. */
    private fun drawTracked(canvas: Canvas, paint: Paint, text: String, y: Float, tracking: Float) {
        val metrics = paint.fontMetrics
        val baselineY = y - (metrics.ascent + metrics.descent) / 2f

        if (tracking == 0f) {
            paint.textAlign = Paint.Align.CENTER
            canvas.drawText(text, 0f, baselineY, paint)
            return
        }

        paint.textAlign = Paint.Align.LEFT
        var x = -measureTracked(paint, text, tracking) / 2f
        for (ch in text) {
            val s = ch.toString()
            canvas.drawText(s, x, baselineY, paint)
            x += paint.measureText(s) + tracking
        }
    }

    private fun measureTracked(paint: Paint, text: String, tracking: Float): Float {
        if (text.isEmpty()) return 0f
        if (tracking == 0f) return paint.measureText(text)
        var total = 0f
        for (ch in text) total += paint.measureText(ch.toString())
        return total + tracking * (text.length - 1)
    }

    /** Sagoma UNICA (tutte le righe/lettere unite in un solo Path) del testo con
     *  spaziatura: serve a proiettare l'ombra/alone in un solo colpo invece che
     *  lettera per lettera, perche' con la spaziatura attiva l'ombra per-carattere
     *  si sovrapponeva tra le lettere sommandosi e creando un alone molto piu'
     *  grande e visibile del previsto (specie evidente con il riempimento a
     *  gradiente). Specchio di buildTrackedPath in assets/js/app.js. */
    private fun buildTrackedPath(paint: Paint, lines: List<String>, firstY: Float, lineHeight: Float, tracking: Float): Path {
        val path = Path()
        var y = firstY
        val metrics = paint.fontMetrics
        for (line in lines) {
            val baselineY = y - (metrics.ascent + metrics.descent) / 2f
            if (tracking == 0f) {
                paint.textAlign = Paint.Align.CENTER
                val glyphPath = Path()
                paint.getTextPath(line, 0, line.length, 0f, baselineY, glyphPath)
                path.addPath(glyphPath)
            } else {
                paint.textAlign = Paint.Align.LEFT
                var x = -measureTracked(paint, line, tracking) / 2f
                for (ch in line) {
                    val s = ch.toString()
                    val chPath = Path()
                    paint.getTextPath(s, 0, s.length, x, baselineY, chPath)
                    path.addPath(chPath)
                    x += paint.measureText(s) + tracking
                }
            }
            y += lineHeight
        }
        return path
    }

    /** Proietta un'ombra unica dietro a tutta la scritta: disegna la sagoma unita
     *  con una sorgente quasi invisibile e l'ombra attiva, cosi' resta visibile
     *  solo l'ombra sfocata (non la forma stessa). */
    private fun drawUnifiedShadow(
        canvas: Canvas, base: Paint, lines: List<String>, firstY: Float, lineHeight: Float,
        tracking: Float, style: Paint.Style, strokeWidth: Float,
        shadowColor: Int, shadowBlur: Float, shadowOffsetY: Float
    ) {
        val path = buildTrackedPath(base, lines, firstY, lineHeight, tracking)
        val paint = Paint(base)
        paint.style = style
        if (style == Paint.Style.STROKE) {
            paint.strokeWidth = strokeWidth
            paint.strokeJoin = Paint.Join.ROUND
            paint.strokeCap = Paint.Cap.ROUND
        }
        paint.color = Color.BLACK
        paint.alpha = 1 // sorgente quasi invisibile: serve solo a proiettare l'ombra
        paint.setShadowLayer(shadowBlur, 0f, shadowOffsetY, shadowColor)
        canvas.drawPath(path, paint)
    }

    private fun wrapLines(paint: Paint, text: String, maxWidth: Float, tracking: Float): List<String> {
        val result = mutableListOf<String>()
        for (rawLine in text.split("\n")) {
            val words = rawLine.split(" ")
            var current = ""
            for (word in words) {
                val test = if (current.isEmpty()) word else "$current $word"
                if (measureTracked(paint, test, tracking) > maxWidth && current.isNotEmpty()) {
                    result.add(current)
                    current = word
                } else {
                    current = test
                }
            }
            result.add(current)
        }
        return result
    }

    // -------------------------------------------------------------------------------
    // Contenuti dinamici
    // -------------------------------------------------------------------------------
    private fun clockText(clock: ClockConfig): String {
        if (clock.mode == "custom") return clock.customText.ifBlank { "Il tuo testo" }
        // Ore e minuti attaccati, senza alcun separatore (deve restare
        // identico all'editor in assets/js/app.js).
        val pattern = when (clock.format) {
            "24short" -> "Hmm"
            "12" -> "hmm"
            "12ampm" -> "hmm a"
            else -> "HHmm"
        }
        return try {
            SimpleDateFormat(pattern, Locale.getDefault()).format(Date())
        } catch (e: Exception) {
            ""
        }
    }

    private fun dateText(date: DateConfig): String {
        val pattern = when (date.format) {
            "fullYear" -> "EEEE d MMMM yyyy"
            "dayMonth" -> "d MMMM"
            "short" -> "EEE d MMM"
            "numeric" -> "dd/MM/yyyy"
            "weekday" -> "EEEE"
            else -> "EEEE d MMMM"
        }
        val locale = Locale.getDefault()
        val text = try {
            SimpleDateFormat(pattern, locale).format(Calendar.getInstance().time)
        } catch (e: Exception) {
            ""
        }
        return if (date.uppercase) text.uppercase(locale)
        else text.replaceFirstChar { c -> c.titlecase(locale) }
    }
}
