package com.depthwallpaper.creator

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder
import androidx.core.content.ContextCompat

/**
 * Live Wallpaper nativo: nessuna WebView qui dentro. Legge configurazione e bitmap
 * salvati da MainActivity (ConfigStore) e li ridisegna su Canvas con DepthRenderer.
 *
 * NOTA SUL CRASH "L'app continua a interrompersi" comparso premendo "Imposta sfondo":
 * la causa era la registrazione del BroadcastReceiver. Da Android 14 (API 34), ogni
 * app che ha targetSdk 34+ DEVE dichiarare esplicitamente se un receiver registrato a
 * runtime e' esportato o no; senza il flag Android lancia una SecurityException che
 * uccideva il processo del wallpaper proprio durante l'anteprima. Qui usiamo
 * ContextCompat.registerReceiver con RECEIVER_NOT_EXPORTED e, in piu', ogni fase del
 * ciclo di vita e' protetta: un errore isolato non deve mai far morire il servizio.
 */
class DepthWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = DepthEngine()

    inner class DepthEngine : Engine() {

        private val handler = Handler(Looper.getMainLooper())
        private var visible = false
        private var receiverRegistered = false

        private var config: WallpaperConfig = WallpaperConfig.default()
        private var bgBitmap: Bitmap? = null
        private var fgBitmap: Bitmap? = null

        private val drawRunnable = Runnable {
            drawFrame()
            scheduleNextMinuteTick()
        }

        private val configReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                try {
                    reloadConfigAndBitmaps()
                    drawFrame()
                } catch (e: Throwable) {
                    // mai propagare: il servizio deve restare vivo
                }
            }
        }

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            // Rende disponibili al renderer i font inclusi in assets/fonts.
            DepthRenderer.attach(applicationContext)
            try {
                reloadConfigAndBitmaps()
                ContextCompat.registerReceiver(
                    applicationContext,
                    configReceiver,
                    IntentFilter(ConfigStore.ACTION_CONFIG_UPDATED),
                    ContextCompat.RECEIVER_NOT_EXPORTED
                )
                receiverRegistered = true
            } catch (e: Throwable) {
                receiverRegistered = false
            }
        }

        override fun onDestroy() {
            super.onDestroy()
            handler.removeCallbacks(drawRunnable)
            if (receiverRegistered) {
                try {
                    applicationContext.unregisterReceiver(configReceiver)
                } catch (e: Throwable) {
                    // gia' rimosso
                }
                receiverRegistered = false
            }
            releaseBitmaps()
        }

        override fun onVisibilityChanged(isVisible: Boolean) {
            visible = isVisible
            if (isVisible) {
                reloadConfigAndBitmaps()
                drawFrame()
                scheduleNextMinuteTick()
            } else {
                handler.removeCallbacks(drawRunnable)
            }
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            drawFrame()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            drawFrame()
        }

        override fun onSurfaceRedrawNeeded(holder: SurfaceHolder) {
            super.onSurfaceRedrawNeeded(holder)
            drawFrame()
        }

        // ---------------------------------------------------------------------------
        // Caricamento configurazione + immagini
        // ---------------------------------------------------------------------------
        private fun reloadConfigAndBitmaps() {
            try {
                config = WallpaperConfig.fromJson(ConfigStore.loadConfigJson(applicationContext))
                releaseBitmaps()
                bgBitmap = decodeIfExists(ConfigStore.bgFile(applicationContext))
                fgBitmap = decodeIfExists(ConfigStore.fgFile(applicationContext))
            } catch (e: Throwable) {
                config = WallpaperConfig.default()
            }
        }

        private fun releaseBitmaps() {
            try {
                bgBitmap?.recycle()
                fgBitmap?.recycle()
            } catch (e: Throwable) {
                // no-op
            }
            bgBitmap = null
            fgBitmap = null
        }

        /**
         * Decodifica un layer SEMPRE ridimensionato allo schermo reale: una foto da
         * 12+ MP allocherebbe decine di MB e potrebbe causare un OutOfMemoryError,
         * con crash silenzioso del wallpaper e ritorno allo sfondo di sistema.
         */
        private fun decodeIfExists(file: java.io.File): Bitmap? {
            if (!file.exists()) return null
            return try {
                val metrics = resources.displayMetrics
                val targetW = metrics.widthPixels.coerceAtLeast(1)
                val targetH = metrics.heightPixels.coerceAtLeast(1)

                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

                val options = BitmapFactory.Options().apply {
                    inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, targetW, targetH)
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                BitmapFactory.decodeFile(file.absolutePath, options)
            } catch (e: Throwable) {
                null
            }
        }

        private fun calculateInSampleSize(rawW: Int, rawH: Int, reqW: Int, reqH: Int): Int {
            var inSampleSize = 1
            if (rawW > reqW || rawH > reqH) {
                val halfW = rawW / 2
                val halfH = rawH / 2
                while (halfW / inSampleSize >= reqW && halfH / inSampleSize >= reqH) {
                    inSampleSize *= 2
                }
            }
            return inSampleSize
        }

        // ---------------------------------------------------------------------------
        // Disegno
        // ---------------------------------------------------------------------------
        private fun drawFrame() {
            val holder = surfaceHolder ?: return
            var canvas: Canvas? = null
            try {
                canvas = holder.lockCanvas()
                if (canvas != null) {
                    DepthRenderer.render(
                        canvas, canvas.width, canvas.height, config, bgBitmap, fgBitmap,
                        // Scala dei testi ancorata alla larghezza reale dello schermo,
                        // cosi' l'orologio esce delle stesse proporzioni dell'anteprima.
                        scaleReferenceWidth = resources.displayMetrics.widthPixels
                    )
                }
            } catch (e: Throwable) {
                // superficie non pronta o errore di disegno: salta il frame
            } finally {
                if (canvas != null) {
                    try {
                        holder.unlockCanvasAndPost(canvas)
                    } catch (e: Throwable) {
                        // no-op
                    }
                }
            }
        }

        /** Ridisegna all'inizio del minuto successivo: minimo consumo di batteria. */
        private fun scheduleNextMinuteTick() {
            handler.removeCallbacks(drawRunnable)
            if (!visible) return
            val needsTick = (config.clock.enabled && config.clock.mode == "time") || config.date.enabled
            if (!needsTick) return

            val now = System.currentTimeMillis()
            val delay = 60_000L - (now % 60_000L) + 50L
            handler.postDelayed(drawRunnable, delay)
        }
    }
}
