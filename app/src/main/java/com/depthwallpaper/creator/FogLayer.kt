package com.depthwallpaper.creator

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF

/**
 * Nebbia: una texture morbida generata UNA volta (rumore sfumato, ripetibile in
 * orizzontale) disegnata in 2 strati che scorrono lenti, uno verso sinistra e uno
 * verso destra, a velocita' e altezze diverse. Si concentra nella parte bassa e
 * centrale dello schermo, lasciando libera la zona dell'orologio. All'accensione
 * appare con una breve dissolvenza.
 *
 * Il rumore usa lo stesso generatore e gli stessi parametri dell'anteprima
 * dell'editor (assets/js/app.js, drawFog), cosi' la nebbia ha lo stesso aspetto.
 */
class FogLayer {

    private companion object {
        const val TEX_W = 256
        const val TEX_H = 128
        // (celle in orizzontale, celle in verticale, peso) per ogni ottava di rumore
        val OCT_X = intArrayOf(4, 8, 16)
        val OCT_Y = intArrayOf(2, 4, 8)
        val OCT_AMP = floatArrayOf(0.55f, 0.30f, 0.15f)
    }

    private class Layer(
        val top: Float, val bottom: Float,   // fascia verticale (frazione dell'altezza)
        val speed: Float,                    // px/s @1080, negativo = verso destra
        val alphaMul: Float,
        val periodMul: Float,                // larghezza di una ripetizione, in larghezze di schermo
        val phase: Float
    )

    private val layers = arrayOf(
        Layer(top = 0.38f, bottom = 0.80f, speed = 14f, alphaMul = 0.65f, periodMul = 1.7f, phase = 0f),
        Layer(top = 0.62f, bottom = 1.02f, speed = -24f, alphaMul = 0.85f, periodMul = 1.3f, phase = 0.37f)
    )

    private var texture: Bitmap? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val dst = RectF()

    fun release() {
        try {
            texture?.let { if (!it.isRecycled) it.recycle() }
        } catch (e: Throwable) {
            // no-op
        }
        texture = null
    }

    fun draw(canvas: Canvas, w: Float, h: Float, k: Float, intensity: Float, elapsedMs: Long) {
        val inten = intensity.coerceIn(0f, 1f)
        if (inten <= 0f) return
        val tex = ensureTexture() ?: return

        val fade = (elapsedMs / 1500f).coerceIn(0f, 1f)
        val t = elapsedMs / 1000.0

        for (layer in layers) {
            val a = inten * layer.alphaMul * fade
            if (a <= 0.004f) continue
            paint.alpha = (a * 255f).toInt().coerceIn(0, 255)

            val period = w * layer.periodMul
            val off = (((t * layer.speed * k + layer.phase * period) % period) + period) % period
            var x = (-off).toFloat()
            val top = h * layer.top
            val bottom = h * layer.bottom
            while (x < w) {
                dst.set(x, top, x + period, bottom)
                canvas.drawBitmap(tex, null, dst, paint)
                x += period
            }
        }
    }

    private fun ensureTexture(): Bitmap? {
        texture?.let { if (!it.isRecycled) return it }
        return try {
            val bmp = buildTexture()
            texture = bmp
            bmp
        } catch (e: Throwable) {
            null
        }
    }

    /** Rumore a valori (3 ottave), periodico in orizzontale, con dissolvenza sui
     *  bordi alto/basso e curva di contrasto per avere banchi di nebbia con
     *  zone piu' chiare tra l'uno e l'altro. */
    private fun buildTexture(): Bitmap {
        var seed = 2024L
        fun rnd(): Float {
            seed = (seed * 1103515245L + 12345L) and 0x7fffffffL
            return (seed % 10000L).toFloat() / 10000f
        }

        val grids = Array(OCT_X.size) { o ->
            Array(OCT_Y[o] + 1) { FloatArray(OCT_X[o]) }
        }
        for (o in OCT_X.indices) {
            for (row in 0..OCT_Y[o]) {
                for (col in 0 until OCT_X[o]) grids[o][row][col] = rnd()
            }
        }

        val pixels = IntArray(TEX_W * TEX_H)
        for (y in 0 until TEX_H) {
            val v = (y + 0.5f) / TEX_H
            val edge = kotlin.math.sin(Math.PI * v).toFloat()
            for (x in 0 until TEX_W) {
                val u = (x + 0.5f) / TEX_W
                var sum = 0f
                for (o in OCT_X.indices) {
                    sum += OCT_AMP[o] * sample(grids[o], OCT_X[o], OCT_Y[o], u, v)
                }
                var a = ((sum - 0.42f) / 0.40f).coerceIn(0f, 1f)
                a = a * a * (3f - 2f * a) * edge
                val alpha = (a * 255f + 0.5f).toInt().coerceIn(0, 255)
                pixels[y * TEX_W + x] = (alpha shl 24) or (235 shl 16) or (240 shl 8) or 245
            }
        }
        val bmp = Bitmap.createBitmap(TEX_W, TEX_H, Bitmap.Config.ARGB_8888)
        bmp.setPixels(pixels, 0, TEX_W, 0, 0, TEX_W, TEX_H)
        return bmp
    }

    private fun smooth(f: Float) = f * f * (3f - 2f * f)

    private fun sample(grid: Array<FloatArray>, cx: Int, cy: Int, u: Float, v: Float): Float {
        val gx = u * cx
        val gy = v * cy
        val x0 = kotlin.math.floor(gx).toInt() % cx
        val x1 = (x0 + 1) % cx           // periodico in orizzontale
        val y0 = kotlin.math.floor(gy).toInt().coerceIn(0, cy - 1)
        val y1 = y0 + 1
        val fx = smooth(gx - kotlin.math.floor(gx))
        val fy = smooth(gy - kotlin.math.floor(gy))
        val top = grid[y0][x0] * (1f - fx) + grid[y0][x1] * fx
        val bottom = grid[y1][x0] * (1f - fx) + grid[y1][x1] * fx
        return top * (1f - fy) + bottom * fy
    }
}
