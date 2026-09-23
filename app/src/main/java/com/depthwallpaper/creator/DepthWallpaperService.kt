package com.depthwallpaper.creator

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.view.Choreographer
import android.view.Surface
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

        // Tick "al minuto" per orologio/data quando la pioggia e' spenta: qui va
        // benissimo un Handler, non serve fluidita' da vsync.
        private val tickRunnable = Runnable {
            drawFrame()
            scheduleNextFrame()
        }

        /**
         * Loop della pioggia allineato al vsync (come nell'app di riferimento
         * decompilata, che anima correttamente anche in lockscreen): a differenza
         * di un Handler.postDelayed a intervallo fisso, Choreographer chiede al
         * compositor un nuovo frame ad ogni refresh reale della superficie, ed e'
         * il meccanismo che il sistema si aspetta per animazioni legate al
         * disegno. Si ri-arma da solo finche' "visible" e la pioggia sono attivi.
         */
        private val rainFrameCallback = object : Choreographer.FrameCallback {
            override fun doFrame(frameTimeNanos: Long) {
                if (!visible || !config.rain.enabled) return
                drawFrame()
                Choreographer.getInstance().postFrameCallback(this)
            }
        }

        private val configReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                try {
                    reloadConfigAndBitmaps()
                    drawFrame()
                    // La configurazione appena arrivata puo' aver acceso o spento la
                    // pioggia: senza questa chiamata, attivandola da app mentre il
                    // wallpaper e' gia' visibile, si resterebbe agganciati al vecchio
                    // tick al minuto invece di passare al loop continuo (o viceversa).
                    scheduleNextFrame()
                } catch (e: Throwable) {
                    // mai propagare: il servizio deve restare vivo
                }
            }
        }

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            // Rende disponibili al renderer i font inclusi in assets/fonts.
            DepthRenderer.attach(applicationContext)
            // FIX posizionamento orologio/data disallineato tra anteprima editor e
            // sfondo reale: senza questo, alcuni launcher (incluso quello di
            // sistema, per lo scorrimento con parallasse tra le home page) chiedono
            // una superficie di disegno piu' LARGA/ALTA dello schermo reale. Siccome
            // orologio e data sono posizionati in percentuale rispetto alla
            // larghezza/altezza della superficie (style.x * w, style.y * h), se la
            // superficie e' piu' grande dello schermo finiscono spostati e con una
            // scala diversa rispetto a quanto mostrato nell'editor, che assume
            // sempre una corrispondenza 1:1 con lo schermo. Forzando qui la
            // dimensione fissa della superficie alle dimensioni reali dello schermo,
            // il risultato finale coincide sempre con l'anteprima.
            forceScreenSizedSurface(surfaceHolder)
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
            handler.removeCallbacks(tickRunnable)
            Choreographer.getInstance().removeFrameCallback(rainFrameCallback)
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
                scheduleNextFrame()
            } else {
                handler.removeCallbacks(tickRunnable)
                Choreographer.getInstance().removeFrameCallback(rainFrameCallback)
            }
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            // Su molti dispositivi Samsung la lockscreen crea la superficie senza
            // mai chiamare onVisibilityChanged(true): senza questa riga il flag
            // "visible" restava false e scheduleNextFrame() usciva subito,
            // lasciando la pioggia ferma sul primo frame.
            visible = true
            drawFrame()
            scheduleNextFrame()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            // Se la superficie che arriva qui non corrisponde ancora allo schermo
            // reale (es. il launcher l'ha appena richiesta piu' larga per la
            // parallasse), la si corregge di nuovo: setFixedSize() provoca un nuovo
            // callback onSurfaceChanged con le dimensioni corrette, quindi si esce
            // subito senza disegnare con le dimensioni sbagliate.
            if (forceScreenSizedSurface(holder)) return
            requestHighFrameRate(holder)
            // Stesso motivo di onSurfaceCreated: su lockscreen questo callback puo'
            // arrivare senza che onVisibilityChanged(true) sia mai stato chiamato
            // (o dopo che e' rimasto bloccato su false). Senza forzare qui il flag,
            // scheduleNextFrame() qualche riga sotto uscirebbe subito e la pioggia
            // resterebbe ferma sul frame appena disegnato.
            visible = true
            drawFrame()
            scheduleNextFrame()
        }

        /**
         * Su schermi a refresh rate adattivo (es. Samsung LTPO) il sistema decide
         * da solo quanto spesso "svegliare" la superficie in base a quanto sembra
         * cambiare: senza dichiarare esplicitamente che serve un frame rate alto,
         * una superficie che sulla lockscreen appare per lo piu' statica puo'
         * ricevere aggiornamenti reali molto piu' radi di quanto il codice li
         * richieda (e' quello che succedeva con la pioggia: il loop a 30 fps
         * girava, ma la superficie veniva ricomposta molto piu' di rado). Questa
         * chiamata e' il modo standard (API 30+) per chiedere al sistema di non
         * limitare la superficie in questo modo.
         */
        private fun requestHighFrameRate(holder: SurfaceHolder) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
            try {
                holder.surface?.setFrameRate(120f, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT)
            } catch (e: Throwable) {
                // Alcune superfici/dispositivi non lo supportano: si ignora, il
                // wallpaper funziona comunque, solo senza il boost del refresh rate.
            }
        }

        override fun onDesiredSizeChanged(desiredWidth: Int, desiredHeight: Int) {
            super.onDesiredSizeChanged(desiredWidth, desiredHeight)
            // Alcuni launcher chiamano questo callback per suggerire una superficie
            // piu' grande in un secondo momento (es. dopo aver aggiunto altre
            // schermate home): si ignora sempre il suggerimento e si mantiene la
            // corrispondenza 1:1 con lo schermo.
            surfaceHolder?.let { forceScreenSizedSurface(it) }
        }

        /** Impone alla superficie le dimensioni reali dello schermo, cosi' il
         *  render nativo resta sempre 1:1 con l'anteprima dell'editor. Ritorna
         *  true se ha dovuto correggere una dimensione diversa da quella attuale. */
        private fun forceScreenSizedSurface(holder: SurfaceHolder): Boolean {
            val metrics = resources.displayMetrics
            val targetW = metrics.widthPixels.coerceAtLeast(1)
            val targetH = metrics.heightPixels.coerceAtLeast(1)
            val frame = holder.surfaceFrame
            if (frame.width() == targetW && frame.height() == targetH) return false
            return try {
                holder.setFixedSize(targetW, targetH)
                true
            } catch (e: Throwable) {
                false
            }
        }

        override fun onSurfaceRedrawNeeded(holder: SurfaceHolder) {
            super.onSurfaceRedrawNeeded(holder)
            // Stesso motivo di onSurfaceCreated/onSurfaceChanged: se "visible" e'
            // rimasto bloccato a false, riavviamo qui il loop invece di limitarci
            // a un singolo drawFrame() che sulla lockscreen sarebbe l'ultimo.
            visible = true
            drawFrame()
            scheduleNextFrame()
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
        // DIAGNOSTICA TEMPORANEA: contatore di frame disegnato in alto a sinistra,
        // per vedere ad occhio (senza adb) se il loop gira davvero o si blocca.
        // Da togliere una volta confermato che la pioggia si muove.
        private var debugFrameCount = 0
        private val debugPaint = Paint().apply {
            color = Color.MAGENTA
            textSize = 42f
            isFakeBoldText = true
            textAlign = Paint.Align.CENTER
            setShadowLayer(6f, 0f, 0f, Color.BLACK)
        }

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
                    debugFrameCount++
                    canvas.drawText(
                        "frame=$debugFrameCount visible=$visible rain=${config.rain.enabled} preview=${isPreview}",
                        canvas.width / 2f, canvas.height / 2f, debugPaint
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

        /**
         * Decide il prossimo ridisegno. Con la pioggia attiva serve un loop
         * continuo per animarla: usa Choreographer (agganciato al vsync reale
         * della superficie, non un intervallo fisso), lo stesso meccanismo usato
         * dall'app di riferimento decompilata per animare correttamente anche in
         * lockscreen. Altrimenti si resta sul comportamento originale, che
         * ridisegna solo all'inizio del minuto successivo - il minimo
         * indispensabile per tenere aggiornati orologio e data, e il piu' parco
         * possibile in termini di batteria.
         */
        private fun scheduleNextFrame() {
            handler.removeCallbacks(tickRunnable)
            Choreographer.getInstance().removeFrameCallback(rainFrameCallback)
            if (!visible) return

            if (config.rain.enabled) {
                Choreographer.getInstance().postFrameCallback(rainFrameCallback)
                return
            }

            val needsTick = (config.clock.enabled && config.clock.mode == "time") || config.date.enabled
            if (!needsTick) return

            val now = System.currentTimeMillis()
            val delay = 60_000L - (now % 60_000L) + 50L
            handler.postDelayed(tickRunnable, delay)
        }
    }
}
