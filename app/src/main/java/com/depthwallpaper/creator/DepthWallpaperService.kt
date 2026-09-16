package com.depthwallpaper.creator

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder

/**
 * Live Wallpaper nativo: nessuna WebView qui dentro. Legge la configurazione e i due
 * bitmap salvati da MainActivity (tramite ConfigStore) e li ridisegna su Canvas con
 * DepthRenderer, sull'Engine standard di Android — lo stesso approccio usato dalle
 * principali app "depth effect" per Android (rendering nativo diretto sul canvas del
 * wallpaper, invece di rendering web, per efficienza e battery-life).
 */
class DepthWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = DepthEngine()

    inner class DepthEngine : Engine() {

        private val handler = Handler(Looper.getMainLooper())
        private var visible = false

        private var config: WallpaperConfig = WallpaperConfig.default()
        private var bgBitmap: Bitmap? = null
        private var fgBitmap: Bitmap? = null

        // Parallasse: componente da swipe della home (onOffsetsChanged) + componente da giroscopio.
        private var pagerOffset = 0f   // -1..1, derivato da xOffset di sistema
        private var tiltX = 0f         // -1..1, filtrato
        private var tiltY = 0f

        private var sensorManager: SensorManager? = null
        private var sensorListener: SensorEventListener? = null

        private val drawRunnable = Runnable {
            drawFrame()
            scheduleNextMinuteTick()
        }

        private val configReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                reloadConfigAndBitmaps()
                drawFrame()
            }
        }

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            reloadConfigAndBitmaps()
            registerReceiver(configReceiver, IntentFilter(ConfigStore.ACTION_CONFIG_UPDATED))
        }

        override fun onDestroy() {
            super.onDestroy()
            handler.removeCallbacks(drawRunnable)
            unregisterTiltSensor()
            try {
                unregisterReceiver(configReceiver)
            } catch (e: Exception) {
                // già rimosso: non bloccante
            }
            bgBitmap?.recycle()
            fgBitmap?.recycle()
        }

        override fun onVisibilityChanged(isVisible: Boolean) {
            visible = isVisible
            if (isVisible) {
                reloadConfigAndBitmaps()
                registerTiltSensorIfNeeded()
                drawFrame()
                scheduleNextMinuteTick()
            } else {
                handler.removeCallbacks(drawRunnable)
                unregisterTiltSensor()
            }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            drawFrame()
        }

        override fun onOffsetsChanged(
            xOffset: Float,
            yOffset: Float,
            xOffsetStep: Float,
            yOffsetStep: Float,
            xPixelOffset: Int,
            yPixelOffset: Int
        ) {
            // xOffset e' tipicamente 0..1 tra le pagine della home; lo centriamo su 0.
            pagerOffset = ((xOffset - 0.5f) * 2f).coerceIn(-1f, 1f)
            drawFrame()
        }

        // ---------------------------------------------------------------------------
        // Caricamento configurazione + immagini
        // ---------------------------------------------------------------------------
        private fun reloadConfigAndBitmaps() {
            try {
                val json = ConfigStore.loadConfigJson(applicationContext)
                config = WallpaperConfig.fromJson(json)

                bgBitmap?.recycle()
                fgBitmap?.recycle()
                bgBitmap = decodeIfExists(ConfigStore.bgFile(applicationContext))
                fgBitmap = decodeIfExists(ConfigStore.fgFile(applicationContext))

                unregisterTiltSensor()
                if (visible) registerTiltSensorIfNeeded()
            } catch (e: Throwable) {
                // Non lasciare mai che un dato scritto male (config o immagini) faccia
                // crashare il servizio: meglio uno sfondo nero che un fallback di sistema.
                config = WallpaperConfig.default()
            }
        }

        /**
         * Decodifica un layer SEMPRE ridimensionato allo schermo reale (mai a piena
         * risoluzione fotocamera). Senza questo limite, una foto da 12+ MP puo' allocare
         * decine di MB di bitmap e causare un OutOfMemoryError: il servizio crasha in
         * modo silenzioso, la preview di sistema resta bloccata sul caricamento e, se
         * l'utente riprova, Android torna allo sfondo predefinito del produttore.
         */
        private fun decodeIfExists(file: java.io.File): Bitmap? {
            if (!file.exists()) return null
            return try {
                val metrics = resources.displayMetrics
                val targetW = metrics.widthPixels.coerceAtLeast(1) * 2
                val targetH = metrics.heightPixels.coerceAtLeast(1) * 2

                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

                val options = BitmapFactory.Options().apply {
                    inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, targetW, targetH)
                }
                BitmapFactory.decodeFile(file.absolutePath, options)
            } catch (e: Throwable) {
                // Include OutOfMemoryError: un file corrotto o enorme non deve mai
                // far crashare il processo del Live Wallpaper.
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
        // Giroscopio / accelerometro per il parallasse "vivo" (opzionale, da config)
        // ---------------------------------------------------------------------------
        private fun registerTiltSensorIfNeeded() {
            if (!config.parallaxEnabled) return
            val sm = sensorManager ?: return
            val sensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return

            val listener = object : SensorEventListener {
                override fun onSensorChanged(event: SensorEvent) {
                    // Filtro passa-basso per un movimento morbido, non nervoso.
                    val rawX = (-event.values[0] / SensorManager.GRAVITY_EARTH).coerceIn(-1f, 1f)
                    val rawY = (event.values[1] / SensorManager.GRAVITY_EARTH).coerceIn(-1f, 1f)
                    tiltX = tiltX * 0.85f + rawX * 0.15f
                    tiltY = tiltY * 0.85f + rawY * 0.15f
                    drawFrame()
                }

                override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
            }
            sensorListener = listener
            sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
        }

        private fun unregisterTiltSensor() {
            sensorListener?.let { sensorManager?.unregisterListener(it) }
            sensorListener = null
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
                    val parallaxX = (pagerOffset * 0.6f + tiltX * 0.4f).coerceIn(-1f, 1f)
                    val parallaxY = tiltY.coerceIn(-1f, 1f)
                    DepthRenderer.render(
                        canvas, canvas.width, canvas.height,
                        config, bgBitmap, fgBitmap,
                        parallaxX, parallaxY
                    )
                }
            } catch (e: Throwable) {
                // Superficie non pronta, già rilasciata, o errore di disegno: ignoriamo
                // il singolo frame invece di far crashare l'intero servizio.
            } finally {
                if (canvas != null) {
                    try {
                        holder.unlockCanvasAndPost(canvas)
                    } catch (e: Exception) {
                        // no-op
                    }
                }
            }
        }

        /** Ridisegna esattamente all'inizio del minuto successivo: sveglia la CPU il minor numero di volte possibile. */
        private fun scheduleNextMinuteTick() {
            handler.removeCallbacks(drawRunnable)
            if (!visible) return
            if (config.clock.mode != "time") return // testo personalizzato: nessun tick periodico necessario

            val now = System.currentTimeMillis()
            val delay = 60_000L - (now % 60_000L) + 50L
            handler.postDelayed(drawRunnable, delay)
        }
    }
}
