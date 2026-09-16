package com.depthwallpaper.creator

import android.graphics.BlurMaskFilter
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
        fg: Bitmap?
    ) {
        val w = width.toFloat()
        val h = height.toFloat()
        val k = w / EDITOR_REFERENCE_WIDTH

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
    private fun typefaceFor(fontKey: String, bold: Boolean, italic: Boolean): Typeface {
        val family = when (fontKey) {
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
        val sizePx = style.size * k
        if (sizePx <= 0f) return

        val tracking = style.tracking * k
        val sx = if (style.stretchX <= 0f) 1f else style.stretchX
        val sy = if (style.stretchY <= 0f) 1f else style.stretchY
        val alpha = style.opacity.coerceIn(0f, 1f)

        val base = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        base.typeface = typefaceFor(style.fontKey, style.bold, style.italic)
        base.textSize = sizePx

        val lines: List<String> = if (multiline) {
            wrapLines(base, text, (w * 0.92f) / sx, tracking)
        } else {
            listOf(text)
        }
        val lineHeight = sizePx * 1.12f
        val firstY = -(lines.size - 1) * lineHeight / 2f

        canvas.save()
        canvas.translate(style.x * w, style.y * h)
        canvas.scale(sx, sy)

        var shadowPending = style.shadowOpacity > 0f

        // --- pannello dietro al testo ---
        if (style.plateOpacity > 0f) {
            var maxW = 0f
            for (line in lines) maxW = maxOf(maxW, measureTracked(base, line, tracking))
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
                    style.shadowBlur * k, 0f, style.shadowOffsetY * k,
                    Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0)
                )
                shadowPending = false
            }
            canvas.drawRoundRect(rect, sizePx * 0.28f, sizePx * 0.28f, platePaint)
        }

        // --- alone morbido ---
        if (style.glowWidth > 0f) {
            val glow = Paint(base)
            glow.style = Paint.Style.STROKE
            glow.strokeJoin = Paint.Join.ROUND
            glow.strokeCap = Paint.Cap.ROUND
            glow.strokeWidth = style.glowWidth * k * 2f
            glow.color = parseColor(style.glowColor, Color.BLACK)
            glow.alpha = (alpha * 255).toInt()
            try {
                glow.maskFilter = BlurMaskFilter(maxOf(1f, style.glowWidth * k), BlurMaskFilter.Blur.NORMAL)
            } catch (e: Throwable) {
                // dispositivi senza supporto: resta un contorno netto
            }
            drawLines(canvas, glow, lines, firstY, lineHeight, tracking)
        }

        // --- contorno netto ---
        if (style.outlineWidth > 0f) {
            val outline = Paint(base)
            outline.style = Paint.Style.STROKE
            outline.strokeJoin = Paint.Join.ROUND
            outline.strokeCap = Paint.Cap.ROUND
            outline.strokeWidth = style.outlineWidth * k * 2f
            outline.color = parseColor(style.outlineColor, Color.BLACK)
            outline.alpha = (alpha * 255).toInt()
            if (shadowPending) {
                outline.setShadowLayer(
                    style.shadowBlur * k, 0f, style.shadowOffsetY * k,
                    Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0)
                )
                shadowPending = false
            }
            drawLines(canvas, outline, lines, firstY, lineHeight, tracking)
        }

        // --- riempimento ---
        val fill = Paint(base)
        fill.style = Paint.Style.FILL
        fill.color = parseColor(style.color, Color.WHITE)
        fill.alpha = (alpha * 255).toInt()
        if (shadowPending) {
            fill.setShadowLayer(
                style.shadowBlur * k, 0f, style.shadowOffsetY * k,
                Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0)
            )
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
