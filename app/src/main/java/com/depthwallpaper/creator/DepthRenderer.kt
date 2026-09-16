package com.depthwallpaper.creator

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Motore di rendering condiviso dal Live Wallpaper. E' il porting nativo, 1:1, della
 * funzione render() dell'editor in assets/js/app.js: stesso ordine dei layer,
 * stessa matematica di posizionamento (cover/contain), stesso concetto di
 * "l'orologio sta in mezzo, il soggetto trasparente ci passa sopra".
 *
 * La risoluzione di riferimento usata in editor per la dimensione del font è 1080px
 * di larghezza: qui la scaliamo in proporzione alla larghezza reale dello schermo.
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
        parallaxX: Float = 0f, // -1..1
        parallaxY: Float = 0f  // -1..1
    ) {
        val w = width.toFloat()
        val h = height.toFloat()

        canvas.drawColor(Color.BLACK)

        // ---- Livello 0: sfondo (parallasse minimo: si muove poco, e' lo sfondo) ----
        if (bg != null) {
            canvas.save()
            canvas.translate(parallaxX * w * 0.012f, parallaxY * h * 0.012f)
            drawCover(canvas, bg, w, h, config.bgScale, config.bgOffX, config.bgOffY)
            canvas.restore()
        }

        if (config.bgDim > 0f) {
            val paint = Paint()
            paint.color = Color.argb((config.bgDim / 100f * 0.65f * 255f).toInt(), 0, 0, 0)
            canvas.drawRect(0f, 0f, w, h, paint)
        }

        // ---- Livello 1: orologio (parallasse intermedio) ----
        canvas.save()
        canvas.translate(parallaxX * w * 0.03f, parallaxY * h * 0.03f)
        drawClock(canvas, w, h, config.clock)
        canvas.restore()

        // ---- Livello 2: soggetto ritagliato, sopra l'orologio (parallasse maggiore -> sembra piu' vicino) ----
        if (fg != null) {
            canvas.save()
            canvas.translate(parallaxX * w * 0.05f, parallaxY * h * 0.05f)
            drawSubjectContain(canvas, fg, w, h, config.fgScale, config.fgOffX, config.fgOffY)
            canvas.restore()
        }
    }

    // -------------------------------------------------------------------------------
    // Layer sfondo: comportamento "cover" (riempie tutto il rettangolo, come CSS background-size:cover)
    // -------------------------------------------------------------------------------
    private fun drawCover(
        canvas: Canvas,
        bmp: Bitmap,
        rectW: Float,
        rectH: Float,
        scale: Float,
        offXFrac: Float,
        offYFrac: Float
    ) {
        val imgRatio = bmp.width.toFloat() / bmp.height.toFloat()
        val rectRatio = rectW / rectH

        val drawW: Float
        val drawH: Float
        if (imgRatio > rectRatio) {
            drawH = rectH * scale
            drawW = drawH * imgRatio
        } else {
            drawW = rectW * scale
            drawH = drawW / imgRatio
        }

        val maxOffX = kotlin.math.abs(drawW - rectW) / 2f + rectW * 0.5f
        val maxOffY = kotlin.math.abs(drawH - rectH) / 2f + rectH * 0.5f

        val cx = rectW / 2f + offXFrac * maxOffX * 0.5f
        val cy = rectH / 2f + offYFrac * maxOffY * 0.5f

        val dst = android.graphics.RectF(cx - drawW / 2f, cy - drawH / 2f, cx + drawW / 2f, cy + drawH / 2f)
        canvas.drawBitmap(bmp, null, dst, null)
    }

    // -------------------------------------------------------------------------------
    // Layer soggetto: comportamento "contain", ancorato verso il basso (figura intera)
    // -------------------------------------------------------------------------------
    private fun drawSubjectContain(
        canvas: Canvas,
        bmp: Bitmap,
        rectW: Float,
        rectH: Float,
        scale: Float,
        offXFrac: Float,
        offYFrac: Float
    ) {
        val imgRatio = bmp.width.toFloat() / bmp.height.toFloat()
        var drawW = rectW * scale
        var drawH = drawW / imgRatio

        if (drawH > rectH * scale * 1.4f) {
            drawH = rectH * scale * 1.4f
            drawW = drawH * imgRatio
        }

        val cx = rectW / 2f + offXFrac * rectW * 0.4f
        val baseY = rectH - drawH * 0.42f
        val cy = baseY + offYFrac * rectH * 0.3f

        val dst = android.graphics.RectF(cx - drawW / 2f, cy - drawH / 2f, cx + drawW / 2f, cy + drawH / 2f)
        canvas.drawBitmap(bmp, null, dst, null)
    }

    // -------------------------------------------------------------------------------
    // Layer orologio
    // -------------------------------------------------------------------------------
    private fun typefaceFor(fontKey: String, bold: Boolean): Typeface {
        val base = when (fontKey) {
            "serif" -> Typeface.SERIF
            "monospace" -> Typeface.MONOSPACE
            "condensed" -> Typeface.create("sans-serif-condensed", Typeface.NORMAL)
            else -> Typeface.SANS_SERIF
        }
        val style = if (bold) Typeface.BOLD else Typeface.NORMAL
        return Typeface.create(base, style)
    }

    private fun drawClock(canvas: Canvas, w: Float, h: Float, clock: ClockConfig) {
        val scaleFactor = w / EDITOR_REFERENCE_WIDTH
        val sizePx = clock.size * scaleFactor

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.typeface = typefaceFor(clock.fontKey, clock.bold)
        paint.textAlign = Paint.Align.CENTER
        paint.color = try { Color.parseColor(clock.color) } catch (e: Exception) { Color.WHITE }
        paint.alpha = (clock.opacity.coerceIn(0f, 1f) * 255).toInt()
        paint.setShadowLayer(sizePx * 0.06f, 0f, sizePx * 0.02f, Color.argb(90, 0, 0, 0))

        val x = clock.x * w
        val y = clock.y * h

        // Stretch non uniforme (verticale/orizzontale indipendenti): trasliamo l'origine
        // nel punto dell'orologio e scaliamo solo gli assi richiesti, cosi' la dimensione
        // "size" resta il riferimento e lo stretch la deforma in una sola direzione.
        canvas.save()
        canvas.translate(x, y)
        canvas.scale(clock.stretchX, clock.stretchY)

        if (clock.mode == "time") {
            val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Calendar.getInstance().time)
            paint.textSize = sizePx
            drawCenteredBaseline(canvas, paint, time, 0f, 0f)

            if (clock.showDate) {
                val dateStr = SimpleDateFormat("EEEE d MMMM", Locale.ITALIAN)
                    .format(Calendar.getInstance().time)
                    .replaceFirstChar { c -> c.titlecase(Locale.ITALIAN) }
                paint.textSize = sizePx * 0.22f
                drawCenteredBaseline(canvas, paint, dateStr, 0f, sizePx * 0.62f)
            }
        } else {
            val text = clock.customText.ifBlank { "Il tuo testo" }
            paint.textSize = sizePx
            wrapAndDrawText(canvas, paint, text, 0f, 0f, (w * 0.86f) / clock.stretchX, sizePx * 1.05f)
        }

        canvas.restore()
    }

    /** Paint.drawText usa la baseline: questo helper centra verticalmente come fa il canvas HTML5 (textBaseline = middle). */
    private fun drawCenteredBaseline(canvas: Canvas, paint: Paint, text: String, x: Float, y: Float) {
        val metrics = paint.fontMetrics
        val baselineY = y - (metrics.ascent + metrics.descent) / 2f
        canvas.drawText(text, x, baselineY, paint)
    }

    private fun wrapAndDrawText(
        canvas: Canvas,
        paint: Paint,
        text: String,
        cx: Float,
        cy: Float,
        maxWidth: Float,
        lineHeight: Float
    ) {
        val words = text.split(" ")
        val lines = mutableListOf<String>()
        var current = ""
        for (word in words) {
            val test = if (current.isEmpty()) word else "$current $word"
            if (paint.measureText(test) > maxWidth && current.isNotEmpty()) {
                lines.add(current)
                current = word
            } else {
                current = test
            }
        }
        if (current.isNotEmpty()) lines.add(current)

        val totalH = lines.size * lineHeight
        var startY = cy - totalH / 2f + lineHeight / 2f
        val metrics = paint.fontMetrics
        for (line in lines) {
            val baselineY = startY - (metrics.ascent + metrics.descent) / 2f
            canvas.drawText(line, cx, baselineY, paint)
            startY += lineHeight
        }
    }
}
