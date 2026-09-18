package com.depthwallpaper.creator

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import org.tensorflow.lite.Interpreter
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
 * "Upscaling AI" della foto intera: Real-ESRGAN-General-x4v3 (TFLite, BSD-3-Clause,
 * https://huggingface.co/qualcomm/Real-ESRGAN-General-x4v3), scelto perché pensato
 * apposta per foto reali imperfette (blur/rumore/compressione), non per disegni.
 * Gira 100% on-device: nessun upload, nessun permesso Internet richiesto.
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

    private const val MODEL_PATH = "models/realesrgan-x4v3.tflite"

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

    private var interpreter: Interpreter? = null
    private var nnApiDelegate: NnApiDelegate? = null
    private var tileIn = 128
    private var tileOut = 512
    private var scale = 4

    class UnavailableException(message: String) : Exception(message)

    @Synchronized
    private fun ensureInterpreter(context: Context): Interpreter {
        interpreter?.let { return it }

        val modelBuffer = try {
            loadModelFile(context)
        } catch (e: Exception) {
            throw UnavailableException("Modello di upscaling non trovato nell'app")
        }

        val options = Interpreter.Options().apply { setNumThreads(max(2, Runtime.getRuntime().availableProcessors())) }

        // Su NPU/DSP e' molto piu' veloce: si tenta il delegate NNAPI (Android 8.1+) e,
        // se il dispositivo/driver non lo supporta bene, si ricade in automatico sulla CPU.
        var built: Interpreter? = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                val delegate = NnApiDelegate()
                val nnOptions = Interpreter.Options().apply {
                    setNumThreads(max(2, Runtime.getRuntime().availableProcessors()))
                    addDelegate(delegate)
                }
                built = Interpreter(modelBuffer, nnOptions)
                nnApiDelegate = delegate
            } catch (e: Throwable) {
                nnApiDelegate?.close()
                nnApiDelegate = null
                built = null
            }
        }
        val interp = built ?: Interpreter(modelBuffer, options)

        val inShape = interp.getInputTensor(0).shape() // [1, H, W, 3]
        val outShape = interp.getOutputTensor(0).shape() // [1, H*scale, W*scale, 3]
        if (inShape.size == 4 && outShape.size == 4 && inShape[1] > 0 && outShape[1] > 0) {
            tileIn = inShape[1]
            tileOut = outShape[1]
            scale = max(1, tileOut / tileIn)
        }

        interpreter = interp
        return interp
    }

    private fun loadModelFile(context: Context): MappedByteBuffer {
        val afd = context.assets.openFd(MODEL_PATH)
        afd.use { fd ->
            val inputStream = fd.createInputStream()
            inputStream.use { stream ->
                val channel = stream.channel
                return channel.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength)
            }
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
    fun plannedInputLongSide(context: Context, targetLongSide: Int): Int {
        val s = try {
            ensureInterpreter(context)
            scale
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
     * una foto intera richiede da qualche secondo (NPU) a decine di secondi (solo CPU)
     * a seconda del dispositivo.
     *
     * @param targetLongSide lato lungo desiderato del risultato; se <= 0 si ricade sul
     *        vecchio comportamento (dedotto dalla sorgente ricevuta).
     * @param onProgress richiamato dopo ogni tile con l'avanzamento REALE (0f..1f).
     */
    fun upscale(
        context: Context,
        src: Bitmap,
        targetLongSide: Int = 0,
        onProgress: ((Float) -> Unit)? = null
    ): Bitmap {
        val interp = ensureInterpreter(context)

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
        val tileFloats = FloatArray(tileOut * tileOut * 3)

        val inputBuffer = ByteBuffer.allocateDirect(tileIn * tileIn * 3 * 4).order(ByteOrder.nativeOrder())
        val outputBuffer = ByteBuffer.allocateDirect(tileOut * tileOut * 3 * 4).order(ByteOrder.nativeOrder())

        // Prima riga di output non ancora consumata: l'ultima banda e' allineata al bordo
        // inferiore e quindi si sovrappone alla precedente, le righe gia' emesse si saltano.
        var nextOutRow = 0

        for (cy in ys) {
            val bandY0 = cy * scale
            val bandH = min(coreOut, outH - bandY0)
            if (bandH <= 0) continue

            for (cx in xs) {
                fillInputTile(inputBuffer, srcPixels, srcW, srcH, cx - overlap, cy - overlap, tileIn)
                outputBuffer.rewind()
                interp.run(inputBuffer, outputBuffer)
                writeTileCoreIntoBand(
                    outputBuffer, tileFloats, band, outW, bandH,
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

    /** Copia nel buffer di input (float32 normalizzato 0..1, NHWC) la finestra
     *  winX0..winX0+tile, con replica del bordo (clamp) per i pixel fuori immagine. */
    private fun fillInputTile(
        buffer: ByteBuffer, srcPixels: IntArray, srcW: Int, srcH: Int,
        winX0: Int, winY0: Int, tile: Int
    ) {
        buffer.rewind()
        for (row in 0 until tile) {
            val sy = (winY0 + row).coerceIn(0, srcH - 1)
            val rowBase = sy * srcW
            for (col in 0 until tile) {
                val sx = (winX0 + col).coerceIn(0, srcW - 1)
                val px = srcPixels[rowBase + sx]
                buffer.putFloat(((px shr 16) and 0xFF) / 255f) // R
                buffer.putFloat(((px shr 8) and 0xFF) / 255f)  // G
                buffer.putFloat((px and 0xFF) / 255f)          // B
            }
        }
        buffer.rewind()
    }

    /** Scarta la cornice di contesto dall'output della tile e incolla solo il "nucleo"
     *  nella banda corrente (alta esattamente quanto il nucleo di una riga di tile). */
    private fun writeTileCoreIntoBand(
        buffer: ByteBuffer, floats: FloatArray, band: IntArray,
        outW: Int, bandH: Int,
        tileOut: Int, overlapOut: Int, coreOut: Int, dstX0: Int
    ) {
        buffer.rewind()
        buffer.asFloatBuffer().get(floats)

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
                val r = (floats[idx].coerceIn(0f, 1f) * 255f).roundToInt()
                val g = (floats[idx + 1].coerceIn(0f, 1f) * 255f).roundToInt()
                val b = (floats[idx + 2].coerceIn(0f, 1f) * 255f).roundToInt()
                band[dstRowBase + dstX0 + col] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
    }
}
