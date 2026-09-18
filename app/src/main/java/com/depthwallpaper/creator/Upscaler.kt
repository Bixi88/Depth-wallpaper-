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
 */
object Upscaler {

    private const val MODEL_PATH = "models/realesrgan-x4v3.tflite"

    /** Contesto extra (in pixel, spazio sorgente) attorno al "nucleo" di ogni tile,
     *  scartato dopo l'inferenza per evitare cuciture visibili tra una tile e l'altra. */
    private const val OVERLAP = 8

    /** Lato lungo massimo del risultato: coerente con l'ordine di grandezza (~1750x3499)
     *  osservato negli asset di un'app di sfondi animati simile, pensato per coprire
     *  comodamente lo schermo durante il movimento del parallasse senza sprecare
     *  memoria/tempo su risoluzioni assurde. Oltre questo tetto si riduce in proporzione. */
    private const val SAFETY_MAX_LONG_SIDE = 3500

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
     * Esegue l'upscaling AI sull'intera foto e restituisce il bitmap risultante
     * (gia' ricondotto sotto il tetto di sicurezza). Va chiamata FUORI dal thread UI:
     * l'inferenza a tile su una foto intera richiede da qualche secondo (NPU) a
     * decine di secondi (solo CPU) a seconda del dispositivo.
     */
    fun upscale(context: Context, src: Bitmap): Bitmap {
        val interp = ensureInterpreter(context)

        val srcW = src.width
        val srcH = src.height
        val srcPixels = IntArray(srcW * srcH)
        src.getPixels(srcPixels, 0, srcW, 0, 0, srcW, srcH)

        val overlap = min(OVERLAP, (tileIn / 2) - 1).coerceAtLeast(0)
        val core = tileIn - 2 * overlap

        val xs = tileStarts(srcW, core)
        val ys = tileStarts(srcH, core)

        val outW = srcW * scale
        val outH = srcH * scale
        val outPixels = IntArray(outW * outH)

        val inputBuffer = ByteBuffer.allocateDirect(tileIn * tileIn * 3 * 4).order(ByteOrder.nativeOrder())
        val outputBuffer = ByteBuffer.allocateDirect(tileOut * tileOut * 3 * 4).order(ByteOrder.nativeOrder())

        for (cy in ys) {
            for (cx in xs) {
                fillInputTile(inputBuffer, srcPixels, srcW, srcH, cx - overlap, cy - overlap, tileIn)
                outputBuffer.rewind()
                interp.run(inputBuffer, outputBuffer)
                writeOutputCore(
                    outputBuffer, outPixels, outW, outH,
                    tileOut, overlap * scale, core * scale,
                    cx * scale, cy * scale
                )
            }
        }

        val full = Bitmap.createBitmap(outPixels, outW, outH, Bitmap.Config.ARGB_8888)
        return capToSafetySize(full)
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

    /** Scarta la cornice di contesto dall'output della tile e incolla solo il
     *  "nucleo" (coreOut x coreOut) nella posizione corretta dell'immagine finale. */
    private fun writeOutputCore(
        buffer: ByteBuffer, outPixels: IntArray, outW: Int, outH: Int,
        tileOut: Int, overlapOut: Int, coreOut: Int, dstX0: Int, dstY0: Int
    ) {
        buffer.rewind()
        val floats = FloatArray(tileOut * tileOut * 3)
        buffer.asFloatBuffer().get(floats)

        val h = min(coreOut, outH - dstY0)
        val w = min(coreOut, outW - dstX0)
        if (h <= 0 || w <= 0) return

        for (row in 0 until h) {
            val srcRow = row + overlapOut
            if (srcRow >= tileOut) break
            val dstRow = dstY0 + row
            if (dstRow >= outH) break
            val dstRowBase = dstRow * outW
            val srcRowBase = srcRow * tileOut * 3
            for (col in 0 until w) {
                val srcCol = col + overlapOut
                if (srcCol >= tileOut) break
                val idx = srcRowBase + srcCol * 3
                val r = (floats[idx].coerceIn(0f, 1f) * 255f).roundToInt()
                val g = (floats[idx + 1].coerceIn(0f, 1f) * 255f).roundToInt()
                val b = (floats[idx + 2].coerceIn(0f, 1f) * 255f).roundToInt()
                outPixels[dstRowBase + dstX0 + col] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
    }

    private fun capToSafetySize(bitmap: Bitmap): Bitmap {
        val long = max(bitmap.width, bitmap.height)
        if (long <= SAFETY_MAX_LONG_SIDE) return bitmap
        val f = SAFETY_MAX_LONG_SIDE.toFloat() / long
        val w = max(1, (bitmap.width * f).roundToInt())
        val h = max(1, (bitmap.height * f).roundToInt())
        val scaled = Bitmap.createScaledBitmap(bitmap, w, h, true)
        if (scaled !== bitmap) bitmap.recycle()
        return scaled
    }
}
