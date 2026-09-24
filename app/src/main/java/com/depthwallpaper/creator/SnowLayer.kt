package com.depthwallpaper.creator

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint

/**
 * Neve: fiocchi tondi che scendono lenti oscillando di lato.
 *
 * Tre taglie per dare profondita' a costo quasi zero: i fiocchi grandi sono
 * "vicini" (piu' veloci, piu' opachi, oscillano di piu'), quelli piccoli sono
 * "lontani" (piu' lenti e trasparenti). Come la pioggia e' senza stato: le
 * caratteristiche di ogni fiocco sono generate una volta sola con un seme fisso e
 * a cambiare e' solo la posizione, calcolata dal tempo trascorso. I fiocchi della
 * stessa taglia si disegnano insieme con una sola drawPoints().
 *
 * Partenza da zero: a ogni (ri)partenza dell'animazione i fiocchi sono tutti sopra
 * il bordo alto e entrano uno dopo l'altro, quindi si vede la neve iniziare a
 * cadere; passati i primi secondi il cielo e' pieno e il ciclo continua.
 */
class SnowLayer {

    private companion object {
        const val MAX_FLAKES = 200
        const val CLASSES = 3
    }

    // Valori in px alla larghezza di riferimento 1080 (poi moltiplicati per k).
    private val radius = floatArrayOf(1.8f, 3.0f, 4.8f)
    private val fallPxPerSec = floatArrayOf(90f, 150f, 220f)
    private val alphaOf = intArrayOf(140, 190, 235)
    private val swayAmp = floatArrayOf(10f, 18f, 28f)

    private val xFrac = FloatArray(MAX_FLAKES)
    private val phase = FloatArray(MAX_FLAKES)
    private val speedJitter = FloatArray(MAX_FLAKES)
    private val swayFreq = FloatArray(MAX_FLAKES)
    private val swayPhase = FloatArray(MAX_FLAKES)
    private val sizeClass = IntArray(MAX_FLAKES)

    private val points = Array(CLASSES) { FloatArray(MAX_FLAKES * 2) }
    private val pointCount = IntArray(CLASSES)

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
        style = Paint.Style.STROKE
        color = Color.WHITE
    }

    init {
        val rnd = java.util.Random(4242L)
        for (i in 0 until MAX_FLAKES) {
            xFrac[i] = rnd.nextFloat()
            phase[i] = rnd.nextFloat()
            val r = rnd.nextFloat()
            sizeClass[i] = if (r < 0.55f) 0 else if (r < 0.85f) 1 else 2
            speedJitter[i] = 0.8f + rnd.nextFloat() * 0.4f
            swayFreq[i] = 0.5f + rnd.nextFloat() * 0.8f
            swayPhase[i] = rnd.nextFloat() * (2f * Math.PI.toFloat())
        }
    }

    fun draw(canvas: Canvas, w: Float, h: Float, k: Float, intensity: Float, speed: Float, elapsedMs: Long) {
        val n = (30 + intensity.coerceIn(0f, 1f) * 170f).toInt().coerceIn(0, MAX_FLAKES)
        if (n <= 0) return

        val spd = if (speed > 0f) speed else 1f
        val t = elapsedMs / 1000.0
        java.util.Arrays.fill(pointCount, 0)

        for (i in 0 until n) {
            val c = sizeClass[i]
            val r = radius[c] * k
            val fallSpeed = fallPxPerSec[c].toDouble() * k * spd * speedJitter[i]
            val travel = (h + 2f * r).toDouble()
            val raw = t * fallSpeed - phase[i] * travel
            if (raw < 0.0) continue // non e' ancora entrato dal bordo alto
            val y = ((raw % travel) - r).toFloat()
            val x = xFrac[i] * w +
                kotlin.math.sin(t * swayFreq[i] + swayPhase[i]).toFloat() * swayAmp[c] * k

            val arr = points[c]
            var cnt = pointCount[c]
            arr[cnt++] = x
            arr[cnt++] = y
            pointCount[c] = cnt
        }

        for (c in 0 until CLASSES) {
            val cnt = pointCount[c]
            if (cnt == 0) continue
            paint.strokeWidth = (radius[c] * 2f * k).coerceAtLeast(1.5f)
            paint.alpha = alphaOf[c]
            canvas.drawPoints(points[c], 0, cnt, paint)
        }
    }
}
