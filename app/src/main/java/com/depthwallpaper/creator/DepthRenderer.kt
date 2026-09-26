package com.depthwallpaper.creator

import android.content.Context
import android.content.res.AssetManager
import android.graphics.BlurMaskFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Porting nativo 1:1 del render() dell'editor (assets/js/app.js).
 *

 * Livelli: sfondo -> velo scuro -> orologio -> data -> soggetto ritagliato.
 *
 * Il PNG del soggetto conserva l'inquadratura completa della foto originale, quindi
 * disegnarlo con la STESSA geometria "cover" dello sfondo (scala/offset/rotazione)
 * lo rimette esattamente dov'era nella foto: sfondo e soggetto restano sempre
 * allineati, zoom e spostamenti li spostano insieme.
 */
object DepthRenderer {

    private const val EDITOR_REFERENCE_WIDTH = 1080f

    /** Scala dei testi/pioggia rispetto alla larghezza di riferimento dell'editor. */
    fun scaleFactor(width: Int, scaleReferenceWidth: Int = width): Float {
        val ref = if (scaleReferenceWidth > 0) scaleReferenceWidth.toFloat() else width.toFloat()
        return ref / EDITOR_REFERENCE_WIDTH
    }

    /** Disegna tutta la scena, senza gli effetti meteo (sfondo, velo, testi, soggetto). */
    fun renderScene(
        canvas: Canvas,
        width: Int,
        height: Int,
        config: WallpaperConfig,
        bg: Bitmap?,
        fg: Bitmap?,
        /**
         * Larghezza (px) su cui calcolare la scala dei testi. Normalmente e' la
         * larghezza dello SCHERMO: la superficie di un live wallpaper puo' essere
         * piu' larga (launcher con sfondo scorrevole) e usarla renderebbe i testi
         * di una dimensione diversa da quella vista nell'anteprima.
         */
        scaleReferenceWidth: Int = width
    ) {
        val w = width.toFloat()
        val h = height.toFloat()
        val k = scaleFactor(width, scaleReferenceWidth)

        canvas.drawColor(Color.BLACK)

        if (bg != null) {
            drawCover(canvas, bg, w, h, config.bgScale, config.bgOffX, config.bgOffY, config.bgRotation)
        }

        if (config.bgDim > 0f) {
            val paint = Paint()
            paint.color = Color.argb((config.bgDim / 100f * 0.75f * 255f).toInt(), 0, 0, 0)
            canvas.drawRect(0f, 0f, w, h, paint)
        }

        if (config.clock.enabled) {
            drawClockLayer(canvas, w, h, k, config.clock, pass = "back")
        }

        if (config.date.enabled) {
            drawTextLayer(canvas, w, h, k, config.date.style, dateText(config.date), multiline = false)
        }

        if (fg != null) {
            drawCover(canvas, fg, w, h, config.bgScale, config.bgOffX, config.bgOffY, config.bgRotation)
        }

        if (config.clock.enabled) {
            drawClockLayer(canvas, w, h, k, config.clock, pass = "front")
        }
    }

