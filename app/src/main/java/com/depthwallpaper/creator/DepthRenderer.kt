package com.depthwallpaper.creator

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Porting nativo 1:1 del render() dell'editor (assets/js/app.js).
 *
 * Ordine dei livelli:
 *   0) sfondo          (foto intera, "cover")
 *   0b) velo scuro     (opzionale)
 *   1) orologio        (livello di testo indipendente)
 *   1b) data           (livello di testo indipendente)
 *   2) soggetto        (PNG a piena inquadratura con sfondo trasparente) -> copre l'orologio
 *
 * IMPORTANTE: il soggetto viene disegnato con ESATTAMENTE la stessa geometria dello
 * sfondo (stessa scala "cover", stesso centro, stessa rotazione). Poiche' il PNG del
 * ritaglio conserva l'inquadratura completa della foto originale, il soggetto ricade
 * pixel-per-pixel dove si trovava nella foto, senza doverlo riposizionare a mano.
 * fgScale/fgOffX/fgOffY sono scostamenti FACOLTATIVI rispetto a quella posizione.
 */
object DepthRenderer {

    private const val EDITOR_REFERENCE_WIDTH = 1080f

    fun render(
        canvas: Canvas,
        width: Int,
        height: Int,
        config: WallpaperConfig,
        bg: Bitmap?,
        fg: Bitmap?
    ) {
        val w = width.toFloat()
        val h = height.toFloat()
        val k = w / EDITOR_REFERENCE_WIDTH

        canvas.drawColor(Color.BLACK)

        // ---- Livello 0: sfondo ----
        if (bg != null) {
            drawCover(canvas, bg, w, h, config.bgScale, config.bgOffX, config.bgOffY, config.bgRotation)
        }

        if (config.bgDim > 0f) {
            val paint = Paint()
            paint.color = Color.argb((config.bgDim / 100f * 0.75f * 255f).toInt(), 0, 0, 0)
            canvas.drawRect(0f, 0f, w, h, paint)
        }

        // ---- Livello 1: orologio ----
        if (config.clock.enabled) {
            val text = clockText(config.clock)
            drawTextLayer(canvas, w, h, k, config.clock.style, text, multiline = config.clock.mode == "custom")
        }

        // ---- Livello 1b: data ----
        if (config.date.enabled) {
            drawTextLayer(canvas, w, h, k, config.date.style, dateText(config.date), multiline = false)
        }

        // ---- Livello 2: soggetto ritagliato, sopra l'orologio ----
        if (fg != null) {
            drawCover(
                canvas, fg, w, h,
                config.bgScale * config.fgScale,
                config.bgOffX + config.fgOffX,
                config.bgOffY + config.fgOffY,
                config.bgRotation
            )
        }
    }

    // -------------------------------------------------------------------------------
    // Immagini: geometria "cover" condivisa da sfondo e soggetto
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
    // Testo (orologio / data)
    // -------------------------------------------------------------------------------
    private fun typefaceFor(fontKey: String, bold: Boolean, italic: Boolean): Typeface {
        val family = when (fontKey) {
            "sans" -> "sans-serif"
            "sansLight" -> "sans-serif-light"
            "sansMedium" -> "sans-serif-medium"
            "sansBlack" -> "sans-serif-black"
            "sansThin" -> "sans-serif-thin"
            "condensed" -> "sans-serif-condensed"
            "condensedLight" -> "sans-serif-condensed-light"
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
        val sizePx = style.size * k
        if (sizePx <= 0f) return

        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        paint.typeface = typefaceFor(style.fontKey, style.bold, style.italic)
        paint.textSize = sizePx
        paint.color = try { Color.parseColor(style.color) } catch (e: Exception) { Color.WHITE }
        paint.alpha = (style.opacity.coerceIn(0f, 1f) * 255).toInt()
        if (style.shadow) {
            paint.setShadowLayer(sizePx * 0.10f, 0f, sizePx * 0.03f, Color.argb(110, 0, 0, 0))
        }

        val tracking = style.tracking * k
        val sx = if (style.stretchX <= 0f) 1f else style.stretchX
        val sy = if (style.stretchY <= 0f) 1f else style.stretchY

        canvas.save()
        canvas.translate(style.x * w, style.y * h)
        canvas.scale(sx, sy)

        if (multiline) {
            val maxWidth = (w * 0.92f) / sx
            val lines = wrapLines(paint, text, maxWidth, tracking)
            val lineHeight = sizePx * 1.12f
            var lineY = -(lines.size - 1) * lineHeight / 2f
            for (line in lines) {
                drawTracked(canvas, paint, line, lineY, tracking)
                lineY += lineHeight
            }
        } else {
            drawTracked(canvas, paint, text, 0f, tracking)
        }

        canvas.restore()
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
        val total = measureTracked(paint, text, tracking)
        var x = -total / 2f
        for (ch in text) {
            val s = ch.toString()
            canvas.drawText(s, x, baselineY, paint)
            x += paint.measureText(s) + tracking
        }
    }

    private fun measureTracked(paint: Paint, text: String, tracking: Float): Float {
        if (text.isEmpty()) return 0f
        var total = 0f
        for (ch in text) total += paint.measureText(ch.toString())
        return total + tracking * (text.length - 1)
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
        if (clock.mode == "custom") {
            return clock.customText.ifBlank { "Il tuo testo" }
        }
        val pattern = when (clock.format) {
            "24short" -> "H:mm"
            "12" -> "h:mm"
            "12ampm" -> "h:mm a"
            else -> "HH:mm"
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
