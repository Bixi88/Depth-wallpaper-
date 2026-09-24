package com.depthwallpaper.creator

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/**
 * Contatore di debug: misura quanti frame vengono davvero disegnati al secondo,
 * quanto costa ciascun frame (lock del canvas + disegno + post) e quanti sono
 * arrivati in ritardo rispetto all'intervallo atteso. Lo si disegna AL CENTRO
 * dello schermo (in alto finiva sotto orologio/barre e non si vedeva).
 * Le misure sono aggiornate ogni mezzo secondo.
 */
class FpsMeter {

    private var windowStart = 0L
    private var frames = 0
    private var late = 0
    private var workSum = 0L
    private var workMax = 0L

    private var fps = 0f
    private var avgMs = 0f
    private var maxMs = 0f
    private var lateShown = 0

    private val boxPaint = Paint().apply { color = Color.argb(210, 0, 0, 0) }
    private val bigPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(255, 235, 59)
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
    }
    private val smallPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = Typeface.MONOSPACE
        textAlign = Paint.Align.CENTER
    }

    fun reset() {
        windowStart = 0L; frames = 0; late = 0; workSum = 0L; workMax = 0L
    }

    /** Registra un frame disegnato. Ritorna true quando chiude una finestra di misura. */
    fun onFrame(nowNanos: Long, workNanos: Long, lateFrame: Boolean): Boolean {
        if (windowStart == 0L) windowStart = nowNanos
        frames++
        if (lateFrame) late++
        workSum += workNanos
        if (workNanos > workMax) workMax = workNanos

        val elapsed = nowNanos - windowStart
        if (elapsed < 500_000_000L) return false

        fps = frames * 1_000_000_000f / elapsed
        avgMs = workSum / frames / 1_000_000f
        maxMs = workMax / 1_000_000f
        lateShown = late
        windowStart = nowNanos; frames = 0; late = 0; workSum = 0L; workMax = 0L
        return true
    }

    fun draw(
        canvas: Canvas, w: Float, h: Float, k: Float,
        targetLabel: String, displayHz: Float, mode: String
    ) {
        val bigSize = 72f * k
        val smallSize = 36f * k
        val pad = 32f * k
        val gap = 14f * k
        bigPaint.textSize = bigSize
        smallPaint.textSize = smallSize

        val lines = listOf(
            "obiettivo $targetLabel  ·  schermo ${"%.0f".format(displayHz)} Hz",
            "frame ${"%.1f".format(avgMs)} ms (max ${"%.1f".format(maxMs)})",
            "in ritardo $lateShown  ·  $mode"
        )
        var maxTextW = bigPaint.measureText("000.0 FPS")
        for (l in lines) maxTextW = maxOf(maxTextW, smallPaint.measureText(l))

        val boxW = maxTextW + pad * 2
        val boxH = pad * 2 + bigSize + lines.size * (smallSize + gap)
        val left = w / 2f - boxW / 2f
        val top = h / 2f - boxH / 2f

        canvas.drawRoundRect(left, top, left + boxW, top + boxH, 24f * k, 24f * k, boxPaint)

        var y = top + pad + bigSize * 0.85f
        canvas.drawText("${"%.1f".format(fps)} FPS", w / 2f, y, bigPaint)
        y += gap
        for (l in lines) {
            y += smallSize + gap
            canvas.drawText(l, w / 2f, y - gap, smallPaint)
        }
    }
}
