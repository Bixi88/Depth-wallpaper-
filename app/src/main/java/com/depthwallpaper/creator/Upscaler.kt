package com.depthwallpaper.creator

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.Tensor
import org.tensorflow.lite.nnapi.NnApiDelegate
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * "Upscaling AI" della foto intera. Due modelli selezionabili (vedi UpscaleModel sotto):
 * di default quello VELOCE, Real-ESRGAN-General-x4v3 (TFLite, BSD-3-Clause,
 * https://huggingface.co/qualcomm/Real-ESRGAN-General-x4v3), pensato apposta per foto
 * reali imperfette (blur/rumore/compressione), non per disegni; in alternativa, quando
 * l'asset e' presente, quello di QUALITA' superiore Real-ESRGAN-x4plus (stessa licenza,
 * https://huggingface.co/qualcomm/Real-ESRGAN-x4plus), piu' pesante in calcoli ma con
 * dettaglio ricostruito piu' pulito. Gira sempre 100% on-device: nessun upload, nessun
 * permesso Internet richiesto.
 *
 * Il modello accetta SOLO tile fisse (di norma 128x128 -> 512x512, fattore 4x fisso):
 * qui la foto intera viene spezzata in tile con un piccolo margine di contesto
 * ("overlap") che poi si scarta al momento di ricomporre il risultato, cosi' non
 * restano righe visibili ai bordi delle tile (approccio standard per super-resolution
 * a tile). Tutta la lettura/scrittura pixel lavora su IntArray (getPixels/setPixels
 * in blocco) invece che pixel per pixel: su una foto di qualche megapixel il secondo
 * approccio sarebbe troppo lento e rischierebbe un ANR.
 *
 * DIMENSIONE FINALE — il punto critico per la qualita'. Chi chiama passa targetLongSide,
 * cioe' il lato lungo che vogliamo ottenere, calcolato sulla FOTO ORIGINALE su disco
 * (vedi targetLongSideFor) e non sulla copia rimpicciolita che vive nella WebView:
 * altrimenti l'upscale "AI" finisce per restituire un'immagine piu' piccola, e quindi
 * peggiore, dell'originale che l'utente ha scelto.
 *
 * Il risultato del modello viene riportato al target con un filtro a media d'area
 * ("box") calcolato in streaming, banda per banda. Due motivi:
 *  1. qualita': Bitmap.createScaledBitmap, anche con filter=true, e' bilineare e su
 *     riduzioni superiori a 2x scarta pixel -> aliasing e immagine molle. La media
 *     d'area invece usa TUTTI i pixel prodotti dal modello (supersampling), quindi il
 *     dettaglio ricostruito dalla rete si consolida invece di essere buttato via.
 *  2. memoria: non si materializza mai l'output 4x intero. Su una sorgente da ~1700px
 *     di lato il 4x sarebbe ~27 MP (oltre 100 MB di soli pixel); qui si tiene in RAM
 *     solo una banda alta quanto il nucleo di una riga di tile.
 */
object Upscaler {

    /**
     * Modelli disponibili. QUALITY e' opzionale: se il file .tflite non e' incluso
     * nell'app (assets/models/), ensureInterpreter lancia UnavailableException con un
     * messaggio che spiega cosa manca, invece di far crashare l'inferenza.
     */
    enum class UpscaleModel(val assetPath: String, val label: String) {
        FAST("models/realesrgan-x4v3.tflite", "Veloce"),
        QUALITY("models/realesrgan-x4plus_w8a8.tflite", "Qualit\u00e0 (pi\u00f9 lento)");

        companion object {
            fun fromId(id: String?): UpscaleModel = when (id) {
                "quality" -> QUALITY
                else -> FAST
            }
        }
    }

    /** Contesto extra (in pixel, spazio sorgente) attorno al "nucleo" di ogni tile,
     *  scartato dopo l'inferenza per evitare cuciture visibili tra una tile e l'altra. */
    private const val OVERLAP = 8

    /** Lato lungo minimo garantito per il risultato: coerente con l'ordine di grandezza
     *  (~1750x3499) osservato negli asset di un'app di sfondi animati simile, pensato per
     *  coprire comodamente lo schermo durante il movimento del parallasse. E' solo un
     *  PAVIMENTO: se la foto originale e' gia' piu' grande, vince la foto originale. */
    private const val SAFETY_MIN_LONG_SIDE = 3500

    /** Tetto assoluto invalicabile, solo per evitare OutOfMemory su foto sorgente enormi
     *  (una foto da 8000px di lato non ha senso come sfondo di un telefono). */
    private const val SAFETY_HARD_CAP_LONG_SIDE = 6000

    /**
     * Quanti pixel chiediamo al modello in piu' rispetto al target finale.
     * 1.0 = il modello lavora esattamente alla dimensione finale (piu' veloce);
     * 1.5 = gli diamo in pasto una sorgente 1.5x piu' grande, quindi piu' dettaglio
     * VERO letto dal file, e poi si riduce con media d'area (piu' nitido, ma ~2x piu'
     * lento perche' il numero di tile cresce col quadrato). 1.5 e' il compromesso
     * scelto: abbassalo a 1.2 se su dispositivi lenti l'attesa ti sembra eccessiva.
     */
    private const val SUPERSAMPLE = 1.5f

    /** Un modello caricato e pronto: interprete TFLite + le dimensioni di tile che
     *  quel particolare file dichiara nei suoi tensori di input/output. Tenerle qui
     *  (invece che in variabili condivise dell'object) evita che due modelli diversi
     *  usati a ridosso l'uno dell'altro si "pestino i piedi" a runtime. */
    private class LoadedModel(
        val interpreter: Interpreter,
        val delegate: NnApiDelegate?,
        val tileIn: Int,
        val tileOut: Int,
        val scale: Int,
        /** Tabella pixel (0..255) -> byte da scrivere nel tensore di input quando il modello
         *  e' quantizzato (UINT8/INT8, es. la versione w8a8); null se l'input e' float32. */
        val inLut: ByteArray?,
        /** Tabella byte di output (0..255) -> canale 0..255 quando l'output e' quantizzato;
         *  null se l'output e' float32. */
        val outLut: IntArray?,
        /** Descrizione leggibile di come gira il modello, es. "NNAPI · 85 ms/tile" oppure
         *  "CPU · 180 ms/tile" (tempo misurato su una tile vera al caricamento). */
        val backend: String
    )

    private val loadedModels = HashMap<UpscaleModel, LoadedModel>()

    class UnavailableException(message: String) : Exception(message)

    @Synchronized
    private fun ensureInterpreter(context: Context, model: UpscaleModel): LoadedModel {
        loadedModels[model]?.let { return it }

        val modelBuffer = try {
            loadModelFile(context, model.assetPath)
        } catch (e: Exception) {
            throw UnavailableException(
                if (model == UpscaleModel.QUALITY)
                    "Modello \"${model.label}\" non incluso in questa build: aggiungi il file " +
                        "assets/${model.assetPath} e ricompila l'app per abilitarlo."
                else
                    "Modello di upscaling non trovato nell'app"
            )
        }

        val options = Interpreter.Options().apply { setNumThreads(max(2, Runtime.getRuntime().availableProcessors())) }

        // Su NPU/DSP e' molto piu' veloce: si tenta il delegate NNAPI (Android 8.1+) e,
        // se il dispositivo/driver non lo supporta bene, si ricade in automatico sulla CPU.
        var built: Interpreter? = null
        var delegate: NnApiDelegate? = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            var d: NnApiDelegate? = null
            var candidate: Interpreter? = null
            try {
                val nd = NnApiDelegate()
                d = nd
                val nnOptions = Interpreter.Options().apply {
                    setNumThreads(max(2, Runtime.getRuntime().availableProcessors()))
                    addDelegate(nd)
                }
                candidate = Interpreter(modelBuffer, nnOptions)
                // Prova a vuoto: con NNAPI molti errori (driver, operatori quantizzati non
                // supportati) escono solo alla prima inferenza, non alla creazione. Meglio
                // scoprirlo qui e ricadere sulla CPU che fallire a meta' upscale.
                warmUp(candidate)
                built = candidate
                delegate = d
            } catch (e: Throwable) {
                try { candidate?.close() } catch (_: Throwable) {}
                try { d?.close() } catch (_: Throwable) {}
                delegate = null
                built = null
            }
        }
        var interp = built ?: Interpreter(modelBuffer, options)

        // NNAPI non e' sempre piu' veloce della CPU (su alcuni chip/driver puo' anzi esserlo
        // molto meno). Per non tirare a indovinare si misura una tile vera su entrambi i
        // backend e si tiene il piu' veloce: stesso modello, stessi pesi, nessuna perdita
        // di qualita'. NNAPI resta preferito a parita' di tempo (consuma meno).
        var msPerTile = benchmarkMs(interp)
        var backendName = if (delegate != null) "NNAPI" else "CPU"
        var versus = ""
        if (delegate != null) {
            var cpu: Interpreter? = null
            try {
                val c = Interpreter(modelBuffer, options)
                cpu = c
                val cpuMs = benchmarkMs(c)
                if (cpuMs >= 0 && (msPerTile < 0 || cpuMs < msPerTile * 0.9)) {
                    versus = " \u00b7 NNAPI $msPerTile ms"
                    try { interp.close() } catch (_: Throwable) {}
                    try { delegate?.close() } catch (_: Throwable) {}
                    delegate = null
                    interp = c
                    cpu = null
                    msPerTile = cpuMs
                    backendName = "CPU"
                } else if (cpuMs >= 0) {
                    versus = " \u00b7 CPU $cpuMs ms"
                }
            } catch (e: Throwable) {
                // il confronto e' solo diagnostico: se fallisce si tiene NNAPI
            } finally {
                try { cpu?.close() } catch (_: Throwable) {}
            }
        }

        var tileIn = 128
        var tileOut = 512
        var scale = 4
        val inShape = interp.getInputTensor(0).shape() // [1, H, W, 3]
        val outShape = interp.getOutputTensor(0).shape() // [1, H*scale, W*scale, 3]
        if (inShape.size == 4 && outShape.size == 4 && inShape[1] > 0 && outShape[1] > 0) {
            tileIn = inShape[1]
            tileOut = outShape[1]
            scale = max(1, tileOut / tileIn)
        }

        // Il modello "Qualita'" (w8a8) e' quantizzato: input/output UINT8 (1 byte per canale)
        // invece di float32 (4 byte). Il buffer va dimensionato e riempito di conseguenza,
        // altrimenti TFLite rifiuta la copia ("...tensor (image) with 49152 bytes from a
        // Java Buffer with 196608 bytes").
        val luts = try {
            Pair(
                buildInputLut(interp.getInputTensor(0)),
                buildOutputLut(interp.getOutputTensor(0))
            )
        } catch (e: Throwable) {
            interp.close()
            delegate?.close()
            throw e
        }

        val backend = backendName +
            (if (msPerTile >= 0) " \u00b7 $msPerTile ms/tile" else "") + versus

        val loaded = LoadedModel(interp, delegate, tileIn, tileOut, scale, luts.first, luts.second, backend)
        loadedModels[model] = loaded
        return loaded
    }

    /** Una inferenza su input nullo, con buffer dimensionati dai tensori stessi. */
    private fun warmUp(interp: Interpreter) {
        timedRunMs(interp)
    }

    /** Tempo in ms di una tile vera: la prima esecuzione (che include l'inizializzazione)
     *  si scarta, la seconda e' la misura. -1 se l'esecuzione fallisce. */
    private fun benchmarkMs(interp: Interpreter): Long = try {
        timedRunMs(interp)
        timedRunMs(interp)
    } catch (e: Throwable) {
        -1L
    }

    /** Come warmUp, ma restituisce i millisecondi impiegati da una tile. */
    private fun timedRunMs(interp: Interpreter): Long {
        val inBuf = ByteBuffer.allocateDirect(interp.getInputTensor(0).numBytes()).order(ByteOrder.nativeOrder())
        val outBuf = ByteBuffer.allocateDirect(interp.getOutputTensor(0).numBytes()).order(ByteOrder.nativeOrder())
        val t0 = System.nanoTime()
        interp.run(inBuf, outBuf)
        return (System.nanoTime() - t0) / 1_000_000L
    }

    private fun isQuantized(t: Tensor): Boolean = when (t.dataType()) {
        DataType.FLOAT32 -> false
        DataType.UINT8, DataType.INT8 -> true
        else -> throw UnavailableException("Tipo di tensore del modello non supportato: ${t.dataType()}")
    }

    /** LUT pixel(0..255) -> valore quantizzato dell'input, usando scale/zeroPoint dichiarati
     *  dal modello. Null se il tensore di input e' float32. */
    private fun buildInputLut(t: Tensor): ByteArray? {
        if (!isQuantized(t)) return null
        val qp = t.quantizationParams()
        val scale = if (qp.scale > 0f) qp.scale else 1f / 255f
        val zp = qp.zeroPoint
        val signed = t.dataType() == DataType.INT8
        val lo = if (signed) -128 else 0
        val hi = if (signed) 127 else 255
        return ByteArray(256) { p ->
            val q = ((p / 255f) / scale + zp).roundToInt().coerceIn(lo, hi)
            q.toByte()
        }
    }

    /** LUT byte di output -> canale 0..255. Null se il tensore di output e' float32. */
    private fun buildOutputLut(t: Tensor): IntArray? {
        if (!isQuantized(t)) return null
        val qp = t.quantizationParams()
        val scale = if (qp.scale > 0f) qp.scale else 1f / 255f
        val zp = qp.zeroPoint
        val signed = t.dataType() == DataType.INT8
        return IntArray(256) { idx ->
            val q = if (signed) idx.toByte().toInt() else idx
            (((q - zp) * scale) * 255f).roundToInt().coerceIn(0, 255)
        }
    }

    private fun loadModelFile(context: Context, assetPath: String): MappedByteBuffer {
        val afd = context.assets.openFd(assetPath)
        afd.use { fd ->
            val inputStream = fd.createInputStream()
            inputStream.use { stream ->
                val channel = stream.channel
                return channel.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
            }
        }
    }

    /** Riga diagnostica sul backend in uso per questo modello (vedi LoadedModel.backend),
     *  oppure null se il modello non e' caricabile. Va invocata fuori dal thread UI. */
    fun backendLabel(context: Context, model: UpscaleModel): String? =
        try { ensureInterpreter(context, model).backend } catch (e: Throwable) { null }

    /** Riepilogo dell'ultimo upscale completato (backend, tile, ms/tile, secondi). */
    @Volatile
    var lastRunSummary: String = ""
        private set

    /** Vero se l'asset del modello e' effettivamente incluso in questa build (utile per
     *  mostrare/nascondere l'opzione "Qualit\u00e0" nella UI senza dover tentare l'inferenza). */
    fun isModelAvailable(context: Context, model: UpscaleModel): Boolean {
        if (loadedModels.containsKey(model)) return true
        return try {
            context.assets.openFd(model.assetPath).use { true }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Lato lungo che deve avere il risultato, dato il lato lungo della foto ORIGINALE
     * (quella su disco, non la copia ridotta per l'anteprima). Regola: mai sotto
     * SAFETY_MIN_LONG_SIDE, mai sotto l'originale, mai sopra il tetto di sicurezza.
     */
    fun targetLongSideFor(sourceLongSide: Int): Int =
        max(SAFETY_MIN_LONG_SIDE, sourceLongSide).coerceAtMost(SAFETY_HARD_CAP_LONG_SIDE)

    /**
     * Lato lungo a cui conviene decodificare la foto originale prima di darla al modello.
     * Chi chiama deve comunque limitarlo alla dimensione reale del file: ingrandire la
     * sorgente prima dell'inferenza non aggiungerebbe un solo dettaglio vero, farebbe
     * solo lavorare la rete su pixel gia' interpolati.
     * Va invocata fuori dal thread UI (la prima volta inizializza l'interprete TFLite).
     */
    fun plannedInputLongSide(context: Context, targetLongSide: Int, model: UpscaleModel = UpscaleModel.FAST): Int {
        val s = try {
            ensureInterpreter(context, model).scale
        } catch (e: Throwable) {
            4
        }
        // Pavimento: sotto target/scale il modello non arriverebbe nemmeno al target.
        val floor = ceil(targetLongSide.toDouble() / s).toInt()
        val wanted = ceil(targetLongSide * SUPERSAMPLE / s).toInt()
        return max(1, max(floor, wanted))
    }

    /**
     * Esegue l'upscaling AI sull'intera foto e restituisce il bitmap risultante, gia'
     * riportato a targetLongSide. Va chiamata FUORI dal thread UI: l'inferenza a tile su
     * una foto intera richiede da qualche secondo (NPU, modello veloce) a decine di
     * secondi (CPU, o modello di qualita' superiore) a seconda del dispositivo.
     *
     * @param targetLongSide lato lungo desiderato del risultato; se <= 0 si ricade sul
     *        vecchio comportamento (dedotto dalla sorgente ricevuta).
     * @param model quale rete usare (vedi UpscaleModel): FAST di default.
     * @param onProgress richiamato dopo ogni tile con l'avanzamento REALE (0f..1f).
     */
    fun upscale(
        context: Context,
        src: Bitmap,
        targetLongSide: Int = 0,
        model: UpscaleModel = UpscaleModel.FAST,
        onProgress: ((Float) -> Unit)? = null
    ): Bitmap {
        val loaded = ensureInterpreter(context, model)
        val interp = loaded.interpreter
        val tileIn = loaded.tileIn
        val tileOut = loaded.tileOut
        val scale = loaded.scale

        val runStartNs = System.nanoTime()
        var inferenceNs = 0L

        val srcW = src.width
        val srcH = src.height
        val srcPixels = IntArray(srcW * srcH)
        src.getPixels(srcPixels, 0, srcW, 0, 0, srcW, srcH)

        val overlap = min(OVERLAP, (tileIn / 2) - 1).coerceAtLeast(0)
        val core = tileIn - 2 * overlap
        val coreOut = core * scale
        val overlapOut = overlap * scale

        val xs = tileStarts(srcW, core)
        val ys = tileStarts(srcH, core)
        val totalTiles = xs.size * ys.size
        var doneTiles = 0

        val outW = srcW * scale
        val outH = srcH * scale


        // --- dimensioni finali -------------------------------------------------
        val requested = if (targetLongSide > 0) targetLongSide else targetLongSideFor(max(srcW, srcH))
        // Non si ingrandisce mai oltre cio' che il modello ha effettivamente prodotto.
        val finalLong = requested
            .coerceAtMost(SAFETY_HARD_CAP_LONG_SIDE)
            .coerceAtMost(max(outW, outH))
            .coerceAtLeast(1)
        val f = finalLong.toDouble() / max(outW, outH)
        val dstW = max(1, (outW * f).roundToInt())
        val dstH = max(1, (outH * f).roundToInt())

        val dst = Bitmap.createBitmap(dstW, dstH, Bitmap.Config.ARGB_8888)

        // Confini di colonna precalcolati per la media d'area orizzontale.
        val colStart = IntArray(dstW + 1)
        for (t in 0..dstW) colStart[t] = ((t.toLong() * outW) / dstW).toInt().coerceIn(0, outW)
        for (t in 0 until dstW) if (colStart[t + 1] <= colStart[t]) colStart[t + 1] = min(outW, colStart[t] + 1)

        // Accumulatori della riga di destinazione in costruzione (media verticale).
        val accR = FloatArray(dstW)
        val accG = FloatArray(dstW)
        val accB = FloatArray(dstW)
        val rowOut = IntArray(dstW)
        var accRows = 0
        var currentDstRow = 0

        // Una sola banda di output alla volta: alta quanto il nucleo di una riga di tile.
        val band = IntArray(outW * coreOut)
        val quantOut = loaded.outLut != null
        val tileFloats = FloatArray(if (quantOut) 0 else tileOut * tileOut * 3)
        val tileBytes = ByteArray(if (quantOut) tileOut * tileOut * 3 else 0)

        // float32 = 4 byte per canale, UINT8/INT8 (modello quantizzato) = 1 byte.
        val inBytesPer = if (loaded.inLut != null) 1 else 4
        val outBytesPer = if (quantOut) 1 else 4
        val inputBuffer = ByteBuffer.allocateDirect(tileIn * tileIn * 3 * inBytesPer).order(ByteOrder.nativeOrder())
        val outputBuffer = ByteBuffer.allocateDirect(tileOut * tileOut * 3 * outBytesPer).order(ByteOrder.nativeOrder())

        // Prima riga di output non ancora consumata: l'ultima banda e' allineata al bordo
        // inferiore e quindi si sovrappone alla precedente, le righe gia' emesse si saltano.
        var nextOutRow = 0

        for (cy in ys) {
            val bandY0 = cy * scale
            val bandH = min(coreOut, outH - bandY0)
            if (bandH <= 0) continue

            for (cx in xs) {
                fillInputTile(inputBuffer, loaded.inLut, srcPixels, srcW, srcH, cx - overlap, cy - overlap, tileIn)
                outputBuffer.rewind()
                val t0 = System.nanoTime()
                interp.run(inputBuffer, outputBuffer)
                inferenceNs += System.nanoTime() - t0
                writeTileCoreIntoBand(
                    outputBuffer, loaded.outLut, tileFloats, tileBytes, band, outW, bandH,
                    tileOut, overlapOut, coreOut, cx * scale
                )
                doneTiles++
                onProgress?.invoke(doneTiles.toFloat() / totalTiles)
            }

            // La banda e' completa: la si consuma subito, riga per riga.
            for (row in 0 until bandH) {
                val y = bandY0 + row
                if (y < nextOutRow) continue
                nextOutRow = y + 1

                val targetRow = ((y.toLong() * dstH) / outH).toInt().coerceIn(0, dstH - 1)
                if (targetRow != currentDstRow) {
                    flushRow(dst, rowOut, accR, accG, accB, accRows, currentDstRow, dstW)
                    java.util.Arrays.fill(accR, 0f)
                    java.util.Arrays.fill(accG, 0f)
                    java.util.Arrays.fill(accB, 0f)
                    accRows = 0
                    currentDstRow = targetRow
                }

                val base = row * outW
                for (t in 0 until dstW) {
                    val x0 = colStart[t]
                    val x1 = colStart[t + 1]
                    var r = 0
                    var g = 0
                    var b = 0
                    for (x in x0 until x1) {
                        val px = band[base + x]
                        r += (px shr 16) and 0xFF
                        g += (px shr 8) and 0xFF
                        b += px and 0xFF
                    }
                    val n = (x1 - x0).coerceAtLeast(1)
                    accR[t] += r.toFloat() / n
                    accG[t] += g.toFloat() / n
                    accB[t] += b.toFloat() / n
                }
                accRows++
            }
        }
        if (accRows > 0) flushRow(dst, rowOut, accR, accG, accB, accRows, currentDstRow, dstW)

        val totalSec = (System.nanoTime() - runStartNs) / 1_000_000_000.0
        val avgMs = if (totalTiles > 0) inferenceNs / 1_000_000L / totalTiles else 0L
        lastRunSummary = "${loaded.backend.substringBefore(' ')} \u00b7 $totalTiles tile \u00b7 $avgMs ms/tile \u00b7 ${totalSec.roundToInt()} s"

        return dst
    }

    private fun flushRow(
        dst: Bitmap, rowOut: IntArray,
        accR: FloatArray, accG: FloatArray, accB: FloatArray,
        accRows: Int, dstRow: Int, dstW: Int
    ) {
        if (accRows <= 0 || dstRow < 0 || dstRow >= dst.height) return
        for (t in 0 until dstW) {
            val r = (accR[t] / accRows).roundToInt().coerceIn(0, 255)
            val g = (accG[t] / accRows).roundToInt().coerceIn(0, 255)
            val b = (accB[t] / accRows).roundToInt().coerceIn(0, 255)
            rowOut[t] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
        dst.setPixels(rowOut, 0, dstW, 0, dstRow, dstW, 1)
    }

    /** Posizioni di partenza del "nucleo" di ogni tile lungo un asse: l'ultima è
     *  sempre spostata a filo del bordo, cosi' l'immagine e' coperta per intero
     *  senza lasciare una striscia finale piu' stretta della tile. */
    private fun tileStarts(total: Int, core: Int): List<Int> {
        if (core <= 0 || total <= core) return listOf(0)
        val starts = mutableListOf<Int>()
        var c = 0
        while (c + core < total) {
            starts.add(c)
            c += core
        }
        starts.add(total - core)
        return starts
    }

    /** Copia nel buffer di input (float32 normalizzato 0..1 oppure byte quantizzati, NHWC) la finestra
     *  winX0..winX0+tile, con replica del bordo (clamp) per i pixel fuori immagine. */
    private fun fillInputTile(
        buffer: ByteBuffer, lut: ByteArray?, srcPixels: IntArray, srcW: Int, srcH: Int,
        winX0: Int, winY0: Int, tile: Int
    ) {
        buffer.rewind()
        for (row in 0 until tile) {
            val sy = (winY0 + row).coerceIn(0, srcH - 1)
            val rowBase = sy * srcW
            for (col in 0 until tile) {
                val sx = (winX0 + col).coerceIn(0, srcW - 1)
                val px = srcPixels[rowBase + sx]
                if (lut != null) {
                    // modello quantizzato: 1 byte per canale
                    buffer.put(lut[(px shr 16) and 0xFF]) // R
                    buffer.put(lut[(px shr 8) and 0xFF])  // G
                    buffer.put(lut[px and 0xFF])          // B
                } else {
                    buffer.putFloat(((px shr 16) and 0xFF) / 255f) // R
                    buffer.putFloat(((px shr 8) and 0xFF) / 255f)  // G
                    buffer.putFloat((px and 0xFF) / 255f)          // B
                }
            }
        }
        buffer.rewind()
    }

    /** Scarta la cornice di contesto dall'output della tile e incolla solo il "nucleo"
     *  nella banda corrente (alta esattamente quanto il nucleo di una riga di tile). */
    private fun writeTileCoreIntoBand(
        buffer: ByteBuffer, lut: IntArray?, floats: FloatArray, bytes: ByteArray, band: IntArray,
        outW: Int, bandH: Int,
        tileOut: Int, overlapOut: Int, coreOut: Int, dstX0: Int
    ) {
        buffer.rewind()
        if (lut != null) buffer.get(bytes) else buffer.asFloatBuffer().get(floats)

        val h = min(coreOut, bandH)
        val w = min(coreOut, outW - dstX0)
        if (h <= 0 || w <= 0) return

        for (row in 0 until h) {
            val srcRow = row + overlapOut
            if (srcRow >= tileOut) break
            val dstRowBase = row * outW
            val srcRowBase = srcRow * tileOut * 3
            for (col in 0 until w) {
                val srcCol = col + overlapOut
                if (srcCol >= tileOut) break
                val idx = srcRowBase + srcCol * 3
                val r: Int
                val g: Int
                val b: Int
                if (lut != null) {
                    r = lut[bytes[idx].toInt() and 0xFF]
                    g = lut[bytes[idx + 1].toInt() and 0xFF]
                    b = lut[bytes[idx + 2].toInt() and 0xFF]
                } else {
                    r = (floats[idx].coerceIn(0f, 1f) * 255f).roundToInt()
                    g = (floats[idx + 1].coerceIn(0f, 1f) * 255f).roundToInt()
                    b = (floats[idx + 2].coerceIn(0f, 1f) * 255f).roundToInt()
                }
                band[dstRowBase + dstX0 + col] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
    }
}