    /**
     * Disegna l'orologio. Se non e' impostato uno stile separato per ore/minuti
     * (o l'orologio e' in modalita' "testo personalizzato", dove il concetto di
     * ore/minuti non esiste), il comportamento e' quello di sempre: un unico
     * livello, disegnato nel passaggio "back" (sotto al soggetto ritagliato).
     *
     * Con lo stile separato attivo, ore e minuti diventano due disegni
     * indipendenti (stesso font/dimensione/tracking/contorno/alone/ombra, presi
     * dallo stile base, ma colore, grassetto e passaggio propri): condividono
     * sempre la stessa posizione/rotazione (x/y/rotation dello style base),
     * quindi viaggiano sempre insieme rispetto al soggetto ritagliato e non
     * possono essere trascinati o posizionati singolarmente, ma ciascuno puo'
     * stare per conto suo sopra o sotto al soggetto ritagliato
     * (split.hourLayer / split.minuteLayer). split.arrangement sceglie invece
     * la disposizione RECIPROCA: "horizontal" (default) affianca ore e minuti
     * sulla stessa riga; "vertical" mette le ore sulla riga sopra e i minuti
     * su quella sotto (distanza regolabile con split.verticalGap), senza i due
     * punti centrali (non necessari: le due righe sono gia' visivamente
     * separate).
     */
    private fun drawClockLayer(canvas: Canvas, w: Float, h: Float, k: Float, clock: ClockConfig, pass: String) {
        val text = clockText(clock)
        val split = clock.splitStyle
        // La disposizione (orizzontale/verticale) e' indipendente dalla gestione
        // separata di colore/grassetto/posizione: si puo' avere ore-sopra-
        // minuti-sotto anche con stile identico per entrambi, senza dover
        // attivare "Colore/grassetto/posizione separati".
        val verticalArrangement = split != null && split.arrangement == "vertical" && clock.mode != "custom"
        val splitStyleActive = split != null && split.enabled && clock.mode != "custom"

        if (!splitStyleActive && !verticalArrangement) {
            if (pass == "back") {
                drawTextLayer(canvas, w, h, k, clock.style, text, multiline = clock.mode == "custom", dotsForColon = clock.centerDots)
            }
            return
        }

        // Sottostringa "ore" isolata con un pattern dedicato (serve solo a
        // misurarne la larghezza esatta): H puo' avere 1 o 2 cifre a seconda
        // dell'ora corrente, mentre HH ne ha sempre 2.
        val hourPattern = if (clock.format == "24short") "H" else "HH"
        val hourPart = try {
            SimpleDateFormat(hourPattern, Locale.getDefault()).format(Date())
        } catch (e: Exception) {
            ""
        }

        if (verticalArrangement) {
            // Ore sopra, minuti sotto: due righe fisse (niente ":" ne' a-capo
            // automatico), sempre disegnate come un unico blocco che si trascina
            // e si posiziona solo insieme (vedi drawTextLayer/stackedLines sopra).
            // Colore/grassetto per riga e la scelta sopra/sotto il soggetto
            // restano quelli unificati dello stile base finche' "separati" non
            // e' attivo: in quel caso entrambe le righe stanno sempre sullo
            // stesso passaggio ("back"), esattamente come l'orologio normale.
            val hourLayerPass = if (splitStyleActive) split!!.hourLayer else "back"
            val minuteLayerPass = if (splitStyleActive) split!!.minuteLayer else "back"
            val drawHour = hourLayerPass == pass
            val drawMinute = minuteLayerPass == pass
            if (!drawHour && !drawMinute) return

            val minutePart = try {
                SimpleDateFormat("mm", Locale.getDefault()).format(Date())
            } catch (e: Exception) {
                ""
            }
            val stackedLines = listOf(hourPart, minutePart)
            if (drawHour) {
                drawTextLayer(
                    canvas, w, h, k, clock.style, text, multiline = false, dotsForColon = false,
                    splitSide = "top",
                    colorOverride = if (splitStyleActive) split!!.hourColor else null,
                    boldOverride = if (splitStyleActive) split!!.hourBold else null,
                    stackedLines = stackedLines, gapPercent = split?.verticalGap ?: 100f
                )
            }
            if (drawMinute) {
                drawTextLayer(
                    canvas, w, h, k, clock.style, text, multiline = false, dotsForColon = false,
                    splitSide = "bottom",
                    colorOverride = if (splitStyleActive) split!!.minuteColor else null,
                    boldOverride = if (splitStyleActive) split!!.minuteBold else null,
                    stackedLines = stackedLines, gapPercent = split?.verticalGap ?: 100f
                )
            }
            return
        }

        // Disposizione orizzontale con colore/grassetto/posizione separati.
        split!!
        val drawHour = split.hourLayer == pass
        val drawMinute = split.minuteLayer == pass
        if (!drawHour && !drawMinute) return

        if (drawHour) {
            drawTextLayer(
                canvas, w, h, k, clock.style, text, multiline = false, dotsForColon = clock.centerDots,
                splitAt = hourPart, splitSide = "before",
                colorOverride = split.hourColor, boldOverride = split.hourBold
            )
        }
        if (drawMinute) {
            drawTextLayer(
                canvas, w, h, k, clock.style, text, multiline = false, dotsForColon = clock.centerDots,
                splitAt = hourPart, splitSide = "after",
                colorOverride = split.minuteColor, boldOverride = split.minuteBold
            )
        }
    }

    // -------------------------------------------------------------------------------
    // Immagini
    // -------------------------------------------------------------------------------
    private fun drawCover(
        canvas: Canvas,
        bmp: Bitmap,
        rectW: Float,
        rectH: Float,
        scale: Float,
        offXFrac: Float,
        offYFrac: Float,
        rotationDeg: Float
    ) {
        if (bmp.width <= 0 || bmp.height <= 0) return
        val base = maxOf(rectW / bmp.width.toFloat(), rectH / bmp.height.toFloat())
        val s = base * (if (scale <= 0f) 1f else scale)
        val drawW = bmp.width * s
        val drawH = bmp.height * s

        val cx = rectW / 2f + offXFrac * rectW * 0.5f
        val cy = rectH / 2f + offYFrac * rectH * 0.5f

        canvas.save()
        canvas.translate(cx, cy)
        if (rotationDeg != 0f) canvas.rotate(rotationDeg)
        val dst = RectF(-drawW / 2f, -drawH / 2f, drawW / 2f, drawH / 2f)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        canvas.drawBitmap(bmp, null, dst, paint)
        canvas.restore()
    }

