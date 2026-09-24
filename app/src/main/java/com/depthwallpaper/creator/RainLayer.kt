package com.depthwallpaper.creator

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint

/**
 * Pioggia animata: overlay di righe sottili semi-trasparenti che cadono in
 * diagonale su TUTTA la scena (sopra sfondo, testi e soggetto).
 *
 * Stessa formula e stesso seme (1337) di prima, quindi le gocce hanno le stesse
 * posizioni/lunghezze/velocita'. Cosa cambia per il costo di ogni frame:
 *  - le caratteristiche delle gocce (x, lunghezza, velocita', sfasamento, alpha)
 *    vengono generate UNA volta sola, invece di ricreare Random e Paint a ogni
 *    frame;
 *  - le gocce sono raggruppate in poche fasce di trasparenza e disegnate con una
 *    drawLines() per fascia (5 chiamate invece di ~300 drawLine).
 *  L'alpha e' quindi quantizzato in 5 livelli (differenza invisibile a occhio).
 *
 * Resta senza stato "di animazione": a cambiare da un frame all'altro e' solo
 * la posizione verticale, calcolata dal tempo passato in ingresso.
 */
class RainLayer {

    private companion object {
        const val MAX_DROPS = 300          // 40 + 1.0 * 260 = massimo di gocce
        const val BUCKETS = 5
        const val ALPHA_MIN = 60
        const val ALPHA_SPREAD = 90        // alpha originale = 60 + nextInt(90)
    }

    private val xFrac = FloatArray(MAX_DROPS)
    private val lenBase = FloatArray(MAX_DROPS)
    private val speedFactor = FloatArray(MAX_DROPS)
    private val phase = FloatArray(MAX_DROPS)
    private val bucketOf = IntArray(MAX_DROPS)

    private val bucketAlpha = IntArray(BUCKETS) { b ->
        ALPHA_MIN + (b * 2 + 1) * ALPHA_SPREAD / (BUCKETS * 2)
    }
    private val points = Array(BUCKETS) { FloatArray(MAX_DROPS * 4) }
    private val pointCount = IntArray(BUCKETS)

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
        color = Color.WHITE
    }

    private val dx = kotlin.math.sin(Math.toRadians(4.0)).toFloat() // quasi verticale
    private val dy = kotlin.math.cos(Math.toRadians(4.0)).toFloat()

    init {
        // Stesso ordine di chiamate a Random del codice originale.
        val rnd = java.util.Random(1337L)
        for (i in 0 until MAX_DROPS) {
            xFrac[i] = rnd.nextFloat()
            lenBase[i] = 26f + rnd.nextFloat() * 46f
            speedFactor[i] = 0.6f + rnd.nextFloat() * 0.8f
            phase[i] = rnd.nextFloat()
            val alpha = ALPHA_MIN + rnd.nextInt(ALPHA_SPREAD)
            bucketOf[i] = ((alpha - ALPHA_MIN) * BUCKETS / ALPHA_SPREAD).coerceIn(0, BUCKETS - 1)
        }
    }

    fun draw(canvas: Canvas, w: Float, h: Float, k: Float, rain: RainConfig, timeMs: Long) {
        val intensity = rain.intensity.coerceIn(0f, 1f)
        val count = (40 + intensity * 260f).toInt().coerceIn(0, MAX_DROPS)
        if (count <= 0) return

        val speed = if (rain.speed > 0f) rain.speed else 1f
        // Double: un timestamp in Float perderebbe la precisione al secondo.
        val t = timeMs / 1000.0

        paint.strokeWidth = (1.6f * k).coerceAtLeast(1f)
        java.util.Arrays.fill(pointCount, 0)

        for (i in 0 until count) {
            val len = lenBase[i] * k
            // 2000 px/s @1080 = velocita' misurata sul video di riferimento.
            val fallSpeed = 2000.0 * k * speed * speedFactor[i] // px/s
            val travel = (h + len).toDouble()
            val dRaw = (t * fallSpeed + phase[i] * travel) % travel
            val d = ((dRaw + travel) % travel).toFloat()
            val yTop = d - len
            val x = xFrac[i] * w

            val b = bucketOf[i]
            val arr = points[b]
            var c = pointCount[b]
            arr[c++] = x
            arr[c++] = yTop
            arr[c++] = x + dx * len
            arr[c++] = yTop + dy * len
            pointCount[b] = c
        }

        for (b in 0 until BUCKETS) {
            val n = pointCount[b]
            if (n == 0) continue
            paint.alpha = bucketAlpha[b]
            canvas.drawLines(points[b], 0, n, paint)
        }
    }
}
