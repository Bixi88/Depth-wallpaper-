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
import android.graphics.ImageDecoder
import android.graphics.Matrix
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
import androidx.exifinterface.media.ExifInterface
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

    /**
     * URI del file ORIGINALE scelto come sfondo, conservato apposta per l'Upscaling AI.
     * La copia che vive nella WebView e' volutamente rimpicciolita (serve come anteprima,
     * non come master): darla in pasto al modello significava fargli ricostruire dettagli
     * che nel file originale c'erano gia'. Quando l'utente lancia l'upscaling si riparte
     * da qui, rileggendo il file da zero alla risoluzione che serve davvero.
     * Resta null se lo sfondo non viene da una scelta in galleria (es. stato ripristinato):
     * in quel caso si ricade sul vecchio percorso, che continua a funzionare.
     */
    private var bgSourceUri: Uri? = null

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

        // Solo per lo sfondo: il ritaglio soggetto ("fg-source") non deve mai
        // sovrascrivere il master della foto di sfondo.
        if (pendingLayer == "bg") bgSourceUri = uri

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
        val decoded = decodeAtLongSide(uri, maxSide) ?: return null

        val out = ByteArrayOutputStream()
        decoded.compress(Bitmap.CompressFormat.JPEG, 90, out)
        decoded.recycle()
        return out.toByteArray()
    }

    /**
     * Decodifica l'immagine puntando al lato lungo richiesto, non "alla prima potenza di 2
     * che sta sotto". inSampleSize lavora solo per potenze di 2: chiedendo 2000px su una
     * foto da 4511px, il vecchio codice usava sampleSize=4 e ne consegnava 1127, quasi la
     * meta' di quanto richiesto (e un sedicesimo dei pixel originali). Qui si decodifica al
     * passo di dimezzamento immediatamente SUPERIORE al bisogno e poi si rifinisce con un
     * ridimensionamento filtrato, cosi' si ottiene davvero la dimensione richiesta.
     *
     * Prima di tutto pero' si prova ImageDecoder (API 28+): a differenza di BitmapFactory
     * legge correttamente anche i casi che in pratica mandavano in errore "formato non
     * supportato" pur trattandosi di un .jpg valido, ad es. foto di Google Foto/Drive
     * ancora "solo cloud" (non scaricate sul device: il provider le rende disponibili
     * solo tramite file descriptor, non tramite lo stream diretto che usa BitmapFactory),
     * o file HEIC/WebP salvati con estensione .jpg dopo un trasferimento/conversione.
     */
    private fun decodeAtLongSide(uri: Uri, wantedLongSide: Int): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                val source = ImageDecoder.createSource(contentResolver, uri)
                val decoded = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                    // ImageDecoder applica gia' da solo l'orientamento EXIF: qui serve
                    // solo chiedere il downscale, cosi' evitiamo di allocare l'immagine
                    // a piena risoluzione per poi ridimensionarla subito dopo.
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    decoder.isMutableRequired = true
                    val srcLong = maxOf(info.size.width, info.size.height)
                    if (srcLong > wantedLongSide) {
                        val f = wantedLongSide.toFloat() / srcLong
                        val w = maxOf(1, Math.round(info.size.width * f))
                        val h = maxOf(1, Math.round(info.size.height * f))
                        decoder.setTargetSize(w, h)
                    }
                }
                if (decoded.width > 0 && decoded.height > 0) return decoded
                decoded.recycle()
            } catch (e: Throwable) {
                android.util.Log.w(
                    "DepthWallpaper",
                    "ImageDecoder non è riuscito a leggere uri=$uri, provo con BitmapFactory", e
                )
            }
        }
        decodeAtLongSideLegacy(uri, wantedLongSide)?.let { return it }

        // Ultima spiaggia: alcuni file (tipicamente foto passate da Snapseed) hanno un
        // blocco EXIF che dichiara dimensioni completamente diverse (spesso molto piu'
        // grandi) da quelle dei dati JPEG veri e propri. Sia ImageDecoder sia
        // BitmapFactory possono rifiutare in blocco un file cosi', scambiandolo per
        // corrotto o "non supportato" pur essendo un JPEG valido: si toglie qui solo il
        // blocco EXIF incoerente (mai i dati immagine) e si riprova. L'orientamento
        // corretto viene comunque letto a parte da applyExifOrientation, sul file
        // originale, quindi non si perde.
        return try {
            val raw = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
            val stripped = stripExifSegment(raw)
            if (stripped.size == raw.size) return null // niente da togliere, non aiuterebbe
            decodeAtLongSideFromBytes(stripped, wantedLongSide)
                ?.let { applyExifOrientation(uri, it) } // l'orientamento si legge comunque dal file originale
                ?.also {
                    android.util.Log.i("DepthWallpaper", "Recuperata decodifica di uri=$uri dopo rimozione EXIF incoerente")
                }
        } catch (e: Throwable) {
            android.util.Log.e("DepthWallpaper", "Fallito anche il tentativo con EXIF ripulito per uri=$uri", e)
            null
        }
    }

    /** Rimuove solo il segmento EXIF (marker APP1, 0xFFE1) di un JPEG, lasciando intatti
     * tutti i dati immagine. Se il file non è un JPEG riconoscibile lo restituisce invariato. */
    private fun stripExifSegment(bytes: ByteArray): ByteArray {
        if (bytes.size < 4 || bytes[0] != 0xFF.toByte() || bytes[1] != 0xD8.toByte()) return bytes
        val out = ByteArrayOutputStream(bytes.size)
        out.write(bytes, 0, 2) // SOI
        var i = 2
        while (i + 2 <= bytes.size) {
            if (bytes[i] != 0xFF.toByte()) {
                // Dati inattesi prima dell'inizio della scansione: si copia il resto cosi' com'e'.
                out.write(bytes, i, bytes.size - i)
                i = bytes.size
                break
            }
            val marker = bytes[i + 1].toInt() and 0xFF
            if (marker == 0xD8 || marker == 0x01 || marker in 0xD0..0xD7) {
                out.write(bytes, i, 2) // marcatori senza payload
                i += 2
                continue
            }
            if (marker == 0xD9 || i + 4 > bytes.size) { // EOI o file troncato
                out.write(bytes, i, bytes.size - i)
                i = bytes.size
                break
            }
            val len = ((bytes[i + 2].toInt() and 0xFF) shl 8) or (bytes[i + 3].toInt() and 0xFF)
            val segEnd = i + 2 + len
            if (segEnd > bytes.size) { out.write(bytes, i, bytes.size - i); i = bytes.size; break }
            if (marker != 0xE1) out.write(bytes, i, segEnd - i) // salta solo l'EXIF (APP1)
            i = segEnd
            if (marker == 0xDA) { // inizio dati di scansione: da qui si copia tutto senza reinterpretare
                out.write(bytes, i, bytes.size - i)
                i = bytes.size
                break
            }
        }
        return out.toByteArray()
    }

    /** Come decodeAtLongSideLegacy ma partendo da byte già in memoria invece che da un Uri. */
    private fun decodeAtLongSideFromBytes(bytes: ByteArray, wantedLongSide: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val srcLong = maxOf(bounds.outWidth, bounds.outHeight)
        var sampleSize = 1
        while (srcLong / (sampleSize * 2) >= wantedLongSide) sampleSize *= 2

        val decoded = BitmapFactory.decodeByteArray(
            bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sampleSize }
        ) ?: return null

        val long = maxOf(decoded.width, decoded.height)
        if (long <= wantedLongSide) return decoded

        val f = wantedLongSide.toFloat() / long
        val w = maxOf(1, Math.round(decoded.width * f))
        val h = maxOf(1, Math.round(decoded.height * f))
        val scaled = Bitmap.createScaledBitmap(decoded, w, h, true)
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }

    /** Vecchio percorso via BitmapFactory: resta come fallback per API < 28 e per i
     * (rari) casi in cui anche ImageDecoder fallisce. */
    private fun decodeAtLongSideLegacy(uri: Uri, wantedLongSide: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        try {
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                ?: run {
                    android.util.Log.e("DepthWallpaper", "openInputStream nullo per uri=$uri")
                    return null
                }
        } catch (e: Throwable) {
            android.util.Log.e("DepthWallpaper", "Errore leggendo i bounds di uri=$uri", e)
            return null
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            android.util.Log.e(
                "DepthWallpaper",
                "BitmapFactory non ha riconosciuto il formato di uri=$uri (mimeType=${bounds.outMimeType})"
            )
            return null
        }

        val srcLong = maxOf(bounds.outWidth, bounds.outHeight)
        // Il piu' grande dimezzamento che lascia comunque almeno i pixel richiesti.
        var sampleSize = 1
        while (srcLong / (sampleSize * 2) >= wantedLongSide) sampleSize *= 2

        val rawDecoded = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sampleSize })
        } ?: return null

        // I pixel nel file sono spesso "sdraiati": il telefono scrive l'immagine cosi'
        // com'e' uscita dal sensore e annota a parte, nei metadati EXIF, di quanto va
        // girata per apparire dritta. Chi guarda solo i pixel (come BitmapFactory) la
        // vede storta. Si applica qui, in un punto solo, cosi' anteprima, ritaglio
        // soggetto e Upscaling AI restano automaticamente coerenti fra loro.
        val decoded = applyExifOrientation(uri, rawDecoded)

        val long = maxOf(decoded.width, decoded.height)
        if (long <= wantedLongSide) return decoded

        val f = wantedLongSide.toFloat() / long
        val w = maxOf(1, Math.round(decoded.width * f))
        val h = maxOf(1, Math.round(decoded.height * f))
        val scaled = Bitmap.createScaledBitmap(decoded, w, h, true)
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }

    /**
     * Legge l'orientamento EXIF del file (0/90/180/270°, con eventuale ribaltamento
     * a specchio) e restituisce il bitmap gia' raddrizzato. Se manca l'informazione,
     * se e' gia' "normale", o se qualcosa va storto nella lettura, restituisce il
     * bitmap originale senza toccarlo: meglio un'immagine eventualmente ancora storta
     * che un crash.
     */
    private fun applyExifOrientation(uri: Uri, bitmap: Bitmap): Bitmap {
        val orientation = try {
            contentResolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(
                ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
            ) } ?: ExifInterface.ORIENTATION_NORMAL
        } catch (e: Throwable) {
            ExifInterface.ORIENTATION_NORMAL
        }
        if (orientation == ExifInterface.ORIENTATION_NORMAL || orientation == ExifInterface.ORIENTATION_UNDEFINED) {
            return bitmap
        }

        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
            else -> return bitmap
        }

        return try {
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            if (rotated !== bitmap) bitmap.recycle()
            rotated
        } catch (e: Throwable) {
            bitmap
        }
    }

    /** Foto pronta per il modello + lato lungo che il risultato dovra' avere. */
    private class UpscaleSource(val bitmap: Bitmap, val targetLongSide: Int)

    /**
     * Legge solo le dimensioni originali del file (senza decodificarne tutti i pixel),
     * con la stessa strategia "ImageDecoder prima, BitmapFactory come fallback" di
     * decodeAtLongSide: cosi' anche l'Upscaling AI non si blocca sugli stessi casi
     * (foto cloud-only non scaricate, ecc.) risolti li'.
     */
    private fun probeImageSize(uri: Uri): Pair<Int, Int>? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                var w = 0
                var h = 0
                val source = ImageDecoder.createSource(contentResolver, uri)
                val probe = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                    w = info.size.width
                    h = info.size.height
                    // Ci serve solo la dimensione originale (letta sopra da "info"),
                    // non i pixel: chiediamo la bitmap piu' piccola possibile.
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    decoder.setTargetSize(1, 1)
                }
                probe.recycle()
                if (w > 0 && h > 0) return w to h
            } catch (e: Throwable) {
                android.util.Log.w("DepthWallpaper", "ImageDecoder non ha letto le dimensioni di uri=$uri", e)
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        try {
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
        } catch (e: Throwable) {
            return null
        }
        if (bounds.outWidth > 0 && bounds.outHeight > 0) return bounds.outWidth to bounds.outHeight

        // Stesso problema di decodeAtLongSide: EXIF con dimensioni incoerenti rispetto
        // ai dati JPEG veri e propri (tipico di export Snapseed). Si ripulisce e riprova.
        return try {
            val raw = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
            val stripped = stripExifSegment(raw)
            if (stripped.size == raw.size) return null
            val strippedBounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(stripped, 0, stripped.size, strippedBounds)
            if (strippedBounds.outWidth > 0 && strippedBounds.outHeight > 0) {
                strippedBounds.outWidth to strippedBounds.outHeight
            } else null
        } catch (e: Throwable) {
            null
        }
    }

    /**
     * Prepara la sorgente dell'Upscaling AI rileggendo il file ORIGINALE. Due cose che
     * prima non succedevano: il target finale viene calcolato sulle dimensioni vere del
     * file (quindi l'upscale non puo' piu' consegnare un'immagine piu' piccola della foto
     * di partenza), e al modello arriva la risoluzione che gli serve davvero, letta dal
     * file e non da un JPEG gia' ridotto e ricompresso.
     * Da chiamare fuori dal thread UI.
     */
    private fun loadUpscaleSource(uri: Uri): UpscaleSource? {
        val (origW, origH) = probeImageSize(uri) ?: return null

        val origLong = maxOf(origW, origH)
        val target = Upscaler.targetLongSideFor(origLong)
        // Mai oltre l'originale: ingrandire prima dell'inferenza darebbe alla rete
        // pixel gia' interpolati, cioe' dettaglio finto al posto di dettaglio vero.
        val input = Upscaler.plannedInputLongSide(applicationContext, target).coerceAtMost(origLong)

        val bitmap = decodeAtLongSide(uri, input) ?: return null
        return UpscaleSource(bitmap, target)
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
         * intera. NON opera mai sul solo soggetto ritagliato: quella resta una feature
         * separata dell'app, indipendente da questa. L'inferenza a tile puo' richiedere
         * qualche secondo: gira sempre fuori dal thread UI.
         *
         * Il data URL ricevuto dal JS e' solo un RIPIEGO. La sorgente buona e' il file
         * originale in galleria (bgSourceUri), riletto qui da zero: il data URL e' la
         * copia rimpicciolita per l'anteprima, usarla significava chiedere al modello di
         * reinventare dettagli che nel file c'erano gia'.
         *
         * L'operazione e' ripetibile: premendo di nuovo "Upscaling AI" si riparte sempre
         * dall'originale, quindi non si impilano due passaggi 4x uno sull'altro.
         */
        @JavascriptInterface
        fun upscaleImage(imageDataUrl: String) {
            Thread {
                try {
                    // 1) Percorso buono: si riparte dal file originale in galleria.
                    var source: UpscaleSource? = null
                    val uri = bgSourceUri
                    if (uri != null) {
                        source = try {
                            loadUpscaleSource(uri)
                        } catch (e: Throwable) {
                            android.util.Log.w("DepthWallpaper", "Originale non rileggibile, uso la copia in anteprima", e)
                            null
                        }
                    }
                    // 2) Ripiego: la copia gia' presente nella WebView (stato ripristinato,
                    //    permesso revocato, file rimosso dalla galleria...). Qualita' come prima.
                    if (source == null) {
                        val fallback = bitmapFromDataUrl(imageDataUrl)
                        if (fallback == null) {
                            notifyUpscaleResult(null, "Immagine non valida")
                            return@Thread
                        }
                        source = UpscaleSource(
                            fallback,
                            Upscaler.targetLongSideFor(maxOf(fallback.width, fallback.height))
                        )
                    }
                    val prepared = source
                    if (prepared == null) {
                        notifyUpscaleResult(null, "Immagine non valida")
                        return@Thread
                    }
                    val bitmap = prepared.bitmap

                    notifyUpscaleProgress(0)
                    var lastSentPercent = -1
                    val result = Upscaler.upscale(applicationContext, bitmap, prepared.targetLongSide) { fraction ->
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
                    // La sorgente non serve piu': liberarla prima di allocare il JPEG
                    // evita di tenere due immagini grandi in heap nello stesso istante.
                    if (!bitmap.isRecycled) bitmap.recycle()

                    val out = ByteArrayOutputStream()
                    result.compress(Bitmap.CompressFormat.JPEG, 95, out)
                    result.recycle()
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