    // -------------------------------------------------------------------------------
    // Testo
    // -------------------------------------------------------------------------------
    /**
     * Font inclusi in assets/fonts: le chiavi devono restare identiche a quelle
     * dell'editor (FONTS in assets/js/app.js). Per ogni famiglia il file "bold"
     * e' opzionale: se manca, il grassetto viene sintetizzato da Android.
     */
    // "oswald" e "bigShoulders" puntano a file chiamati "-Regular.ttf" per non
    // toccare le chiavi gia' salvate nelle configurazioni, ma il contenuto e'
    // stato sostituito con il peso ExtraLight: al peso normale risultavano
    // troppo larghi.
    private val BUNDLED_FONTS: Map<String, Pair<String, String?>> = mapOf(
        "bebas" to Pair("fonts/BebasNeue-Regular.ttf", null),
        "anton" to Pair("fonts/Anton-Regular.ttf", null),
        "fjalla" to Pair("fonts/FjallaOne-Regular.ttf", null),
        "staatliches" to Pair("fonts/Staatliches-Regular.ttf", null),
        "wireOne" to Pair("fonts/WireOne-Regular.ttf", null),
        "oswald" to Pair("fonts/Oswald-Regular.ttf", "fonts/Oswald-Bold.ttf"),
        "oswaldLight" to Pair("fonts/Oswald-Light.ttf", null),
        "bigShoulders" to Pair("fonts/BigShoulders-Regular.ttf", "fonts/BigShoulders-Bold.ttf"),
        "bigShouldersBlack" to Pair("fonts/BigShoulders-Black.ttf", null),
        // --- font acquistati dall'utente ---
        "diosaRubia" to Pair("fonts/DiosaRubia-Light.ttf", null),
        "tightenCaps" to Pair("fonts/TightenCaps-ExtraLight.otf", null),
        "skyscraper" to Pair("fonts/Skyscraper-Condensed.ttf", null),
        "sensationalSans" to Pair("fonts/SensationalSans-Light.ttf", null),
        "klorhine" to Pair("fonts/Klorhine-Regular.otf", null),
        "raptors" to Pair("fonts/Raptors.otf", null),
        // ATTENZIONE: file demo (uso personale) - vedi nota di licenza in style.css.
        "calcio" to Pair("fonts/Calcio-Demo.ttf", null)
    )

    private var assetManager: AssetManager? = null
    private val typefaceCache = HashMap<String, Typeface>()

    /**
     * Va chiamato una volta prima del primo render (vedi DepthWallpaperService):
     * senza AssetManager i font inclusi ricadono sul sans-serif di sistema.
     */
    fun attach(context: Context) {
        if (assetManager == null) assetManager = context.applicationContext.assets
    }

    private fun bundledTypeface(path: String): Typeface? {
        typefaceCache[path]?.let { return it }
        val am = assetManager ?: return null
        return try {
            val tf = Typeface.createFromAsset(am, path)
            typefaceCache[path] = tf
            tf
        } catch (e: Throwable) {
            null
        }
    }

    private fun typefaceFor(fontKey: String, bold: Boolean, italic: Boolean): Typeface {
        val bundled = BUNDLED_FONTS[fontKey]
        if (bundled != null) {
            val path = if (bold && bundled.second != null) bundled.second!! else bundled.first
            val loaded = bundledTypeface(path)
            if (loaded != null) {
                // Se la famiglia ha gia' il file bold non serve il grassetto sintetico.
                val needsFakeBold = bold && bundled.second == null
                val style = when {
                    needsFakeBold && italic -> Typeface.BOLD_ITALIC
                    needsFakeBold -> Typeface.BOLD
                    italic -> Typeface.ITALIC
                    else -> Typeface.NORMAL
                }
                return if (style == Typeface.NORMAL) loaded else Typeface.create(loaded, style)
            }
        }

        // Le varianti Sans e "condensed" non sono piu' offerte dall'editor: le
        // configurazioni salvate in precedenza ricadono sul font rimasto piu' vicino.
        val family = when (fontKey) {
            "condensedLight", "condensed" -> "sans-serif-condensed-light"
            "smallcaps" -> "sans-serif-smallcaps"
            "serif" -> "serif"
            "monospace" -> "monospace"
            "cursive" -> "cursive"
            else -> "sans-serif"
        }
        val style = when {
            bold && italic -> Typeface.BOLD_ITALIC
            bold -> Typeface.BOLD
            italic -> Typeface.ITALIC
            else -> Typeface.NORMAL
        }
        return Typeface.create(family, style)
    }

