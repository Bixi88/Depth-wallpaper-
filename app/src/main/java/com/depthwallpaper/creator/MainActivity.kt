package com.depthwallpaper.creator

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.WallpaperManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Host nativo minimale: l'intera UI/UX e il motore di rendering a 3 layer
 * vivono in assets/index.html (Canvas HTML5). Questa Activity fornisce solo
 * i "superpoteri" nativi che una WebView sandboxata non ha:
 *  - selezione immagini dalla galleria del dispositivo (SAF)
 *  - scrittura del PNG esportato nella galleria pubblica (MediaStore)
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    /** Layer per cui è stata avviata l'ultima richiesta di selezione immagine ("bg" o "fg"). */
    private var pendingLayer: String = "bg"

    /** Dati in attesa di un permesso di scrittura storage (solo Android <= 9). */
    private var pendingSaveBytes: ByteArray? = null
    private var pendingSaveFileName: String? = null
    private var pendingSaveMimeType: String = "image/png"

    private val pickImageLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
            handlePickedImage(uri)
        }

    private val requestStoragePermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val bytes = pendingSaveBytes
            val name = pendingSaveFileName
            val mime = pendingSaveMimeType
            pendingSaveBytes = null
            pendingSaveFileName = null
            pendingSaveMimeType = "image/png"
            if (granted && bytes != null && name != null) {
                val ok = saveBitmapToGallery(bytes, name, mime)
                notifyImageSaved(ok)
            } else {
                notifyImageSaved(false)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySystemBarsColor()
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        setupWebView()
        webView.loadUrl("file:///android_asset/index.html")
    }

    /**
     * Barre di sistema dello stesso nero dell'interfaccia, con icone chiare.
     * Il tema (res/values/themes.xml) fa gia' la stessa cosa: questo e' il
     * rinforzo per le skin che ignorano gli attributi del tema.
     */
    private fun applySystemBarsColor() {
        try {
            val bar = ContextCompat.getColor(this, R.color.app_background)
            window.statusBarColor = bar
            window.navigationBarColor = bar
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.isAppearanceLightStatusBars = false
            controller.isAppearanceLightNavigationBars = false
        } catch (e: Throwable) {
            // tema gia' corretto: nessun problema
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
        }
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(WebAppBridge(), "Android")
    }

    // ---------------------------------------------------------------------
    // Selezione immagini (Media tab: sfondo + soggetto ritagliato)
    // ---------------------------------------------------------------------

    private fun handlePickedImage(uri: Uri?) {
        if (uri == null) {
            // Annullamento vero e proprio: l'utente ha chiuso il selettore senza scegliere nulla.
            notifyImageLoaded(pendingLayer, null, null)
            return
        }
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: SecurityException) {
            // Alcuni provider non supportano i permessi persistenti: non è bloccante,
            // ci serve solo leggere il file una volta per convertirlo in base64.
        }

        try {
            val bytes = readAndDownscale(uri)
            if (bytes == null) {
                android.util.Log.e("DepthWallpaper", "readAndDownscale ha restituito null per uri=$uri")
                notifyImageLoaded(
                    pendingLayer,
                    null,
                    "Impossibile leggere il file selezionato (formato non supportato o file non valido)"
                )
                return
            }
            val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            notifyImageLoaded(pendingLayer, "data:image/jpeg;base64,$base64", null)
        } catch (e: Exception) {
            android.util.Log.e("DepthWallpaper", "Errore leggendo l'immagine uri=$uri", e)
            notifyImageLoaded(pendingLayer, null, "Errore lettura immagine: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    /**
     * Legge l'immagine scelta dalla galleria e la ridimensiona se necessario. Le foto
     * moderne (12+ MP) appesantivano inutilmente WebView, il salvataggio e soprattutto
     * il Live Wallpaper (causa principale del crash silenzioso -> fallback al wallpaper
     * di sistema): qui limitiamo il lato lungo a maxSide prima di ricomprimere in JPEG.
     */
    private fun readAndDownscale(uri: Uri, maxSide: Int = 2000): ByteArray? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val boundsStream = contentResolver.openInputStream(uri) ?: return null
        // NB: in modalita' inJustDecodeBounds, decodeStream restituisce sempre null "per design":
        // non ci interessa il suo valore di ritorno, solo l'effetto collaterale su "bounds".
        boundsStream.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sampleSize = 1
        while (bounds.outWidth / sampleSize > maxSide || bounds.outHeight / sampleSize > maxSide) {
            sampleSize *= 2
        }

        val bitmap = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sampleSize })
        } ?: return null

        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        bitmap.recycle()
        return out.toByteArray()
    }

    private fun notifyImageLoaded(layer: String, dataUrl: String?, errorMessage: String?) {
        runOnUiThread {
            val arg = if (dataUrl != null) "'${dataUrl}'" else "null"
            val errArg = if (errorMessage != null) "'${errorMessage.replace("'", "\\'")}'" else "null"
            webView.evaluateJavascript(
                "window.onImageLoaded && window.onImageLoaded('$layer', $arg, $errArg);",
                null
            )
        }
    }

    private fun notifySubjectCutout(pngDataUrl: String?, errorMessage: String?) {
        runOnUiThread {
            val maskArg = if (pngDataUrl != null) "'${pngDataUrl}'" else "null"
            val errArg = if (errorMessage != null) "'${errorMessage.replace("'", "\\'")}'" else "null"
            webView.evaluateJavascript(
                "window.onSubjectCutout && window.onSubjectCutout($maskArg, $errArg);",
                null
            )
        }
    }

    private fun notifyImageSaved(success: Boolean) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.onImageSaved && window.onImageSaved($success);",
                null
            )
            Toast.makeText(
                this,
                if (success) "Immagine salvata in Galleria \u2022 Pictures/DepthWallpaper" else "Salvataggio non riuscito",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun notifyUpscaleResult(dataUrl: String?, errorMessage: String?) {
        runOnUiThread {
            val arg = if (dataUrl != null) "'${dataUrl}'" else "null"
            val errArg = if (errorMessage != null) "'${errorMessage.replace("'", "\\'")}'" else "null"
            webView.evaluateJavascript(
                "window.onUpscaleResult && window.onUpscaleResult($arg, $errArg);",
                null
            )
        }
    }

    private fun notifyUpscaleProgress(percent: Int) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.onUpscaleProgress && window.onUpscaleProgress($percent);",
                null
            )
        }
    }

    // ---------------------------------------------------------------------
    // Export PNG in galleria
    // ---------------------------------------------------------------------

    private fun saveBitmapToGallery(bytes: ByteArray, fileName: String, mimeType: String = "image/png"): Boolean {
        return try {
            val resolver = contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, mimeType)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(
                        MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/DepthWallpaper"
                    )
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: return false

            resolver.openOutputStream(uri)?.use { out: OutputStream -> out.write(bytes) }
                ?: return false

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun defaultFileName(): String {
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        return "depth_wallpaper_$stamp.png"
    }

    private fun defaultUpscaledFileName(): String {
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        return "depth_wallpaper_upscaled_$stamp.jpg"
    }

    /** Decodifica una data URL "data:image/...;base64,...." in un Bitmap. */
    private fun bitmapFromDataUrl(dataUrl: String): Bitmap? {
        val pureBase64 = dataUrl.substringAfter(",", dataUrl)
        val bytes = Base64.decode(pureBase64, Base64.DEFAULT)
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }

    // ---------------------------------------------------------------------
    // Ponte JavaScript <-> Kotlin esposto alla pagina in assets/index.html
    // ---------------------------------------------------------------------

    inner class WebAppBridge {

        /** Chiamato dal JS quando l'utente tocca "Carica immagine" per il layer indicato. */
        @JavascriptInterface
        fun pickImage(layer: String) {
            pendingLayer = layer.ifBlank { "bg" }
            runOnUiThread {
                try {
                    // ACTION_GET_CONTENT dentro un chooser esplicito mostra TUTTE le app in
                    // grado di fornire un'immagine (Galleria, Google Foto, Files, WhatsApp...),
                    // a differenza di ACTION_OPEN_DOCUMENT che elenca solo i provider SAF
                    // registrati come DocumentsProvider (spesso solo il picker di sistema).
                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "image/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }
                    pickImageLauncher.launch(Intent.createChooser(intent, "Scegli immagine da"))
                } catch (e: Exception) {
                    android.util.Log.e("DepthWallpaper", "Impossibile aprire il selettore immagini", e)
                    notifyImageLoaded(pendingLayer, null, "Impossibile aprire il selettore immagini: ${e.message}")
                }
            }
        }

        /**
         * Ritaglio automatico del soggetto tramite ML Kit Subject Segmentation
         * (modello on-device scaricato via Google Play services, nessun upload verso
         * internet). Riceve la foto scelta come data URL, restituisce a JS il PNG
         * del solo soggetto (sfondo reso trasparente) tramite window.onSubjectCutout,
         * cosi' l'editor puo' comporlo e l'utente rifinire i bordi col pennello.
         */
        @JavascriptInterface
        fun cutoutSubject(imageDataUrl: String) {
            runOnUiThread {
                try {
                    val pureBase64 = imageDataUrl.substringAfter(",", imageDataUrl)
                    val bytes = Base64.decode(pureBase64, Base64.DEFAULT)
                    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    if (bitmap == null) {
                        notifySubjectCutout(null, "Immagine non valida")
                        return@runOnUiThread
                    }

                    val options = SubjectSegmenterOptions.Builder()
                        .enableForegroundBitmap()
                        .build()
                    val segmenter = SubjectSegmentation.getClient(options)
                    val input = InputImage.fromBitmap(bitmap, 0)

                    segmenter.process(input)
                        .addOnSuccessListener { result ->
                            val fg = result.foregroundBitmap
                            if (fg == null) {
                                notifySubjectCutout(null, "Nessun soggetto riconosciuto: usa il pennello")
                            } else {
                                val out = ByteArrayOutputStream()
                                fg.compress(Bitmap.CompressFormat.PNG, 100, out)
                                val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                                notifySubjectCutout("data:image/png;base64,$b64", null)
                            }
                        }
                        .addOnFailureListener {
                            // Es. modello non ancora scaricato al primo avvio dopo l'installazione.
                            notifySubjectCutout(null, "Ritaglio AI non disponibile ora: usa il pennello")
                        }
                } catch (e: Exception) {
                    notifySubjectCutout(null, "Errore durante il ritaglio automatico")
                }
            }
        }

        /** Chiamato dal JS con il PNG renderizzato (data URL) pronto per l'export. */
        @JavascriptInterface
        fun saveImage(base64PngDataUrl: String, suggestedFileName: String?) {
            val fileName = if (suggestedFileName.isNullOrBlank()) defaultFileName() else suggestedFileName
            runOnUiThread {
                try {
                    val pureBase64 = base64PngDataUrl.substringAfter(",", base64PngDataUrl)
                    val bytes = Base64.decode(pureBase64, Base64.DEFAULT)

                    val needsLegacyPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
                        ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE
                        ) != PackageManager.PERMISSION_GRANTED

                    if (needsLegacyPermission) {
                        pendingSaveBytes = bytes
                        pendingSaveFileName = fileName
                        pendingSaveMimeType = "image/png"
                        requestStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    } else {
                        val ok = saveBitmapToGallery(bytes, fileName, "image/png")
                        notifyImageSaved(ok)
                    }
                } catch (e: Exception) {
                    notifyImageSaved(false)
                }
            }
        }

        /**
         * "Upscaling AI": esegue Real-ESRGAN-General-x4v3 (TFLite, on-device) sulla foto
         * intera ricevuta come data URL. NON opera mai sul solo soggetto ritagliato: quella
         * resta una feature separata dell'app, indipendente da questa. L'inferenza a tile
         * puo' richiedere qualche secondo: gira sempre fuori dal thread UI.
         */
        @JavascriptInterface
        fun upscaleImage(imageDataUrl: String) {
            Thread {
                try {
                    val bitmap = bitmapFromDataUrl(imageDataUrl)
                    if (bitmap == null) {
                        notifyUpscaleResult(null, "Immagine non valida")
                        return@Thread
                    }
                    notifyUpscaleProgress(0)
                    var lastSentPercent = -1
                    val result = Upscaler.upscale(applicationContext, bitmap) { fraction ->
                        val percent = (fraction * 100f).toInt().coerceIn(0, 100)
                        // Un evaluateJavascript per ogni variazione di punto percentuale
                        // (non per ogni singola tile): sono al massimo ~100 chiamate a
                        // prescindere da quante tile ha l'immagine, cosi' anche su foto
                        // molto grandi il ping-pong col thread UI resta trascurabile.
                        if (percent != lastSentPercent) {
                            lastSentPercent = percent
                            notifyUpscaleProgress(percent)
                        }
                    }
                    val out = ByteArrayOutputStream()
                    result.compress(Bitmap.CompressFormat.JPEG, 95, out)
                    val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                    notifyUpscaleResult("data:image/jpeg;base64,$b64", null)
                } catch (e: Upscaler.UnavailableException) {
                    notifyUpscaleResult(null, e.message ?: "Upscaling AI non disponibile su questo dispositivo")
                } catch (e: Throwable) {
                    android.util.Log.e("DepthWallpaper", "Upscaling AI fallito", e)
                    notifyUpscaleResult(null, "Upscaling AI non riuscito: ${e.message ?: e.javaClass.simpleName}")
                }
            }.start()
        }

        /**
         * Salva in galleria (JPG) la foto intera gia' upscalata cosi' com'e' arrivata dal
         * JS: nessuna composizione con orologio/data/soggetto, solo l'immagine di base.
         */
        @JavascriptInterface
        fun saveUpscaledJpeg(imageDataUrl: String, suggestedFileName: String?) {
            val fileName = if (suggestedFileName.isNullOrBlank()) defaultUpscaledFileName() else suggestedFileName
            runOnUiThread {
                try {
                    val pureBase64 = imageDataUrl.substringAfter(",", imageDataUrl)
                    val bytes = Base64.decode(pureBase64, Base64.DEFAULT)

                    val needsLegacyPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
                        ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE
                        ) != PackageManager.PERMISSION_GRANTED

                    if (needsLegacyPermission) {
                        pendingSaveBytes = bytes
                        pendingSaveFileName = fileName
                        pendingSaveMimeType = "image/jpeg"
                        requestStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    } else {
                        val ok = saveBitmapToGallery(bytes, fileName, "image/jpeg")
                        notifyImageSaved(ok)
                    }
                } catch (e: Exception) {
                    notifyImageSaved(false)
                }
            }
        }

        /**
         * Ricarica nell'editor l'ultima configurazione applicata (config JSON + le due
         * immagini). Serve quando si riapre l'app o si tocca l'ingranaggio nel selettore
         * di sfondi animati: si riparte da dove si era rimasti invece che da zero.
         */
        @JavascriptInterface
        fun requestSavedState() {
            Thread {
                var json: String? = null
                var bg: String? = null
                var fg: String? = null
                try {
                    json = ConfigStore.loadConfigJson(applicationContext)
                    bg = fileToDataUrl(ConfigStore.bgFile(applicationContext), false)
                    fg = fileToDataUrl(ConfigStore.fgFile(applicationContext), true)
                } catch (e: Throwable) {
                    // niente da ripristinare: si parte dai valori di default
                }
                val jsonArg = if (json != null) org.json.JSONObject.quote(json) else "null"
                val bgArg = if (bg != null) org.json.JSONObject.quote(bg) else "null"
                val fgArg = if (fg != null) org.json.JSONObject.quote(fg) else "null"
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.onRestoreState && window.onRestoreState($jsonArg, $bgArg, $fgArg);",
                        null
                    )
                }
            }.start()
        }

        /**
         * Dimensioni reali dello schermo in pixel (barre di sistema incluse).
         * Servono all'editor per dare all'anteprima le stesse proporzioni dello
         * sfondo reale: prima l'anteprima era fissa 9:16 e su uno schermo piu'
         * allungato l'orologio finiva per apparire piu' piccolo del previsto.
         */
        @JavascriptInterface
        fun getScreenMetrics(): String {
            return try {
                val w: Int
                val h: Int
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bounds = windowManager.maximumWindowMetrics.bounds
                    w = bounds.width()
                    h = bounds.height()
                } else {
                    val metrics = android.util.DisplayMetrics()
                    @Suppress("DEPRECATION")
                    windowManager.defaultDisplay.getRealMetrics(metrics)
                    w = metrics.widthPixels
                    h = metrics.heightPixels
                }
                org.json.JSONObject()
                    .put("width", w.coerceAtLeast(1))
                    .put("height", h.coerceAtLeast(1))
                    .toString()
            } catch (e: Throwable) {
                "{}"
            }
        }

        /** Piccola utility per mostrare messaggi nativi (Toast) dal JS, se serve. */
        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }

        /**
         * Chiamato dal JS quando l'utente tocca "Imposta sfondo animato".
         * Salva configurazione + immagini per il DepthWallpaperService, poi apre
         * il selettore di sistema (che gestisce da solo la scelta Home/Lock/Entrambi).
         */
        @JavascriptInterface
        fun applyLiveWallpaper(configJson: String, bgDataUrl: String, fgDataUrl: String?) {
            runOnUiThread {
                try {
                    writeDataUrlToFile(bgDataUrl, ConfigStore.bgFile(applicationContext))

                    val fgFile = ConfigStore.fgFile(applicationContext)
                    if (!fgDataUrl.isNullOrBlank()) {
                        writeDataUrlToFile(fgDataUrl, fgFile)
                    } else if (fgFile.exists()) {
                        fgFile.delete()
                    }

                    ConfigStore.saveConfigJson(applicationContext, configJson)
                    ConfigStore.notifyConfigUpdated(applicationContext)

                    openLiveWallpaperPicker()
                } catch (e: Throwable) {
                    android.util.Log.e("DepthWallpaper", "applyLiveWallpaper fallita", e)
                    Toast.makeText(
                        this@MainActivity,
                        "Errore nel preparare lo sfondo animato: ${e.message ?: e.javaClass.simpleName}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    /**
     * Rilegge un layer salvato e lo restituisce come data URL gia' ridimensionato:
     * ricaricare una foto a piena risoluzione dentro la WebView sarebbe inutilmente
     * pesante e rischierebbe un OutOfMemoryError all'avvio.
     */
    private fun fileToDataUrl(file: java.io.File, keepAlpha: Boolean): String? {
        if (!file.exists()) return null
        return try {
            val maxSide = if (keepAlpha) 1400 else 1600
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

            var sampleSize = 1
            while (bounds.outWidth / sampleSize > maxSide || bounds.outHeight / sampleSize > maxSide) {
                sampleSize *= 2
            }
            val bitmap = BitmapFactory.decodeFile(
                file.absolutePath,
                BitmapFactory.Options().apply { inSampleSize = sampleSize }
            ) ?: return null

            val out = ByteArrayOutputStream()
            val mime: String
            if (keepAlpha) {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                mime = "image/png"
            } else {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
                mime = "image/jpeg"
            }
            bitmap.recycle()
            "data:$mime;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (e: Throwable) {
            null
        }
    }

    private fun writeDataUrlToFile(dataUrl: String, target: java.io.File) {
        val pureBase64 = dataUrl.substringAfter(",", dataUrl)
        val bytes = Base64.decode(pureBase64, Base64.DEFAULT)
        target.writeBytes(bytes)
    }

    /**
     * Apre l'esperienza di sistema per applicare il nostro Live Wallpaper. Su Android
     * questa UI mostra già in autonomia la scelta tra Schermata Home, Blocco o entrambe.
     */
    private fun openLiveWallpaperPicker() {
        val component = ComponentName(this, DepthWallpaperService::class.java)

        val changeIntent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
        changeIntent.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        try {
            startActivity(changeIntent)
            return
        } catch (e: ActivityNotFoundException) {
            // Alcuni OEM non risolvono questo intent: proviamo il chooser generico.
        }

        try {
            startActivity(Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER))
            return
        } catch (e: ActivityNotFoundException) {
            // Ultima spiaggia
        }

        Toast.makeText(
            this,
            "Apri Impostazioni > Sfondo per selezionare manualmente \"${getString(R.string.app_name)}\"",
            Toast.LENGTH_LONG
        ).show()
    }
}