    private fun parseColor(value: String, fallback: Int): Int =
        try { Color.parseColor(value) } catch (e: Exception) { fallback }

    private fun drawTextLayer(
        canvas: Canvas,
        w: Float,
        h: Float,
        k: Float,
        style: TextLayerConfig,
        text: String,
        multiline: Boolean,
        dotsForColon: Boolean = false,
        // --- stile separato ore/minuti (solo orologio, vedi drawClockLayer) ---
        // splitAt: la sottostringa "ore" isolata, usata solo per misurare dove
        // cade il confine tra ore e minuti nel testo completo gia' composto.
        // splitSide: "before" disegna (con clip) solo la parte fino al confine
        // (le ore), "after" solo quella dopo (i minuti). null = nessun taglio,
        // comportamento di sempre.
        splitAt: String? = null,
        splitSide: String? = null,
        colorOverride: String? = null,
        boldOverride: Boolean? = null,
        // stackedLines: usato solo dalla disposizione verticale dello stile
        // separato ore/minuti (vedi drawClockLayer). Quando presente e' una
        // lista di ESATTAMENTE due righe fisse, ore e minuti: sostituisce il
        // normale calcolo delle righe (niente a-capo automatico) e va usato
        // insieme a splitSide "top"/"bottom" per isolare, con un ritaglio
        // verticale, solo la riga di competenza di questa chiamata. Le due
        // chiamate (ore/minuti) misurano comunque ENTRAMBE le righe per restare
        // centrate come un unico blocco, esattamente come gia' avviene per la
        // disposizione orizzontale (splitAt/"before"/"after"): ore e minuti
        // restano cosi' sempre un solo riquadro, spostabile solo insieme.
        stackedLines: List<String>? = null,
        // gapPercent: solo con stackedLines, 0..100 per lo slider "Spaziatura
        // verticale" dello stile separato. 100 = spaziatura normale (invariata),
        // 0 = ore e minuti accostati fino a toccarsi, senza sovrapporsi ne'
        // tagliare i caratteri: il valore intermedio interpola tra l'altezza
        // reale del testo (misurata con getTextBounds, quindi valida per
        // qualunque font/dimensione) e l'altezza di riga normale. Specchio di
        // app.js.
        gapPercent: Float = 100f
    ) {
        if (text.isEmpty()) return
        var sizePx = style.size * k
        if (sizePx <= 0f) return

        var tracking = style.tracking * k
        val sx = if (style.stretchX <= 0f) 1f else style.stretchX
        val sy = if (style.stretchY <= 0f) 1f else style.stretchY
        val alpha = style.opacity.coerceIn(0f, 1f)
        val effectiveBold = boldOverride ?: style.bold
        val effectiveColor = colorOverride ?: style.color

        val base = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        base.typeface = typefaceFor(style.fontKey, effectiveBold, style.italic)
        base.textSize = sizePx

        // Adattamento automatico su una riga (specchio della stessa logica nell'editor
        // in assets/js/app.js): il motore di testo di Android puo' misurare lo stesso
        // font a parita' di "size" con una larghezza diversa da quella di WebView. Se il
        // testo naturale sfora il canvas lo restringiamo qui in proporzione, cosi' il
        // risultato reale sul dispositivo resta coerente con l'anteprima dell'editor.
        var effK = k
        if (!multiline && stackedLines == null) {
            val naturalW = measureTracked(base, text, tracking, dotsForColon) * sx
            val maxAllowed = w * 0.94f
            if (naturalW > maxAllowed && naturalW > 0f) {
                val fit = maxAllowed / naturalW
                sizePx *= fit
                tracking *= fit
                effK *= fit
                base.textSize = sizePx
            }
        }

        val lines: List<String> = when {
            stackedLines != null -> stackedLines
            multiline -> wrapLines(base, text, (w * 0.92f) / sx, tracking, dotsForColon)
            else -> listOf(text)
        }
        val normalLineHeight = sizePx * 1.12f
        var lineHeight = normalLineHeight
        if (stackedLines != null) {
            // Altezza minima ("toccano completamente"): l'altezza reale delle
            // cifre per il font/dimensione correnti, cosi' le due righe si
            // accostano fino a sfiorarsi senza mai tagliare i caratteri (il
            // ritaglio verticale sopra usa esattamente questa altezza come
            // banda per riga).
            var tightHeight = normalLineHeight
            try {
                val rect = Rect()
                base.getTextBounds("0123456789", 0, 10, rect)
                val measured = rect.height().toFloat()
                if (measured > 0f) tightHeight = minOf(normalLineHeight, measured)
            } catch (e: Exception) { /* fallback gia' impostato su normalLineHeight */ }
            val t = gapPercent.coerceIn(0f, 100f) / 100f
            lineHeight = tightHeight + t * (normalLineHeight - tightHeight)
        }
        val firstY = -(lines.size - 1) * lineHeight / 2f

        canvas.save()
        canvas.translate(style.x * w, style.y * h)
        if (style.rotation != 0f) canvas.rotate(style.rotation)
        canvas.scale(sx, sy)

        var shadowPending = style.shadowOpacity > 0f

        // Larghezza massima tra le righe: serve sia al pannello dietro sia al
        // gradiente del riempimento (calcolata una sola volta).
        var maxLineWidth = 0f
        for (line in lines) maxLineWidth = maxOf(maxLineWidth, measureTracked(base, line, tracking, dotsForColon))

        if (stackedLines != null && splitSide != null) {
            // Ritaglio verticale ore-sopra/minuti-sotto: stesso principio del
            // ritaglio orizzontale sotto, ma isola una RIGA (indice 0 = ore, 1 =
            // minuti) invece di una porzione di larghezza. Il blocco resta
            // comunque centrato su entrambe le righe insieme (maxLineWidth sopra
            // tiene conto di entrambe), quindi le due chiamate (ore/minuti)
            // restano perfettamente allineate come un unico riquadro.
            val idx = if (splitSide == "top") 0 else 1
            val bandTop = firstY + (idx - 0.5f) * lineHeight
            val bandBottom = bandTop + lineHeight
            val bigW = maxLineWidth + sizePx * 4f + w // ampio margine: mai il fattore limitante
            canvas.clipRect(-bigW, bandTop, bigW, bandBottom)
        } else if (splitAt != null && splitSide != null && !multiline) {
            // Ritaglio orizzontale ore-sinistra/minuti-destra: il testo e' centrato
            // su x=0 in questo spazio locale, quindi il bordo sinistro cade a
            // -maxLineWidth/2. Misurando la sola sottostringa "ore" con lo stesso
            // paint/tracking (gia' post-adattamento automatico) si trova il
            // confine esatto, coerente carattere per carattere con l'unico
            // disegno che avverrebbe senza divisione.
            val hourW = measureTracked(base, splitAt, tracking, dotsForColon)
            val boundaryX = -maxLineWidth / 2f + hourW
            val top = firstY - lineHeight
            val bottom = firstY + (lines.size) * lineHeight
            if (splitSide == "before") {
                canvas.clipRect(-maxLineWidth, top, boundaryX, bottom)
            } else {
                canvas.clipRect(boundaryX, top, maxLineWidth, bottom)
            }
        }

        // --- pannello dietro al testo ---
        if (style.plateOpacity > 0f) {
            val maxW = maxLineWidth
            val padX = sizePx * 0.32f
            val padY = sizePx * 0.22f
            val rect = RectF(
                -maxW / 2f - padX,
                firstY - lineHeight / 2f - padY,
                maxW / 2f + padX,
                firstY + (lines.size - 1) * lineHeight + lineHeight / 2f + padY
            )
            val platePaint = Paint(Paint.ANTI_ALIAS_FLAG)
            platePaint.color = parseColor(style.plateColor, Color.BLACK)
            platePaint.alpha = (style.plateOpacity.coerceIn(0f, 1f) * alpha * 255).toInt()
            if (shadowPending) {
                platePaint.setShadowLayer(
                    style.shadowBlur * effK, 0f, style.shadowOffsetY * effK,
                    Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0)
                )
                shadowPending = false
            }
            canvas.drawRoundRect(rect, sizePx * 0.28f, sizePx * 0.28f, platePaint)
        }

        // --- alone morbido ---
        if (style.glowWidth > 0f) {
            val glowPath = buildTrackedPath(base, lines, firstY, lineHeight, tracking, dotsForColon)
            val glow = Paint(base)
            glow.style = Paint.Style.STROKE
            glow.strokeJoin = Paint.Join.ROUND
            glow.strokeCap = Paint.Cap.ROUND
            glow.strokeWidth = style.glowWidth * effK * 2f
            glow.color = parseColor(style.glowColor, Color.BLACK)
            glow.alpha = (alpha * 255).toInt()
            try {
                glow.maskFilter = BlurMaskFilter(maxOf(1f, style.glowWidth * effK), BlurMaskFilter.Blur.NORMAL)
            } catch (e: Throwable) {
                // dispositivi senza supporto: resta un contorno netto
            }
            canvas.drawPath(glowPath, glow)
        }

        // --- contorno netto ---
        if (style.outlineWidth > 0f) {
            if (shadowPending) {
                drawUnifiedShadow(
                    canvas, base, lines, firstY, lineHeight, tracking,
                    Paint.Style.STROKE, style.outlineWidth * effK * 2f,
                    Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0),
                    style.shadowBlur * effK, style.shadowOffsetY * effK, dotsForColon
                )
                shadowPending = false
            }
            val outline = Paint(base)
            outline.style = Paint.Style.STROKE
            outline.strokeJoin = Paint.Join.ROUND
            outline.strokeCap = Paint.Cap.ROUND
            outline.strokeWidth = style.outlineWidth * effK * 2f
            outline.color = parseColor(style.outlineColor, Color.BLACK)
            outline.alpha = (alpha * 255).toInt()
            drawLines(canvas, outline, lines, firstY, lineHeight, tracking, dotsForColon)
        }

        // --- riempimento ---
        if (shadowPending) {
            drawUnifiedShadow(
                canvas, base, lines, firstY, lineHeight, tracking,
                Paint.Style.FILL, 0f,
                Color.argb((style.shadowOpacity.coerceIn(0f, 1f) * 255).toInt(), 0, 0, 0),
                style.shadowBlur * effK, style.shadowOffsetY * effK, dotsForColon
            )
            shadowPending = false
        }
        val fill = Paint(base)
        fill.style = Paint.Style.FILL
        fill.color = parseColor(effectiveColor, Color.WHITE)
        fill.alpha = (alpha * 255).toInt()
        if (style.gradient && maxLineWidth > 0f) {
            val dir = style.gradientDirection
            if (dir == "vertical" || dir == "fadeDown") {
                val top = firstY - lineHeight / 2f
                val bottom = firstY + (lines.size - 1) * lineHeight + lineHeight / 2f
                val startColor = parseColor(effectiveColor, Color.WHITE)
                if (dir == "fadeDown") {
                    // "fadeDown": la trasparenza cresce dall'alto verso il basso.
                    // gradientFadeOpacity (0..1) e' la quantita' di trasparenza voluta:
                    //  - 0 => dissolvenza minima, il testo resta quasi del tutto opaco;
                    //  - 1 => la meta' inferiore del testo e' completamente trasparente.
                    // Resta sempre un'unica sfumatura continua, senza stacchi netti.
                    val t = style.gradientFadeOpacity.coerceIn(0f, 1f)
                    val fadeTop = (1f - t).coerceIn(0f, 1f)
                    var fadeBottom = (1f - t * 0.5f).coerceIn(0f, 1f)
                    if (fadeBottom <= fadeTop) fadeBottom = (fadeTop + 0.001f).coerceAtMost(1f)
                    val transparentColor = startColor and 0x00FFFFFF
                    val positions = mutableListOf(0f)
                    val colors = mutableListOf(startColor)
                    if (fadeTop > 0f) {
                        positions.add(fadeTop)
                        colors.add(startColor)
                    }
                    positions.add(fadeBottom)
                    colors.add(transparentColor)
                    if (fadeBottom < 1f) {
                        positions.add(1f)
                        colors.add(transparentColor)
                    }
                    fill.shader = LinearGradient(
                        0f, top, 0f, bottom,
                        colors.toIntArray(), positions.toFloatArray(),
                        Shader.TileMode.CLAMP
                    )
                } else {
                    val endColor = parseColor(style.color2, Color.WHITE)
                    fill.shader = LinearGradient(
                        0f, top, 0f, bottom,
                        startColor, endColor,
                        Shader.TileMode.CLAMP
                    )
                }
            } else {
                val half = maxLineWidth / 2f
                fill.shader = LinearGradient(
                    -half, 0f, half, 0f,
                    parseColor(effectiveColor, Color.WHITE),
                    parseColor(style.color2, Color.WHITE),
                    Shader.TileMode.CLAMP
                )
            }
        }
        drawLines(canvas, fill, lines, firstY, lineHeight, tracking, dotsForColon)

        canvas.restore()
    }

    // --- puntini centrali (":") -----------------------------------------------------
    // Il ':' non e' mai un vero glifo del font: se dotsForColon e' attivo viene sempre
    // sostituito da due cerchi disegnati a parte, cosi' il risultato e' identico su
    // qualunque font (molti "digital" non hanno un glifo ':' gradevole). Le proporzioni
    // sono ricavate dalla larghezza della cifra "0" cosi' restano coerenti a qualunque
    // dimensione/font, in linea con l'editor in assets/js/app.js.
    private fun dotSlotWidth(paint: Paint): Float = paint.measureText("0") * 0.85f
    private fun dotRadius(paint: Paint): Float = paint.measureText("0") * 0.16f
    private fun dotOffset(paint: Paint): Float = paint.measureText("0") * 0.30f

    // I puntini vanno centrati sul centro OTTICO della cifra (es. "0"), non sulla
    // baseline: le cifre stanno sopra la baseline, quindi centrarli sulla baseline
    // li fa apparire troppo in basso. getTextBounds da' il bounding box reale della
    // cifra rispetto alla baseline (top negativo = sopra), il cui punto medio e'
    // l'offset verticale da sommare a baselineY per trovare il vero centro cifra.
    private val digitBoundsRect = Rect()
    private fun digitCenterOffset(paint: Paint): Float {
        paint.getTextBounds("0", 0, 1, digitBoundsRect)
        return (digitBoundsRect.top + digitBoundsRect.bottom) / 2f
    }

    private fun drawLines(
        canvas: Canvas,
        paint: Paint,
        lines: List<String>,
        firstY: Float,
        lineHeight: Float,
        tracking: Float,
        dotsForColon: Boolean = false
    ) {
        var y = firstY
        for (line in lines) {
            drawTracked(canvas, paint, line, y, tracking, dotsForColon)
            y += lineHeight
        }
    }

    /** Disegna il testo centrato in (0, y), con spaziatura personalizzata tra le lettere. */
    private fun drawTracked(
        canvas: Canvas,
        paint: Paint,
        text: String,
        y: Float,
        tracking: Float,
        dotsForColon: Boolean = false
    ) {
        val metrics = paint.fontMetrics
        val baselineY = y - (metrics.ascent + metrics.descent) / 2f
        val hasMarker = dotsForColon && text.contains(':')

        if (tracking == 0f && !hasMarker) {
            paint.textAlign = Paint.Align.CENTER
            canvas.drawText(text, 0f, baselineY, paint)
            return
        }

        paint.textAlign = Paint.Align.LEFT
        var x = -measureTracked(paint, text, tracking, dotsForColon) / 2f
        for (ch in text) {
            if (hasMarker && ch == ':') {
                val slot = dotSlotWidth(paint)
                val cx = x + slot / 2f
                val r = dotRadius(paint)
                val off = dotOffset(paint)
                val centerY = baselineY + digitCenterOffset(paint)
                canvas.drawCircle(cx, centerY - off, r, paint)
                canvas.drawCircle(cx, centerY + off, r, paint)
                x += slot + tracking
            } else {
                val s = ch.toString()
                canvas.drawText(s, x, baselineY, paint)
                x += paint.measureText(s) + tracking
            }
        }
    }

    private fun measureTracked(paint: Paint, text: String, tracking: Float, dotsForColon: Boolean = false): Float {
        if (text.isEmpty()) return 0f
        val hasMarker = dotsForColon && text.contains(':')
        if (tracking == 0f && !hasMarker) return paint.measureText(text)
        var total = 0f
        for (ch in text) {
            total += if (hasMarker && ch == ':') dotSlotWidth(paint) else paint.measureText(ch.toString())
        }
        return total + tracking * (text.length - 1)
    }

    /** Sagoma UNICA (tutte le righe/lettere unite in un solo Path) del testo con
     *  spaziatura: serve a proiettare l'ombra/alone in un solo colpo invece che
     *  lettera per lettera, perche' con la spaziatura attiva l'ombra per-carattere
     *  si sovrapponeva tra le lettere sommandosi e creando un alone molto piu'
     *  grande e visibile del previsto (specie evidente con il riempimento a
     *  gradiente). Specchio di buildTrackedPath in assets/js/app.js. */
    private fun buildTrackedPath(
        paint: Paint,
        lines: List<String>,
        firstY: Float,
        lineHeight: Float,
        tracking: Float,
        dotsForColon: Boolean = false
    ): Path {
        val path = Path()
        var y = firstY
        val metrics = paint.fontMetrics
        for (line in lines) {
            val baselineY = y - (metrics.ascent + metrics.descent) / 2f
            val hasMarker = dotsForColon && line.contains(':')
            if (tracking == 0f && !hasMarker) {
                paint.textAlign = Paint.Align.CENTER
                val glyphPath = Path()
                paint.getTextPath(line, 0, line.length, 0f, baselineY, glyphPath)
                path.addPath(glyphPath)
            } else {
                paint.textAlign = Paint.Align.LEFT
                var x = -measureTracked(paint, line, tracking, dotsForColon) / 2f
                for (ch in line) {
                    if (hasMarker && ch == ':') {
                        val slot = dotSlotWidth(paint)
                        val cx = x + slot / 2f
                        val r = dotRadius(paint)
                        val off = dotOffset(paint)
                        val centerY = baselineY + digitCenterOffset(paint)
                        path.addCircle(cx, centerY - off, r, Path.Direction.CW)
                        path.addCircle(cx, centerY + off, r, Path.Direction.CW)
                        x += slot + tracking
                    } else {
                        val s = ch.toString()
                        val chPath = Path()
                        paint.getTextPath(s, 0, s.length, x, baselineY, chPath)
                        path.addPath(chPath)
                        x += paint.measureText(s) + tracking
                    }
                }
            }
            y += lineHeight
        }
        return path
    }

    /** Proietta un'ombra unica dietro a tutta la scritta: disegna la sagoma unita
     *  con una sorgente quasi invisibile e l'ombra attiva, cosi' resta visibile
     *  solo l'ombra sfocata (non la forma stessa). */
    private fun drawUnifiedShadow(
        canvas: Canvas, base: Paint, lines: List<String>, firstY: Float, lineHeight: Float,
        tracking: Float, style: Paint.Style, strokeWidth: Float,
        shadowColor: Int, shadowBlur: Float, shadowOffsetY: Float, dotsForColon: Boolean = false
    ) {
        val path = buildTrackedPath(base, lines, firstY, lineHeight, tracking, dotsForColon)
        val paint = Paint(base)
        paint.style = style
        if (style == Paint.Style.STROKE) {
            paint.strokeWidth = strokeWidth
            paint.strokeJoin = Paint.Join.ROUND
            paint.strokeCap = Paint.Cap.ROUND
        }
        paint.color = Color.BLACK
        paint.alpha = 1 // sorgente quasi invisibile: serve solo a proiettare l'ombra
        paint.setShadowLayer(shadowBlur, 0f, shadowOffsetY, shadowColor)
        canvas.drawPath(path, paint)
    }

    private fun wrapLines(
        paint: Paint,
        text: String,
        maxWidth: Float,
        tracking: Float,
        dotsForColon: Boolean = false
    ): List<String> {
        val result = mutableListOf<String>()
        for (rawLine in text.split("\n")) {
            val words = rawLine.split(" ")
            var current = ""
            for (word in words) {
                val test = if (current.isEmpty()) word else "$current $word"
                if (measureTracked(paint, test, tracking, dotsForColon) > maxWidth && current.isNotEmpty()) {
                    result.add(current)
                    current = word
                } else {
                    current = test
                }
            }
            result.add(current)
        }
        return result
    }

    // -------------------------------------------------------------------------------
    // Contenuti dinamici
    // -------------------------------------------------------------------------------
    private fun clockText(clock: ClockConfig): String {
        if (clock.mode == "custom") return clock.customText.ifBlank { "Il tuo testo" }
        // Ore e minuti attaccati, senza alcun separatore, a meno che i "puntini
        // centrali" non siano attivi: in quel caso si inserisce un ':' letterale
        // (tra apici singoli nel pattern) che drawTextLayer riconosce come segnaposto
        // per i due puntini disegnati a parte, invece che come glifo del font.
        // Deve restare identico all'editor in assets/js/app.js.
        val sep = if (clock.centerDots) "':'" else ""
        val pattern = if (clock.format == "24short") "H${sep}mm" else "HH${sep}mm"
        return try {
            SimpleDateFormat(pattern, Locale.getDefault()).format(Date())
        } catch (e: Exception) {
            ""
        }
    }

    private fun dateText(date: DateConfig): String {
        val pattern = when (date.format) {
            "fullYear" -> "EEEE d MMMM yyyy"
            "dayMonth" -> "d MMMM"
            "short" -> "EEE d MMM"
            "numeric" -> "dd/MM/yyyy"
            "weekday" -> "EEEE"
            else -> "EEEE d MMMM"
        }
        val locale = Locale.getDefault()
        val text = try {
            SimpleDateFormat(pattern, locale).format(Calendar.getInstance().time)
        } catch (e: Exception) {
            ""
        }
        return if (date.uppercase) text.uppercase(locale)
        else text.replaceFirstChar { c -> c.titlecase(locale) }
    }
}
