(function () {
  "use strict";

  // ===========================================================================
  // COSTANTI
  // ===========================================================================
  const CANVAS_W = 1080;
  // Altezza dell'anteprima: sostituita all'avvio con le proporzioni reali dello
  // schermo (vedi applyScreenAspect), cosi' anteprima, PNG esportato e sfondo
  // animato hanno esattamente la stessa inquadratura.
  let CANVAS_H = 1920;

  const FONTS = [
    { key: "sans", label: "Sans (Roboto)", css: "sans-serif" },
    { key: "condensedLight", label: "Condensed Light", css: "sans-serif-condensed-light, sans-serif-condensed, sans-serif" },
    { key: "smallcaps", label: "Maiuscoletto", css: "sans-serif-smallcaps, sans-serif" },
    { key: "serif", label: "Serif", css: "serif" },
    { key: "monospace", label: "Monospace", css: "monospace" },
    { key: "cursive", label: "Corsivo decorativo", css: "cursive" },
    // --- font inclusi nell'app (assets/fonts), identici nel renderer nativo ---
    { key: "bebas", label: "Bebas Neue", css: "'Bebas Neue', sans-serif", bundled: true },
    { key: "anton", label: "Anton", css: "'Anton', sans-serif", bundled: true },
    { key: "fjalla", label: "Fjalla One", css: "'Fjalla One', sans-serif", bundled: true },
    { key: "staatliches", label: "Staatliches", css: "'Staatliches', sans-serif", bundled: true },
    { key: "wireOne", label: "Wire One", css: "'Wire One', sans-serif", bundled: true },
    { key: "oswald", label: "Oswald", css: "'Oswald', sans-serif", bundled: true },
    { key: "oswaldLight", label: "Oswald Light", css: "'Oswald Light', sans-serif", bundled: true },
    { key: "bigShoulders", label: "Big Shoulders", css: "'Big Shoulders', sans-serif", bundled: true },
    { key: "bigShouldersBlack", label: "Big Shoulders Black", css: "'Big Shoulders Black', sans-serif", bundled: true },
    // --- font acquistati dall'utente ---
    { key: "diosaRubia", label: "Diosa Rubia", css: "'Diosa Rubia', sans-serif", bundled: true },
    { key: "tightenCaps", label: "Tighten Caps", css: "'Tighten Caps', sans-serif", bundled: true },
    { key: "skyscraper", label: "Skyscraper Condensed", css: "'Skyscraper Condensed', sans-serif", bundled: true },
    { key: "sensationalSans", label: "Sensational Sans", css: "'Sensational Sans', sans-serif", bundled: true },
    { key: "klorhine", label: "Klorhine", css: "'Klorhine', sans-serif", bundled: true },
    { key: "raptors", label: "Raptors", css: "'Raptors', sans-serif", bundled: true },
    // ATTENZIONE: file demo (uso personale) - vedi nota di licenza in style.css.
    { key: "calcio", label: "Calcio", css: "'Calcio', sans-serif", bundled: true },
  ];

  /**
   * Chiavi rimosse dall'elenco (varianti Sans e Condensed): le configurazioni
   * gia' salvate vengono ricondotte al font rimasto piu' vicino.
   */
  const FONT_ALIASES = {
    sansLight: "sans",
    sansMedium: "sans",
    sansBlack: "sans",
    sansThin: "sans",
    condensed: "condensedLight",
  };

  function normalizeFontKey(key) {
    if (FONT_ALIASES[key]) return FONT_ALIASES[key];
    return FONTS.some((f) => f.key === key) ? key : "sans";
  }

  function fontCss(key) {
    const f = FONTS.find((x) => x.key === normalizeFontKey(key));
    return f ? f.css : "sans-serif";
  }

  /**
   * I font inclusi nell'app vengono caricati in modo asincrono dalla WebView:
   * finche' non sono pronti il Canvas disegnerebbe con un ripiego. Li carichiamo
   * subito e ridisegniamo l'anteprima appena disponibili.
   */
  const bundledFontsReady = (function () {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const jobs = [];
    FONTS.filter((f) => f.bundled).forEach((f) => {
      // Solo la famiglia principale: document.fonts.load vuole un nome, non un elenco.
      const family = f.css.split(",")[0].trim();
      jobs.push(document.fonts.load("400 40px " + family));
      jobs.push(document.fonts.load("700 40px " + family));
    });
    return Promise.all(jobs).catch(() => {});
  })();

  function defaultStyle(size, y, bold) {
    return {
      fontKey: "sans",
      bold: !!bold,
      italic: false,
      size: size,
      color: "#ffffff",
      gradient: false,
      gradientDirection: "horizontal", // "horizontal" | "vertical" | "fadeDown"
      gradientFadeOpacity: 0, // 0..1, quantita' di trasparenza in fondo quando direction = "fadeDown" (0 = minima, 1 = meta' inferiore trasparente)
      color2: "#ffc531",
      opacity: 1,
      x: 0.5,
      y: y,
      stretchX: 1,
      stretchY: 1,
      rotation: 0,
      tracking: 0,
      outlineWidth: 0,
      outlineColor: "#000000",
      glowWidth: 0,
      glowColor: "#000000",
      shadowOpacity: 0.45,
      shadowBlur: 10,
      shadowOffsetY: 4,
      plateOpacity: 0,
      plateColor: "#000000",
    };
  }

  /** Stile separato ore/minuti (facoltativo, solo orologio in modalita' "ora"):
   *  vedi ClockSplitConfig in WallpaperConfig.kt. Ore e minuti condividono
   *  sempre la stessa posizione/rotazione sullo schermo (x/y/rotation dello
   *  style base): sono un unico blocco che si trascina e si posiziona solo
   *  insieme, mai singolarmente. Possono pero' stare separatamente sopra o
   *  sotto il soggetto ritagliato ("hourLayer"/"minuteLayer"), oltre ad avere
   *  colore e grassetto propri. "arrangement" sceglie la disposizione
   *  RECIPROCA di ore e minuti all'interno del blocco: "horizontal" = ore a
   *  sinistra, minuti a destra (comportamento di sempre); "vertical" = ore
   *  sopra, minuti sotto, con "verticalGap" a regolarne la distanza. Grassetto
   *  sempre spento di default quando si attiva lo stile separato: e' una
   *  scelta esplicita dell'utente, indipendente dal grassetto dello stile base. */
  function defaultClockSplit() {
    return {
      enabled: false,
      hourColor: "#ffffff",
      hourBold: false,
      minuteColor: "#ffffff",
      minuteBold: false,
      hourLayer: "back", // "back" (sotto al soggetto) | "front" (sopra)
      minuteLayer: "back",
      arrangement: "horizontal", // "horizontal" | "vertical"
      verticalGap: 100, // 0..100: 100 = spaziatura normale, 0 = ore/minuti a contatto
    };
  }

  const state = {
    bg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0, rotation: 0 },
    fg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0 },
    photoDataUrl: null,
    bgDim: 0,
    clock: {
      enabled: true, mode: "time", customText: "", format: "24", centerDots: false,
      layer: "back", // "back" (sotto al soggetto) | "front" (sopra): orologio intero, vale solo senza ore/minuti separati
      style: defaultStyle(150, 0.30, true),
      splitStyle: defaultClockSplit(),
    },
    date: { enabled: true, format: "full", uppercase: false, layer: "back", style: defaultStyle(38, 0.30, false) },
    weather: { type: "none", intensity: 0.5, speed: 1, fps: 60 },
  };

  const isNative = typeof Android !== "undefined" && Android !== null;

  const canvas = document.getElementById("mainCanvas");
  const ctx = canvas.getContext("2d");
  const emptyState = document.getElementById("emptyState");
  const dragHint = document.getElementById("dragHint");

  const hitBoxes = { clock: null, date: null };

  // ===========================================================================
  // IMMAGINI
  // ===========================================================================
  function drawCover(context, img, rectW, rectH, scale, offXFrac, offYFrac, rotationDeg) {
    if (!img || !img.width || !img.height) return;
    const base = Math.max(rectW / img.width, rectH / img.height);
    const s = base * (scale > 0 ? scale : 1);
    const drawW = img.width * s;
    const drawH = img.height * s;
    const cx = rectW / 2 + offXFrac * rectW * 0.5;
    const cy = rectH / 2 + offYFrac * rectH * 0.5;

    context.save();
    context.translate(cx, cy);
    if (rotationDeg) context.rotate((rotationDeg * Math.PI) / 180);
    context.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    context.restore();
  }

  // ===========================================================================
  // TESTO
  // ===========================================================================
  function pad2(n) { return String(n).padStart(2, "0"); }

  function clockString() {
    const c = state.clock;
    if (c.mode === "custom") {
      return c.customText && c.customText.trim() ? c.customText : "Il tuo testo";
    }
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    // Ore e minuti attaccati, senza alcun separatore (ne' ":" ne' spazio), a meno
    // che i "puntini centrali" non siano attivi: in quel caso si inserisce un ':'
    // letterale, che drawTextLayer riconosce come segnaposto per i due puntini
    // disegnati a parte (non come glifo del font). Specchio di DepthRenderer.kt.
    // Solo formato 24 ore: "24" (con zero iniziale) o "24short" (senza).
    const sep = c.centerDots ? ":" : "";
    return c.format === "24short" ? h + sep + pad2(m) : pad2(h) + sep + pad2(m);
  }

  /** Isola la sola sottostringa "ore" (per il confine ore/minuti dello stile
   *  separato): stessa logica di clockString() sopra, specchio di
   *  drawClockLayer in DepthRenderer.kt. */
  function clockHourPart(format) {
    const now = new Date();
    const h = now.getHours();
    return format === "24short" ? String(h) : pad2(h);
  }

  /** Isola la sola sottostringa "minuti" (per la disposizione verticale dello
   *  stile separato): specchio di clockHourPart() sopra e di
   *  drawClockLayer in DepthRenderer.kt. */
  function clockMinutePart() {
    const now = new Date();
    return pad2(now.getMinutes());
  }

  function dateString() {
    const now = new Date();
    let s;
    switch (state.date.format) {
      case "fullYear": s = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); break;
      case "dayMonth": s = now.toLocaleDateString("it-IT", { day: "numeric", month: "long" }); break;
      case "short": s = now.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }); break;
      case "numeric": s = now.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }); break;
      case "weekday": s = now.toLocaleDateString("it-IT", { weekday: "long" }); break;
      default: s = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    }
    if (state.date.uppercase) return s.toUpperCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // --- puntini centrali (":") -------------------------------------------------
  // Il ':' non e' mai un vero glifo del font: se dotsForColon e' attivo viene
  // sempre sostituito da due cerchi disegnati a parte, cosi' il risultato e'
  // identico su qualunque font. Proporzioni ricavate dalla larghezza della
  // cifra "0", specchio di DepthRenderer.kt (dotSlotWidth/dotRadius/dotOffset).
  function dotSlotWidth(context) { return context.measureText("0").width * 0.85; }
  function dotRadius(context) { return context.measureText("0").width * 0.16; }
  function dotOffset(context) { return context.measureText("0").width * 0.30; }

  // I puntini vanno centrati sul centro OTTICO della cifra "0", non sulla baseline
  // "y" usata per fillText/strokeText: le cifre stanno sopra la baseline, quindi
  // centrarli su "y" li fa apparire troppo in basso. actualBoundingBoxAscent/Descent
  // danno l'ingombro reale della cifra rispetto alla baseline; il loro punto medio
  // e' l'offset verticale da sommare a "y" per trovare il vero centro cifra.
  // Specchio di digitCenterOffset in DepthRenderer.kt.
  function digitCenterOffset(context) {
    const m = context.measureText("0");
    const asc = m.actualBoundingBoxAscent || 0;
    const desc = m.actualBoundingBoxDescent || 0;
    return (desc - asc) / 2;
  }

  function drawDot(context, cx, cy, r, mode) {
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    if (mode === "stroke") context.stroke(); else context.fill();
  }

  function measureTracked(context, text, tracking, dotsForColon) {
    if (!text) return 0;
    const hasMarker = dotsForColon && text.indexOf(":") !== -1;
    if (!tracking && !hasMarker) return context.measureText(text).width;
    let total = 0;
    for (const ch of text) {
      total += (hasMarker && ch === ":") ? dotSlotWidth(context) : context.measureText(ch).width;
    }
    return total + tracking * (text.length - 1);
  }

  function drawTrackedLine(context, text, y, tracking, mode, dotsForColon) {
    const hasMarker = dotsForColon && text.indexOf(":") !== -1;
    const paint = mode === "stroke" ? context.strokeText.bind(context) : context.fillText.bind(context);
    if (!tracking && !hasMarker) {
      context.textAlign = "center";
      paint(text, 0, y);
      return;
    }
    context.textAlign = "left";
    let x = -measureTracked(context, text, tracking, dotsForColon) / 2;
    for (const ch of text) {
      if (hasMarker && ch === ":") {
        const slot = dotSlotWidth(context);
        const cx = x + slot / 2;
        const r = dotRadius(context);
        const off = dotOffset(context);
        const centerY = y + digitCenterOffset(context);
        drawDot(context, cx, centerY - off, r, mode);
        drawDot(context, cx, centerY + off, r, mode);
        x += slot + tracking;
      } else {
        paint(ch, x, y);
        x += context.measureText(ch).width + tracking;
      }
    }
  }

  function drawLines(context, lines, firstY, lineHeight, tracking, mode, dotsForColon) {
    let y = firstY;
    for (const line of lines) {
      drawTrackedLine(context, line, y, tracking, mode, dotsForColon);
      y += lineHeight;
    }
  }

  function wrapLines(context, text, maxWidth, tracking, dotsForColon) {
    const out = [];
    for (const raw of String(text).split("\n")) {
      const words = raw.split(" ");
      let current = "";
      for (const word of words) {
        const test = current ? current + " " + word : word;
        if (measureTracked(context, test, tracking, dotsForColon) > maxWidth && current) {
          out.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      out.push(current);
    }
    return out;
  }

  function clearShadow(context) {
    context.shadowColor = "rgba(0,0,0,0)";
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
  }

  /** Proietta un'ombra/alone UNICO dietro a tutta la scritta (anche su piu'
   *  caratteri con spaziatura lettere attiva), invece di farlo carattere per
   *  carattere: con la spaziatura attiva, l'ombra per-carattere si sovrapponeva
   *  tra una lettera e l'altra, sommandosi e creando un alone molto piu' grande
   *  e visibile del previsto (specie evidente con il riempimento a gradiente).
   *  Disegna prima la sagoma (piena, bianca, senza sfocatura) su un canvas
   *  separato, poi la ridisegna una sola volta sul contesto principale con
   *  l'ombra attiva e sorgente resa quasi invisibile: cosi' resta solo l'ombra. */
  function drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, mode, strokeWidth, shadowColor, shadowBlur, shadowOffsetY, dotsForColon) {
    if (maxW <= 0) return;
    const pad = Math.ceil(strokeWidth + Math.abs(shadowBlur) + Math.abs(shadowOffsetY) + 6);
    const totalH = lines.length * lineHeight;
    const cw = Math.max(1, Math.ceil(maxW + pad * 2));
    const chh = Math.max(1, Math.ceil(totalH + pad * 2));
    const off = document.createElement("canvas");
    off.width = cw;
    off.height = chh;
    const octx = off.getContext("2d");
    octx.font = context.font;
    octx.textBaseline = "middle";
    octx.lineJoin = "round";
    octx.lineCap = "round";
    octx.fillStyle = "#fff";
    octx.strokeStyle = "#fff";
    if (strokeWidth > 0) octx.lineWidth = strokeWidth;
    octx.translate(cw / 2, totalH / 2 + pad);
    drawLines(octx, lines, firstY, lineHeight, tracking, mode, dotsForColon);

    context.save();
    context.shadowColor = shadowColor;
    context.shadowBlur = shadowBlur;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = shadowOffsetY;
    context.globalAlpha = 0.004; // sorgente quasi invisibile: resta solo l'ombra proiettata
    context.drawImage(off, -cw / 2, -totalH / 2 - pad);
    context.restore();
  }

  function roundRectPath(context, x, y, w, h, r) {
    if (context.roundRect) {
      context.beginPath();
      context.roundRect(x, y, w, h, r);
      return;
    }
    const rr = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + rr, y);
    context.arcTo(x + w, y, x + w, y + h, rr);
    context.arcTo(x + w, y + h, x, y + h, rr);
    context.arcTo(x, y + h, x, y, rr);
    context.arcTo(x, y, x + w, y, rr);
    context.closePath();
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#000000");
    if (!m) return `rgba(0,0,0,${alpha})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
  }

  /**
   * Aggiunge gli stop di colore per la dissolvenza "fadeDown" su un gradiente
   * verticale gia' creato (posizione 0 = cima del testo, 1 = fondo).
   * "amount" (0..1) e' la quantita' di trasparenza voluta in fondo:
   *  - 0   => dissolvenza minima, il testo resta quasi del tutto opaco;
   *  - 1   => la meta' inferiore del testo e' completamente trasparente.
   * In ogni caso resta un'unica sfumatura continua, senza stacchi netti.
   */
  function addFadeDownStops(grad, color, amount) {
    const t = Math.max(0, Math.min(1, amount));
    let fadeTop = Math.max(0, Math.min(1, 1 - t * 1.15));    // dove l'alpha inizia a scendere da 1
    let fadeBottom = Math.max(0, Math.min(1, 1 - t * 0.35)); // dove l'alpha arriva a 0
    if (fadeBottom <= fadeTop) fadeBottom = Math.min(1, fadeTop + 0.001);
    grad.addColorStop(0, color);
    if (fadeTop > 0) grad.addColorStop(fadeTop, color);
    grad.addColorStop(fadeBottom, hexToRgba(color, 0));
    if (fadeBottom < 1) grad.addColorStop(1, hexToRgba(color, 0));
  }

  /** Disegna un livello di testo e restituisce il riquadro occupato (frazioni 0..1).
   *  stackedLines: usato solo dalla disposizione verticale dello stile separato
   *  ore/minuti (vedi drawClockLayer). Quando presente e' un array di ESATTAMENTE
   *  due righe fisse, "ore" e "minuti": sostituisce il normale calcolo delle righe
   *  (niente a-capo automatico) e va sempre usato insieme a splitSide "top"/"bottom"
   *  per isolare, con un ritaglio verticale, solo la riga di competenza di questa
   *  chiamata. Le due chiamate (ore/minuti) misurano comunque ENTRAMBE le righe per
   *  restare centrate come un unico blocco, esattamente come gia' avviene per la
   *  disposizione orizzontale (splitAt/"before"/"after"): ore e minuti restano
   *  cosi' sempre un solo riquadro, che si trascina e si posiziona solo insieme.
   *  gapPercent: solo con stackedLines, 0..100 per lo slider "Spaziatura
   *  verticale" dello stile separato. 100 = spaziatura normale (invariata),
   *  0 = ore e minuti accostati fino a toccarsi, senza sovrapporsi ne'
   *  tagliare i caratteri: il valore intermedio interpola tra l'altezza reale
   *  del testo (misurata con actualBoundingBox, quindi valida per qualunque
   *  font/dimensione) e l'altezza di riga normale. Specchio esatto di
   *  DepthRenderer.kt. */
  function drawTextLayer(context, w, h, style, text, multiline, dotsForColon, splitAt, splitSide, colorOverride, boldOverride, stackedLines, gapPercent) {
    if (!text) return null;
    const k = w / CANVAS_W;
    let size = style.size * k;
    if (size <= 0) return null;

    const sx = style.stretchX > 0 ? style.stretchX : 1;
    const sy = style.stretchY > 0 ? style.stretchY : 1;
    let tracking = style.tracking * k;
    const alpha = Math.max(0, Math.min(1, style.opacity));
    const effectiveBold = boldOverride != null ? boldOverride : style.bold;
    const effectiveColor = colorOverride || style.color;

    context.save();
    context.globalAlpha = alpha;
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineCap = "round";
    const weight = effectiveBold ? "700" : "400";
    const italic = style.italic ? "italic " : "";
    context.font = `${italic}${weight} ${size}px ${fontCss(style.fontKey)}`;
    // Anteprima alla massima nitidezza: contorni reali dei glifi, senza
    // arrotondamenti/hinting (ignorato dai browser che non lo supportano).
    if ("textRendering" in context) context.textRendering = "geometricPrecision";

    // Adattamento automatico su una riga (orologio in modalita' "ora", data): i
    // motori di testo di WebView e di Android nativo possono misurare lo stesso
    // font a parita' di "size" con larghezze diverse. Se il testo naturale sfora
    // il canvas lo restringiamo qui in proporzione, cosi' l'anteprima nell'editor
    // e il risultato reale sul dispositivo restano sempre coerenti, qualunque sia
    // il font scelto.
    let effK = k;
    if (!multiline && !stackedLines) {
      const naturalW = measureTracked(context, String(text), tracking, dotsForColon) * sx;
      const maxAllowed = w * 0.94;
      if (naturalW > maxAllowed && naturalW > 0) {
        const fit = maxAllowed / naturalW;
        size *= fit;
        tracking *= fit;
        effK *= fit;
        context.font = `${italic}${weight} ${size}px ${fontCss(style.fontKey)}`;
      }
    }

    context.translate(style.x * w, style.y * h);
    if (style.rotation) context.rotate((style.rotation * Math.PI) / 180);
    context.scale(sx, sy);

    const lines = stackedLines ? stackedLines.slice() : (multiline ? wrapLines(context, text, (w * 0.92) / sx, tracking, dotsForColon) : [String(text)]);
    const normalLineHeight = size * 1.12;
    let lineHeight = normalLineHeight;
    if (stackedLines) {
      // Altezza minima ("toccano completamente"): l'altezza reale delle cifre
      // per il font/dimensione correnti, cosi' le due righe si accostano fino
      // a sfiorarsi senza mai tagliare i caratteri (il ritaglio verticale
      // sopra usa esattamente questa altezza come banda per riga).
      let tightHeight = normalLineHeight;
      try {
        const mm = context.measureText("0123456789");
        if (mm.actualBoundingBoxAscent !== undefined && mm.actualBoundingBoxDescent !== undefined) {
          tightHeight = Math.min(normalLineHeight, mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent);
        }
      } catch (e) { /* fallback gia' impostato su normalLineHeight */ }
      const t = Math.max(0, Math.min(100, gapPercent != null ? gapPercent : 100)) / 100;
      lineHeight = tightHeight + t * (normalLineHeight - tightHeight);
    }
    const firstY = (-(lines.length - 1) * lineHeight) / 2;

    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, measureTracked(context, line, tracking, dotsForColon));

    if (stackedLines && splitSide) {
      // Ritaglio verticale ore-sopra/minuti-sotto: stesso principio del ritaglio
      // orizzontale sotto, ma isola una RIGA (indice 0 = ore, 1 = minuti) invece
      // di una porzione di larghezza. Il blocco resta comunque centrato su
      // entrambe le righe insieme (maxW sopra tiene conto di entrambe), quindi
      // le due chiamate (ore/minuti) restano perfettamente allineate come un
      // unico riquadro. Specchio esatto di DepthRenderer.kt.
      const idx = splitSide === "top" ? 0 : 1;
      const bandTop = firstY + (idx - 0.5) * lineHeight;
      const bandBottom = bandTop + lineHeight;
      const bigW = maxW + size * 4 + w; // ampio margine: mai il fattore limitante
      context.beginPath();
      context.rect(-bigW, bandTop, bigW * 2, bandBottom - bandTop);
      context.clip();
    } else if (splitAt != null && splitSide && !multiline) {
      // Ritaglio orizzontale ore-sinistra/minuti-destra: specchio esatto di
      // DepthRenderer.kt. Il testo e' centrato su x=0 in questo spazio locale;
      // misurando la sola sottostringa "ore" con lo stesso font/tracking (gia'
      // post-adattamento automatico) si trova il confine esatto, coerente con
      // l'unico disegno che avverrebbe senza divisione.
      const hourW = measureTracked(context, splitAt, tracking, dotsForColon);
      const boundaryX = -maxW / 2 + hourW;
      const top = firstY - lineHeight;
      const bottom = firstY + lines.length * lineHeight;
      context.beginPath();
      if (splitSide === "before") {
        context.rect(-maxW, top, boundaryX - -maxW, bottom - top);
      } else {
        context.rect(boundaryX, top, maxW - boundaryX, bottom - top);
      }
      context.clip();
    }

    let shadowPending = style.shadowOpacity > 0;
    function applyShadowIfPending() {
      if (!shadowPending) { clearShadow(context); return; }
      context.shadowColor = `rgba(0,0,0,${style.shadowOpacity})`;
      context.shadowBlur = style.shadowBlur * effK;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = style.shadowOffsetY * effK;
      shadowPending = false;
    }

    // --- pannello dietro ---
    if (style.plateOpacity > 0) {
      applyShadowIfPending();
      const padX = size * 0.32;
      const padY = size * 0.22;
      const rectX = -maxW / 2 - padX;
      const rectY = firstY - lineHeight / 2 - padY;
      const rectW = maxW + padX * 2;
      const rectH = (lines.length - 1) * lineHeight + lineHeight + padY * 2;
      context.fillStyle = hexToRgba(style.plateColor, style.plateOpacity);
      roundRectPath(context, rectX, rectY, rectW, rectH, size * 0.28);
      context.fill();
      clearShadow(context);
    }

    // --- alone morbido ---
    if (style.glowWidth > 0) {
      const gw = style.glowWidth * effK;
      drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, "stroke", gw * 2, style.glowColor, gw * 1.6, 0, dotsForColon);
      context.strokeStyle = style.glowColor;
      context.lineWidth = gw * 2;
      drawLines(context, lines, firstY, lineHeight, tracking, "stroke", dotsForColon);
    }

    // --- contorno netto ---
    if (style.outlineWidth > 0) {
      if (shadowPending) {
        drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, "stroke", style.outlineWidth * effK * 2, `rgba(0,0,0,${style.shadowOpacity})`, style.shadowBlur * effK, style.shadowOffsetY * effK, dotsForColon);
        shadowPending = false;
      }
      context.strokeStyle = style.outlineColor;
      context.lineWidth = style.outlineWidth * effK * 2;
      drawLines(context, lines, firstY, lineHeight, tracking, "stroke", dotsForColon);
    }

    // --- riempimento ---
    if (shadowPending) {
      drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, "fill", 0, `rgba(0,0,0,${style.shadowOpacity})`, style.shadowBlur * effK, style.shadowOffsetY * effK, dotsForColon);
      shadowPending = false;
    }
    if (style.gradient && maxW > 0) {
      const dir = style.gradientDirection || "horizontal";
      if (dir === "vertical" || dir === "fadeDown") {
        const top = firstY - lineHeight / 2;
        const bottom = firstY + (lines.length - 1) * lineHeight + lineHeight / 2;
        const grad = context.createLinearGradient(0, top, 0, bottom);
        if (dir === "fadeDown") {
          addFadeDownStops(grad, effectiveColor, style.gradientFadeOpacity || 0);
        } else {
          grad.addColorStop(0, effectiveColor);
          grad.addColorStop(1, style.color2);
        }
        context.fillStyle = grad;
      } else {
        const grad = context.createLinearGradient(-maxW / 2, 0, maxW / 2, 0);
        grad.addColorStop(0, effectiveColor);
        grad.addColorStop(1, style.color2);
        context.fillStyle = grad;
      }
    } else {
      context.fillStyle = effectiveColor;
    }
    drawLines(context, lines, firstY, lineHeight, tracking, "fill", dotsForColon);

    context.restore();

    const halfW = (maxW * sx) / 2 / w;
    const halfH = ((lines.length * lineHeight) * sy) / 2 / h;
    if (style.rotation) {
      // Testo ruotato: si usa un riquadro circolare attorno al centro, cosi'
      // il trascinamento sull'anteprima resta agganciato al testo comunque
      // sia inclinato.
      const r = Math.hypot(halfW, halfH * (h / w));
      return { x: style.x, y: style.y, halfW: r, halfH: (r * w) / h };
    }
    return { x: style.x, y: style.y, halfW: halfW, halfH: halfH };
  }

  /** Specchio di drawClockLayer in DepthRenderer.kt: vedi li' per i dettagli.
   *  Ritorna il riquadro dell'orologio (per il trascinamento sull'anteprima)
   *  solo quando disegna nel passaggio "back", cosi' l'hit-test in render()
   *  resta invariato rispetto a prima (un solo riquadro, non due). */
  function drawClockLayer(context, w, h, clock, pass) {
    const text = clockString();
    if (!text) return null;
    const multiline = clock.mode === "custom";
    const split = clock.splitStyle;
    // La disposizione (orizzontale/verticale) e' indipendente dalla gestione
    // separata di colore/grassetto/posizione: si puo' avere ore-sopra-minuti-
    // sotto anche con stile identico per entrambi, senza dover attivare
    // "Colore/grassetto/posizione separati".
    const verticalArrangement = split && split.arrangement === "vertical" && clock.mode !== "custom";
    const splitStyleActive = !!(split && split.enabled) && clock.mode !== "custom";

    // Passaggio dell'orologio intero (sopra/sotto il soggetto): conta solo
    // quando ore e minuti NON sono separati. Con "separati" attivo decidono
    // hourLayer/minuteLayer, e questo valore viene ignorato.
    const wholeClockPass = clock.layer === "front" ? "front" : "back";

    if (!splitStyleActive && !verticalArrangement) {
      if (pass === wholeClockPass) {
        return drawTextLayer(context, w, h, clock.style, text, multiline, clock.centerDots);
      }
      return null;
    }

    if (verticalArrangement) {
      // Ore sopra, minuti sotto: due righe fisse (niente ":" ne' a-capo
      // automatico), sempre disegnate come un unico blocco che si trascina e
      // si posiziona solo insieme (vedi drawTextLayer/stackedLines sopra).
      // Colore/grassetto per riga e la scelta sopra/sotto il soggetto restano
      // quelli unificati dello stile base finche' "separati" non e' attivo:
      // in quel caso entrambe le righe stanno sempre sullo stesso passaggio
      // ("back"), esattamente come l'orologio normale non diviso.
      const hourLayerPass = splitStyleActive ? split.hourLayer : wholeClockPass;
      const minuteLayerPass = splitStyleActive ? split.minuteLayer : wholeClockPass;
      const drawHour = hourLayerPass === pass;
      const drawMinute = minuteLayerPass === pass;
      if (!drawHour && !drawMinute) return null;

      const hourPart = clockHourPart(clock.format);
      const minutePart = clockMinutePart();
      const stackedLines = [hourPart, minutePart];
      let box = null;
      if (drawHour) {
        box = drawTextLayer(
          context, w, h, clock.style, text, false, false,
          null, "top", splitStyleActive ? split.hourColor : null, splitStyleActive ? split.hourBold : null, stackedLines, split.verticalGap
        ) || box;
      }
      if (drawMinute) {
        box = drawTextLayer(
          context, w, h, clock.style, text, false, false,
          null, "bottom", splitStyleActive ? split.minuteColor : null, splitStyleActive ? split.minuteBold : null, stackedLines, split.verticalGap
        ) || box;
      }
      return box;
    }

    // Disposizione orizzontale con colore/grassetto/posizione separati.
    const drawHour = split.hourLayer === pass;
    const drawMinute = split.minuteLayer === pass;
    if (!drawHour && !drawMinute) return null;

    const hourPart = clockHourPart(clock.format);
    let box = null;
    if (drawHour) {
      box = drawTextLayer(
        context, w, h, clock.style, text, false, clock.centerDots,
        hourPart, "before", split.hourColor, split.hourBold
      ) || box;
    }
    if (drawMinute) {
      box = drawTextLayer(
        context, w, h, clock.style, text, false, clock.centerDots,
        hourPart, "after", split.minuteColor, split.minuteBold
      ) || box;
    }
    return box;
  }

  // ===========================================================================
  // METEO (pioggia, neve, nebbia)
  // ---------------------------------------------------------------------------
  // Stessa logica del porting nativo (RainLayer.kt / SnowLayer.kt).
  // Le caratteristiche di ogni goccia/fiocco (x, lunghezza, velocita' relativa,
  // sfasamento) vengono da un piccolo generatore pseudo-casuale con seme fisso,
  // quindi restano identiche a ogni frame: a cambiare e' solo la posizione, in
  // base al tempo trascorso da quando l'animazione e' (ri)partita. Si riparte da
  // zero: all'inizio tutto e' sopra il bordo alto e entra dall'alto, come sul
  // wallpaper vero a ogni accensione dello schermo. Il canvas dell'editor e' gia'
  // alla larghezza di riferimento (CANVAS_W = 1080), quindi qui non serve alcun
  // fattore di scala "k" come nel renderer nativo.
  // ===========================================================================
  function weatherActive() {
    const wx = state.weather;
    return wx.type !== "none";
  }

  function drawRain(context, w, h, wx, t) {
    const intensity = Math.max(0, Math.min(1, wx.intensity));
    const count = Math.round(40 + intensity * 260);
    if (count <= 0) return;

    const speed = wx.speed > 0 ? wx.speed : 1;
    const angleRad = (4 * Math.PI) / 180; // quasi verticale, come nel riferimento
    const dx = Math.sin(angleRad);
    const dy = Math.cos(angleRad);

    // Piccolo LCG con seme fisso: stessa sequenza di gocce a ogni chiamata.
    let seed = 1337;
    function rnd() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }

    context.save();
    context.lineCap = "round";
    context.lineWidth = 1.6;
    for (let i = 0; i < count; i++) {
      const xFrac = rnd();
      const len = 26 + rnd() * 46;
      const speedFactor = 0.6 + rnd() * 0.8;
      const phase = rnd();
      const alpha = (60 + Math.floor(rnd() * 90)) / 255;

      // 2000 px/s @1080 = velocita' misurata sul video di riferimento.
      const fallSpeed = 2000 * speed * speedFactor;
      const travel = h + len;
      const dRaw = ((t * fallSpeed + phase * travel) % travel + travel) % travel;
      const yTop = dRaw - len;
      const x = xFrac * w;

      context.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      context.beginPath();
      context.moveTo(x, yTop);
      context.lineTo(x + dx * len, yTop + dy * len);
      context.stroke();
    }
    context.restore();
  }

  function drawSnow(context, w, h, wx, t) {
    const intensity = Math.max(0, Math.min(1, wx.intensity));
    const count = Math.round(30 + intensity * 170);
    if (count <= 0) return;
    const speed = wx.speed > 0 ? wx.speed : 1;

    // Tre taglie: piccoli = lontani (lenti, trasparenti), grandi = vicini.
    const radius = [1.8, 3.0, 4.8];
    const fall = [90, 150, 220];
    const alphaOf = [140 / 255, 190 / 255, 235 / 255];
    const swayAmp = [10, 18, 28];

    let seed = 4242;
    function rnd() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }

    context.save();
    for (let i = 0; i < count; i++) {
      const xFrac = rnd();
      const phase = rnd();
      const r0 = rnd();
      const c = r0 < 0.55 ? 0 : (r0 < 0.85 ? 1 : 2);
      const jitter = 0.8 + rnd() * 0.4;
      const swayFreq = 0.5 + rnd() * 0.8;
      const swayPhase = rnd() * Math.PI * 2;

      const r = radius[c];
      const travel = h + 2 * r;
      const dRaw = ((t * fall[c] * speed * jitter + phase * travel) % travel + travel) % travel;
      const y = dRaw - r;
      const x = xFrac * w + Math.sin(t * swayFreq + swayPhase) * swayAmp[c];

      context.fillStyle = `rgba(255,255,255,${alphaOf[c].toFixed(3)})`;
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawWeather(context, w, h, wx, nowMs) {
    if (!wx || wx.type === "none") return;
    const t = nowMs / 1000; // tempo assoluto: continuita' anche a schermo spento/riacceso
    if (wx.type === "rain") drawRain(context, w, h, wx, t);
    else if (wx.type === "snow") drawSnow(context, w, h, wx, t);
  }


  // ===========================================================================
  // RENDER
  // ===========================================================================
  function render(context, w, h) {
    context.clearRect(0, 0, w, h);
    context.fillStyle = "#000000";
    context.fillRect(0, 0, w, h);

    if (state.bg.img) {
      drawCover(context, state.bg.img, w, h, state.bg.scale, state.bg.offX, state.bg.offY, state.bg.rotation);
    }

    if (state.bgDim > 0) {
      context.fillStyle = `rgba(0,0,0,${(state.bgDim / 100) * 0.75})`;
      context.fillRect(0, 0, w, h);
    }

    let clockBox = state.clock.enabled
      ? drawClockLayer(context, w, h, state.clock, "back")
      : null;

    const dateFront = state.date.layer === "front";
    let dateBox = (state.date.enabled && !dateFront)
      ? drawTextLayer(context, w, h, state.date.style, dateString(), false)
      : null;

    if (state.fg.img) {
      // Il soggetto segue sempre le stesse trasformazioni dello sfondo, cosi'
      // zoom/spostamento/rotazione muovono i due livelli insieme.
      drawCover(context, state.fg.img, w, h, state.bg.scale, state.bg.offX, state.bg.offY, state.bg.rotation);
    }

    if (state.clock.enabled) {
      // Con posizione separata per ore e minuti, e' possibile che nel passaggio
      // "back" non venga disegnato nulla (es. entrambi sopra al soggetto): il
      // riquadro per il trascinamento arriva allora dal passaggio "front".
      const frontBox = drawClockLayer(context, w, h, state.clock, "front");
      clockBox = clockBox || frontBox;
    }

    if (state.date.enabled && dateFront) {
      dateBox = drawTextLayer(context, w, h, state.date.style, dateString(), false);
    }

    drawWeather(context, w, h, state.weather, Date.now());

    return { clockBox, dateBox };
  }

  function renderPreview() {
    const boxes = render(ctx, CANVAS_W, CANVAS_H);
    hitBoxes.clock = boxes.clockBox;
    hitBoxes.date = boxes.dateBox;
    emptyState.classList.toggle("hidden", !!state.bg.img);
  }

  setInterval(() => {
    if (state.clock.mode === "time" || state.date.enabled) renderPreview();
  }, 1000);

  // ---------------------------------------------------------------------------
  // Con un effetto meteo attivo l'anteprima ha bisogno di un ridisegno continuo
  // (non solo una volta al secondo) per animarlo: questo loop si avvia da solo
  // quando pioggia/neve si accendono e si ferma da solo al frame
  // successivo in cui li trova spenti, cosi' non consuma nulla quando non ci sono.
  // ---------------------------------------------------------------------------
  let rainLoopActive = false;
  function rainLoop() {
    if (!weatherActive()) { rainLoopActive = false; return; }
    renderPreview();
    requestAnimationFrame(rainLoop);
  }
  function ensureRainLoop() {
    if (weatherActive() && !rainLoopActive) {
      rainLoopActive = true;
      requestAnimationFrame(rainLoop);
    }
  }

  // ===========================================================================
  // TOAST
  // ===========================================================================
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    msg = String(msg);
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    // I messaggi lunghi (es. errori) restano visibili piu' a lungo: 2,4 s + 40 ms per
    // carattere oltre i 40, fino a un massimo di 9 s.
    const ms = Math.min(9000, 2400 + Math.max(0, msg.length - 40) * 40);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  // ===========================================================================
  // TAB
  // ===========================================================================
  // ---------------------------------------------------------------------------
  // Ordine reale delle schede: usato per decidere la direzione dello slide
  // (avanti = da destra verso sinistra, indietro = da sinistra verso destra) e
  // la distanza percorsa dallo squircle nella barra delle schede.
  // ---------------------------------------------------------------------------
  const TAB_ORDER = ["media", "clock", "date", "bg", "effects"];
  // Durata SEMPRE uguale sia per lo slide dei pannelli sia per lo squircle:
  // e' proprio la durata costante a "sincronizzare" le due animazioni. I
  // pannelli percorrono sempre la stessa distanza (una larghezza intera) e
  // quindi vanno sempre alla stessa velocita' "normale", qualunque scheda si
  // scelga. Lo squircle invece percorre una distanza diversa a seconda di
  // quante schede separano il punto di partenza da quello di arrivo: nella
  // stessa durata risulta percio' piu' lento su un tragitto breve (es. Media
  // -> Orologio) e piu' veloce su un tragitto lungo (es. Media -> Effetti).
  const TAB_TRANSITION_MS = 300;

  const tabsEl = document.getElementById("tabs");
  const tabIndicator = document.getElementById("tabIndicator");
  const panelSlider = document.getElementById("panelSlider");
  const tabPanelsEl = document.getElementById("tab-panels");
  let tabAnimBusy = false;

  function moveIndicatorTo(btnEl, animate) {
    if (!tabIndicator || !btnEl || !tabsEl) return;
    const ico = btnEl.querySelector(".tab-ico");
    if (!ico) return;
    const tabsRect = tabsEl.getBoundingClientRect();
    const icoRect = ico.getBoundingClientRect();
    const x = icoRect.left - tabsRect.left + tabsEl.scrollLeft;
    const y = icoRect.top - tabsRect.top + tabsEl.scrollTop;
    if (animate) {
      tabIndicator.style.transition = "transform " + TAB_TRANSITION_MS + "ms ease";
    } else {
      tabIndicator.style.transition = "none";
    }
    tabIndicator.style.transform = "translate(" + x + "px, " + y + "px)";
    if (!animate) {
      // forza il reflow cosi' la prossima transizione riparte da qui e non
      // "eredita" lo stato senza transizione appena impostato
      void tabIndicator.offsetWidth;
      tabIndicator.style.transition = "";
    }
  }

  function switchTab(btn) {
    const newKey = btn.dataset.tab;
    const oldBtn = document.querySelector(".tab-btn.active");
    const oldKey = oldBtn ? oldBtn.dataset.tab : null;
    if (oldKey === newKey || tabAnimBusy) return;

    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    moveIndicatorTo(btn, true);

    const oldPanel = oldKey ? document.getElementById("panel-" + oldKey) : null;
    const newPanel = document.getElementById("panel-" + newKey);
    if (!newPanel) return;

    // Fallback senza animazione (prima apertura, o pannello mancante).
    if (!oldPanel || oldPanel === newPanel || !panelSlider) {
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      newPanel.classList.add("active");
      if (tabPanelsEl) tabPanelsEl.scrollTop = 0;
      return;
    }

    const oldIndex = TAB_ORDER.indexOf(oldKey);
    const newIndex = TAB_ORDER.indexOf(newKey);
    const forward = newIndex > oldIndex;

    tabAnimBusy = true;

    const startHeight = oldPanel.offsetHeight;
    panelSlider.style.overflow = "hidden";
    panelSlider.style.height = startHeight + "px";

    // Entrambi i pannelli coinvolti (SOLO quei due: si va sempre dritti dalla
    // scheda di partenza a quella di arrivo, senza attraversare le sezioni
    // intermedie) diventano assoluti e sovrapposti per poter scorrere.
    [oldPanel, newPanel].forEach((p) => {
      p.classList.add("active");
      p.style.position = "absolute";
      p.style.top = "0";
      p.style.left = "0";
      p.style.width = "100%";
      p.style.transition = "none";
    });
    oldPanel.style.transform = "translateX(0)";
    newPanel.style.transform = forward ? "translateX(100%)" : "translateX(-100%)";

    // forza il reflow prima di leggere l'altezza finale e avviare la transizione
    void newPanel.offsetHeight;
    const endHeight = newPanel.scrollHeight;

    requestAnimationFrame(() => {
      const t = "transform " + TAB_TRANSITION_MS + "ms ease";
      oldPanel.style.transition = t;
      newPanel.style.transition = t;
      panelSlider.style.transition = "height " + TAB_TRANSITION_MS + "ms ease";
      oldPanel.style.transform = forward ? "translateX(-100%)" : "translateX(100%)";
      newPanel.style.transform = "translateX(0)";
      panelSlider.style.height = endHeight + "px";
    });

    setTimeout(() => {
      oldPanel.classList.remove("active");
      oldPanel.style.cssText = "";
      newPanel.style.cssText = "";
      panelSlider.style.cssText = "";
      if (tabPanelsEl) tabPanelsEl.scrollTop = 0;
      tabAnimBusy = false;
    }, TAB_TRANSITION_MS + 30);
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn);
    });
  });

  // Posiziona lo squircle sulla scheda iniziale senza animazione, e lo
  // riallinea se la finestra cambia dimensione/orientamento.
  moveIndicatorTo(document.querySelector(".tab-btn.active"), false);
  window.addEventListener("resize", () => {
    moveIndicatorTo(document.querySelector(".tab-btn.active"), false);
  });

  // ===========================================================================
  // SLIDER PERSONALIZZATI
  // ---------------------------------------------------------------------------
  // Gli slider nativi cambiano valore al primo tocco: scorrendo la lista in
  // verticale capitava di modificare per sbaglio i parametri. Qui il valore si
  // muove SOLO dopo un movimento la cui distanza TOTALE (non il singolo campione)
  // e' chiaramente piu' orizzontale che verticale: un tocco o uno scorrimento
  // verticale non toccano piu' nulla. Durante il trascinamento, avvicinarsi al
  // valore centrale ci si "aggancia" (snap magnetico); il pulsante ↺ accanto al
  // valore riporta al centro in un tocco, in modo affidabile su ogni dispositivo
  // (a differenza di un indicatore posizionato "a occhio" sopra lo slider nativo,
  // che su alcune skin Android puo' disallinearsi dal thumb reale).
  // ===========================================================================
  const sliders = {};
  const MAGNET = 0.025; // 2,5% della corsa
  const THUMB_SIZE = 20; // deve combaciare con --thumb-size nel CSS

  /** Riempie la barra tra il valore CENTRALE (di riferimento) e il valore attuale:
   *  a riposo lo slider e' "vuoto", e si colora nella direzione in cui lo sposti.
   *  Coerente con lo snap magnetico e col pulsante di reset accanto al valore. */
  function paintSliderFill(s, v) {
    const span = s.max - s.min;
    if (span <= 0) return;
    const pThumb = ((v - s.min) / span) * 100;
    const pCenter = ((s.center - s.min) / span) * 100;
    const lo = Math.min(pThumb, pCenter).toFixed(2);
    const hi = Math.max(pThumb, pCenter).toFixed(2);
    s.input.style.background =
      `linear-gradient(to right, var(--bg-3) 0%, var(--bg-3) ${lo}%, var(--accent) ${lo}%, var(--accent) ${hi}%, var(--bg-3) ${hi}%, var(--bg-3) 100%)`;
  }

  let previewRenderScheduled = false;
  /** Ridisegnare l'intera anteprima (foto + livelli + testo) e' il lavoro
   *  costoso di ogni frame; farlo ad ogni singolo campione di trascinamento
   *  (touchmove puo' arrivare a 60-120 volte al secondo) satura il thread JS,
   *  e il browser inizia a raggruppare/scartare gli eventi touch in arrivo:
   *  il risultato visibile e' uno slider che "salta" a scatti invece di
   *  seguire il dito con continuita'. Qui si raggruppa il ridisegno a un
   *  massimo di una volta per frame (via requestAnimationFrame), mentre
   *  l'aggiornamento visivo dello slider stesso (pallino + valore, gia'
   *  economico) resta sempre immediato e sincrono: e' quello che da' la
   *  sensazione di fluidita' durante il trascinamento.
   */
  function schedulePreviewRender() {
    if (previewRenderScheduled) return;
    previewRenderScheduled = true;
    requestAnimationFrame(() => {
      previewRenderScheduled = false;
      renderPreview();
    });
  }

  function applySlider(s, rawValue, doRender) {
    // NIENTE arrotondamento qui: il valore resta continuo (frazionario) per la
    // posizione del cursore e per l'effetto applicato. Prima si arrotondava
    // subito a un intero, quindi il cursore nativo si spostava SOLO quando il
    // valore intero cambiava - risultato: da fermo, poi un salto secco di
    // "passo" pixel (es. 3px per l'1%), invece di seguire il dito con
    // continuita'. Ora il cursore segue il dito pixel per pixel; solo il
    // numero mostrato nel badge viene arrotondato, per restare leggibile.
    const v = Math.max(s.min, Math.min(s.max, rawValue));
    s.input.value = v;
    if (s.setter) s.setter(v);
    const rounded = Math.round(v);
    if (s.badge) s.badge.textContent = s.formatter ? s.formatter(rounded) : String(rounded);
    paintSliderFill(s, v);
    // Con l'editor di ritaglio aperto l'anteprima principale e' nascosta sotto al
    // modal: ridisegnarla ad ogni campione di trascinamento (oltre al gia' costoso
    // ridisegno del setter dello slider stesso) raddoppiava il lavoro sul thread JS.
    // Durante il trascinamento di "Contorno ritaglio"/"Bordo bianco adesivo" questo
    // bastava a saturare il thread e bloccare l'intera WebView (persino "Applica").
    if (doRender && (!cutoutModal || cutoutModal.classList.contains("hidden"))) schedulePreviewRender();
  }

  function setSlider(rangeId, value) {
    const s = sliders[rangeId];
    if (s) applySlider(s, value, false);
  }

  function buildSliderRow(s) {
    const input = s.input;
    const row = document.createElement("div");
    row.className = "slider-row";
    input.parentNode.insertBefore(row, input);
    row.appendChild(input);

    let drag = null;

    function pointOf(evt) {
      const p = evt.touches ? evt.touches[0] : evt;
      return { x: p.clientX, y: p.clientY };
    }

    function onDown(evt) {
      const p = pointOf(evt);
      drag = { x: p.x, y: p.y, startVal: Number(input.value), active: false, rejected: false };
    }

    /**
     * Decide se il gesto e' un trascinamento orizzontale (modifica il valore) o uno
     * scorrimento verticale della lista (non deve toccare lo slider). La decisione si
     * basa sulla distanza TOTALE percorsa (non su un singolo campione di movimento):
     * un solo tocco leggermente obliquo, nei primissimi pixel, non deve piu' "uccidere"
     * il gesto — si aspetta che il movimento sia abbastanza netto da poter giudicare
     * con sicurezza la direzione, cosi' lo slider risulta reattivo invece che nervoso.
     */
    function onMove(evt) {
      if (!drag || drag.rejected) return;
      const p = pointOf(evt);
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;

      if (!drag.active) {
        const dist = Math.hypot(dx, dy);
        if (dist < 8) return; // troppo presto per capire la direzione: aspetta
        if (Math.abs(dy) > Math.abs(dx)) {
          drag.rejected = true; // scorrimento verticale: lascia fare alla pagina
          return;
        }
        drag.active = true;
        row.classList.add("dragging");
      }
      if (evt.cancelable) evt.preventDefault();

      const width = Math.max(1, input.getBoundingClientRect().width - THUMB_SIZE);
      const span = s.max - s.min;
      let v = drag.startVal + (dx / width) * span;
      if (!s.noMagnet && Math.abs(v - s.center) <= span * MAGNET) v = s.center;
      applySlider(s, v, true);
    }

    function onUp() {
      if (drag && drag.active) row.classList.remove("dragging");
      drag = null;
    }

    row.addEventListener("touchstart", onDown, { passive: true });
    row.addEventListener("touchmove", onMove, { passive: false });
    row.addEventListener("touchend", onUp);
    row.addEventListener("touchcancel", onUp);
    row.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Aggiunge, accanto al valore, i pulsanti "-" / "+" (passo di 1, utili per le
   *  regolazioni di precisione) e il pulsante "↺" che riporta lo slider al centro
   *  di riferimento in un tocco (stile "Studio"). Quest'ultimo e' l'unico modo per
   *  tornare al centro: essendo un pulsante normale, e' sempre esattamente dove ci
   *  si aspetta, a differenza di un indicatore sovrapposto allo slider. */
  function attachResetIcon(s, badge) {
    if (!badge || !badge.parentNode) return;
    const wrap = document.createElement("span");
    wrap.className = "value-wrap";
    badge.parentNode.insertBefore(wrap, badge);

    function stepBtn(label, title, delta) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "value-step-btn";
      btn.title = title;
      btn.textContent = label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Riparte sempre dal valore intero (mai da un eventuale residuo
        // frazionario lasciato da un trascinamento), cosi' i tasti +/- restano
        // sempre un passo pulito di 1 unita'.
        applySlider(s, Math.round(Number(s.input.value)) + delta, true);
      });
      return btn;
    }

    wrap.appendChild(stepBtn("\u2212", "Diminuisci di 1", -1));
    wrap.appendChild(badge);
    wrap.appendChild(stepBtn("+", "Aumenta di 1", 1));

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "value-reset-btn";
    resetBtn.title = "Ripristina";
    resetBtn.textContent = "\u21BA";
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applySlider(s, s.center, true);
    });
    wrap.appendChild(resetBtn);
  }

  function bindRange(rangeId, badgeId, setter, formatter) {
    const input = document.getElementById(rangeId);
    if (!input) return;
    const badge = badgeId ? document.getElementById(badgeId) : null;
    const s = {
      input: input,
      badge: badge,
      setter: setter,
      formatter: formatter,
      min: Number(input.min),
      max: Number(input.max),
      center: input.dataset.center !== undefined ? Number(input.dataset.center) : Number(input.value),
      // Alcuni slider (es. posizione verticale di orologio/data) restano volutamente
      // SENZA snap magnetico: il valore "centrale" resta comunque il riferimento per
      // il pulsante "↺" di ripristino, ma il trascinamento deve restare fluido su
      // tutta l'escursione, senza aggancio a meta' corsa.
      noMagnet: input.dataset.noMagnet !== undefined,
    };
    sliders[rangeId] = s;
    buildSliderRow(s);
    attachResetIcon(s, badge);
    applySlider(s, Number(input.value), false);
  }

  function bindCheck(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => { setter(el.checked); renderPreview(); });
  }

  function bindSelect(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => { setter(el.value); renderPreview(); });
  }

  // ===========================================================================
  // SELETTORE COLORE PERSONALIZZATO
  // ===========================================================================
  // Sostituisce l'<input type="color"> nativo: quello di sistema, quando si
  // preme "personalizza", riapre gli slider sempre da un colore di default
  // invece che dal colore attuale. Questo popover invece parte SEMPRE dal
  // colore corrente dello swatch, cosi' si possono fare micro correzioni.

  function getColorValue(el) { return el.dataset.value || "#ffffff"; }
  function setColorValue(el, hex) {
    el.dataset.value = hex;
    el.style.background = hex;
  }

  function hexToHsl(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#ffffff") || [];
    const r = parseInt(m[1] || "ff", 16) / 255;
    const g = parseInt(m[2] || "ff", 16) / 255;
    const b = parseInt(m[3] || "ff", 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  let colorPopoverEl = null;

  // Segnala al lato Android quando il popover colore e' aperto/chiuso: come
  // per l'editor di ritaglio, serve al tasto/gesto indietro di sistema per
  // sapere che deve chiudere solo il popover (non far scattare il doppio-
  // indietro-per-uscire, che vale solo quando non c'e' nessun overlay aperto).
  function notifyColorPopoverState(open) {
    if (isNative && typeof Android.setColorPopoverOpen === "function") {
      Android.setColorPopoverOpen(open);
    }
  }

  function closeColorPopover() {
    if (colorPopoverEl) {
      colorPopoverEl.remove();
      colorPopoverEl = null;
      document.removeEventListener("mousedown", onColorPopoverOutside, true);
      document.removeEventListener("touchstart", onColorPopoverOutside, true);
      notifyColorPopoverState(false);
    }
  }

  // Chiamata da Android quando l'utente fa swipe/tasto indietro mentre il
  // popover colore e' aperto: si comporta come un tocco fuori dal popover.
  window.closeColorPopoverFromBack = function () {
    closeColorPopover();
  };

  function onColorPopoverOutside(e) {
    if (colorPopoverEl && !colorPopoverEl.contains(e.target)) closeColorPopover();
  }

  function openColorPopover(anchorEl, onChange) {
    // Se era attiva una pipetta (l'utente aveva premuto "Preleva colore" e poi,
    // invece di toccare la foto, ha riaperto il selettore per scegliere il
    // colore con gli slider), annullarla: altrimenti resta "armata" e un
    // successivo tocco sulla foto sovrascrive il colore appena scelto a mano.
    if (eyedrop) stopEyedrop();
    closeColorPopover();
    const initialHex = getColorValue(anchorEl);
    const hsl = hexToHsl(initialHex);

    const backdrop = document.createElement("div");
    backdrop.className = "color-popover-backdrop";

    const sheet = document.createElement("div");
    sheet.className = "color-popover";
    sheet.innerHTML = `
      <div class="color-popover-preview" id="cpPreview"></div>
      <button type="button" class="upload-btn ghost cp-eyedrop-btn" id="cpEyedropBtn">${EYEDROP_ICON} Preleva colore dalla foto</button>
      <div class="color-popover-row">
        <label>Tonalit&agrave;</label>
        <input type="range" id="cpHue" min="0" max="360" step="1" />
      </div>
      <div class="color-popover-row">
        <label>Saturazione</label>
        <input type="range" id="cpSat" min="0" max="100" step="1" />
      </div>
      <div class="color-popover-row">
        <label>Luminosit&agrave;</label>
        <input type="range" id="cpLight" min="0" max="100" step="1" />
      </div>
      <div class="color-popover-row">
        <label>Hex</label>
        <input type="text" id="cpHex" maxlength="7" />
      </div>
      <button type="button" class="upload-btn" id="cpDoneBtn">Fatto</button>
    `;

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
    colorPopoverEl = backdrop;
    notifyColorPopoverState(true);

    const preview = sheet.querySelector("#cpPreview");
    const hueEl = sheet.querySelector("#cpHue");
    const satEl = sheet.querySelector("#cpSat");
    const lightEl = sheet.querySelector("#cpLight");
    const hexEl = sheet.querySelector("#cpHex");

    let current = { h: hsl.h, s: hsl.s, l: hsl.l };

    function applyBackgrounds() {
      hueEl.style.background = "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";
      satEl.style.background = `linear-gradient(to right, hsl(${current.h},0%,${current.l}%), hsl(${current.h},100%,${current.l}%))`;
      lightEl.style.background = `linear-gradient(to right, #000, hsl(${current.h},${current.s}%,50%), #fff)`;
    }

    function refresh(fromHex) {
      const hex = hslToHex(current.h, current.s, current.l);
      preview.style.background = hex;
      if (!fromHex) hexEl.value = hex;
      hueEl.value = Math.round(current.h);
      satEl.value = Math.round(current.s);
      lightEl.value = Math.round(current.l);
      applyBackgrounds();
      setColorValue(anchorEl, hex);
      onChange(hex);
    }

    hueEl.addEventListener("input", () => { current.h = Number(hueEl.value); refresh(); });
    satEl.addEventListener("input", () => { current.s = Number(satEl.value); refresh(); });
    lightEl.addEventListener("input", () => { current.l = Number(lightEl.value); refresh(); });
    hexEl.addEventListener("input", () => {
      const v = hexEl.value.trim();
      if (/^#?[a-f\d]{6}$/i.test(v)) {
        const hex = v.startsWith("#") ? v : "#" + v;
        current = hexToHsl(hex);
        refresh(true);
      }
    });
    sheet.querySelector("#cpDoneBtn").addEventListener("click", closeColorPopover);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeColorPopover(); });

    const eyedropBtn = sheet.querySelector("#cpEyedropBtn");
    if (eyedropBtn) {
      eyedropBtn.addEventListener("click", (e) => {
        e.preventDefault();
        closeColorPopover();
        startEyedrop((hex) => {
          setColorValue(anchorEl, hex);
          onChange(hex);
        });
      });
    }

    refresh(false);

    setTimeout(() => {
      document.addEventListener("mousedown", onColorPopoverOutside, true);
      document.addEventListener("touchstart", onColorPopoverOutside, true);
    }, 0);
  }

  function bindColor(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    setColorValue(el, el.dataset.value || "#ffffff");
    el.addEventListener("click", () => {
      openColorPopover(el, (hex) => { setter(hex); renderPreview(); });
    });
  }

  function fillFontSelect(id, selectedKey) {
    const sel = document.getElementById(id);
    sel.innerHTML = "";
    const groups = [
      { label: "Font di sistema", items: FONTS.filter((f) => !f.bundled) },
      { label: "Font inclusi nell'app", items: FONTS.filter((f) => f.bundled) },
    ];
    groups.forEach((g) => {
      if (!g.items.length) return;
      const grp = document.createElement("optgroup");
      grp.label = g.label;
      g.items.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.key;
        opt.textContent = f.label;
        opt.style.fontFamily = f.css;
        if (f.key === selectedKey) opt.selected = true;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    });
  }

  // Zoom: valore slider -100..100 -> fattore 0,5x .. 2x, con 100% esattamente al centro.
  function sliderToScale(v) { return Math.pow(2, v / 100); }
  function scaleToSlider(s) { return Math.round((Math.log(s) / Math.LN2) * 100); }
  function scaleFormatter(v) { return Math.round(sliderToScale(v) * 100) + "%"; }

  // ===========================================================================
  // MEDIA
  // ===========================================================================
  const hiddenFileInput = document.getElementById("hiddenFileInput");
  let browserPickLayer = "bg";

  function requestImage(layer) {
    if (isNative) {
      Android.pickImage(layer);
    } else {
      browserPickLayer = layer;
      hiddenFileInput.value = "";
      hiddenFileInput.click();
    }
  }

  hiddenFileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => window.onImageLoaded(browserPickLayer, reader.result, null);
    reader.readAsDataURL(file);
  });

  document.getElementById("btnUploadBg").addEventListener("click", () => requestImage("bg"));
  document.getElementById("btnCutoutOther").addEventListener("click", () => requestImage("fg-source"));

  document.getElementById("btnCutout").addEventListener("click", () => {
    // Se c'e' gia' una sessione di ritaglio attiva (mascherina in corso o gia'
    // applicata) si riapre esattamente li' invece di rifare l'analisi AI da zero.
    if (cutoutSourceCanvas && cutoutMaskCanvas) reopenCutoutEditor();
    else if (state.photoDataUrl) openCutoutEditor(state.photoDataUrl);
    else requestImage("fg-source");
  });

  // Cliccare sull'anteprima del soggetto riporta all'editor di ritaglio nello
  // stato in cui era stato lasciato, senza ricominciare.
  document.getElementById("thumbFg").addEventListener("click", () => {
    if (cutoutSourceCanvas && cutoutMaskCanvas) reopenCutoutEditor();
  });

  function clearSubject() {
    state.fg.img = null;
    state.fg.dataUrl = null;
    const thumb = document.getElementById("thumbFg");
    thumb.style.backgroundImage = "";
    thumb.innerHTML = "<span>vuoto</span>";
    // Niente piu' sessione di ritaglio da riprendere: la prossima apertura
    // deve ripartire da capo con l'analisi AI.
    cutoutSourceCanvas = null;
    cutoutMaskCanvas = null;
    cutoutMaskedSubjectCanvas = null;
    cutoutMaskOffsetPx = 0;
    cutoutOutlineWidthPx = 0;
    cutoutSmoothPx = 0;
  }

  document.getElementById("btnRemoveFg").addEventListener("click", () => {
    clearSubject();
    renderPreview();
    showToast("Soggetto rimosso");
  });

  function setBackground(dataUrl, alsoAsSource, resetSubject) {
    const img = new Image();
    img.onload = () => {
      state.bg.img = img;
      state.bg.dataUrl = dataUrl;
      if (alsoAsSource) state.photoDataUrl = dataUrl;
      if (resetSubject) clearSubject();
      const thumb = document.getElementById("thumbBg");
      thumb.style.backgroundImage = `url(${dataUrl})`;
      thumb.innerHTML = "";
      renderPreview();
    };
    img.onerror = () => showToast("Immagine non valida");
    img.src = dataUrl;
  }

  window.onImageLoaded = function (layer, dataUrl, errorMessage) {
    if (!dataUrl) {
      showToast(errorMessage || "Nessuna immagine selezionata");
      return;
    }
    if (layer === "fg-source") {
      state.photoDataUrl = dataUrl;
      clearSubject();
      if (!state.bg.img) setBackground(dataUrl, false, false);
      openCutoutEditor(dataUrl);
      return;
    }
    // Foto nuova come sfondo: il soggetto della foto precedente non ha piu' senso.
    setBackground(dataUrl, true, true);
    document.getElementById("btnSaveUpscaled").classList.add("hidden");
  };

  // ===========================================================================
  // UPSCALING AI (Real-ESRGAN on-device, solo sulla foto intera)
  // ===========================================================================
  const upscaleLoading = document.getElementById("upscaleLoading");
  const upscaleProgressFill = document.getElementById("upscaleProgressFill");
  const upscaleProgressPct = document.getElementById("upscaleProgressPct");
  const btnUpscale = document.getElementById("btnUpscale");
  const btnSaveUpscaled = document.getElementById("btnSaveUpscaled");
  const upscaleModelSelect = document.getElementById("upscaleModelSelect");
  const upscaleModelGroup = document.getElementById("upscaleModelGroup");
  let upscaleBusy = false;

  // L'opzione "Qualita' superiore" (Real-ESRGAN x4plus) esiste solo se il file del
  // modello e' stato incluso nella build nativa: se manca, la si nasconde invece di
  // far scoprire l'errore solo dopo aver premuto "Upscaling AI".
  if (isNative && Android.isQualityUpscaleModelAvailable) {
    try {
      if (!Android.isQualityUpscaleModelAvailable()) {
        const qualityOpt = upscaleModelSelect.querySelector('option[value="quality"]');
        if (qualityOpt) qualityOpt.remove();
        upscaleModelGroup.classList.add("hidden");
      }
    } catch (e) { /* in dubbio, si lascia visibile */ }
  } else if (!isNative) {
    upscaleModelGroup.classList.add("hidden");
  }

  function setUpscaleProgress(percent) {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    upscaleProgressFill.style.width = p + "%";
    upscaleProgressPct.textContent = p + "%";
  }

  // Diagnostica: backend usato dal modello (NNAPI/CPU e ms per tile), mostrato
  // nell'overlay durante l'elaborazione e nel messaggio finale.
  const upscaleLoadingLabel = document.getElementById("upscaleLoadingLabel");
  let upscaleInfoFinal = "";
  window.onUpscaleInfo = function (text, isFinal) {
    if (isFinal) {
      upscaleInfoFinal = text;
    } else if (upscaleLoadingLabel) {
      upscaleLoadingLabel.textContent = "Upscaling AI in corso\u2026 (" + text + ")";
    }
  };

  function setUpscaleBusy(busy) {
    upscaleBusy = busy;
    if (busy) {
      upscaleInfoFinal = "";
      if (upscaleLoadingLabel) upscaleLoadingLabel.textContent = "Upscaling AI in corso\u2026";
    }
    if (busy) setUpscaleProgress(0);
    upscaleLoading.classList.toggle("hidden", !busy);
    btnUpscale.disabled = busy;
    btnUpscale.textContent = busy ? "Upscaling AI in corso\u2026" : "Upscaling AI";
  }

  // Avanzamento REALE (tile completate / tile totali), riportato dal nativo mentre
  // l'inferenza e' in corso: niente barre "finte" a tempo stimato.
  window.onUpscaleProgress = function (percent) {
    setUpscaleProgress(percent);
  };

  function requestUpscale() {
    if (!state.bg.dataUrl) {
      showToast("Carica prima una foto");
      return;
    }
    if (!isNative) {
      showToast("L'Upscaling AI richiede l'app Android");
      return;
    }
    if (upscaleBusy) return;
    setUpscaleBusy(true);
    const modelId = upscaleModelSelect ? upscaleModelSelect.value : "fast";
    try {
      Android.upscaleImage(state.bg.dataUrl, modelId);
    } catch (e) {
      setUpscaleBusy(false);
      showToast("Errore: " + e);
    }
  }

  btnUpscale.addEventListener("click", requestUpscale);

  btnSaveUpscaled.addEventListener("click", () => {
    if (!state.bg.dataUrl) {
      showToast("Nessuna foto upscalata da salvare");
      return;
    }
    const fileName = "depth_wallpaper_upscaled_" + Date.now() + ".jpg";
    if (isNative) {
      Android.saveUpscaledJpeg(state.bg.dataUrl, fileName);
    } else {
      const link = document.createElement("a");
      link.href = state.bg.dataUrl;
      link.download = fileName;
      link.click();
      showToast("Immagine scaricata");
    }
  });

  // Risultato dell'upscaling: sostituisce sfondo (e sorgente per il ritaglio) con
  // la versione upscalata. Non tocca mai il soggetto gia' eventualmente ritagliato.
  window.onUpscaleResult = function (dataUrl, errorMessage) {
    setUpscaleBusy(false);
    if (!dataUrl) {
      showToast(errorMessage || "Upscaling AI non riuscito");
      return;
    }
    // Il soggetto gia' ritagliato e' stato ricavato dalla versione a bassa risoluzione:
    // dopo l'upscale non combacerebbe piu' con lo sfondo, quindi lo si elimina (insieme
    // alla sessione di ritaglio) e va rifatto dalla foto upscalata.
    const hadSubject = !!state.fg.img;
    setBackground(dataUrl, true, true);
    btnSaveUpscaled.classList.remove("hidden");
    const info = upscaleInfoFinal ? " (" + upscaleInfoFinal + ")" : "";
    showToast(hadSubject
      ? "Upscaling AI completato \u2713" + info + " Soggetto rimosso: rifallo dalla sezione Soggetto in Media"
      : "Upscaling AI completato \u2713" + info);
  };

  // ===========================================================================
  // RITAGLIO SOGGETTO
  // ===========================================================================
  const cutoutModal = document.getElementById("cutoutModal");
  const cutoutCanvas = document.getElementById("cutoutCanvas");
  const cutoutCtx = cutoutCanvas.getContext("2d");
  const cutoutLoading = document.getElementById("cutoutLoading");
  const CUTOUT_MAX_SIDE = 1400;

  // Segnala al lato Android quando l'editor di ritaglio e' aperto/chiuso: serve al
  // tasto/gesto "indietro" di sistema per sapere se deve chiudere l'editor (tornando
  // alla home) invece di far scattare il doppio-indietro-per-uscire dall'app.
  if (isNative && typeof Android.setCutoutEditorOpen === "function") {
    new MutationObserver(() => {
      Android.setCutoutEditorOpen(!cutoutModal.classList.contains("hidden"));
    }).observe(cutoutModal, { attributes: true, attributeFilter: ["class"] });
  }

  let cutoutSourceCanvas = null;
  let cutoutMaskCanvas = null;
  let cutoutMaskedSubjectCanvas = null;
  let cutoutCompositeCanvas = null; // soggetto (+ bordo adesivo) composto qui prima di finire sopra il "fantasma"
  // Opacita' del "fantasma" della foto originale mostrato nelle zone non ancora
  // selezionate (altrimenti li' c'e' solo scacchiera trasparente e non si vede
  // nulla su cui mirare col pennello o col lazo).
  const CUTOUT_GHOST_OPACITY = 0.32;
  let cutoutTool = "brush";
  let cutoutBrushSize = 30;
  let cutoutDrawing = false;
  // Modalita' di interazione col canvas: "loop" (lazo a mano libera, attivo di
  // default: si traccia un contorno grezzo intorno a quello che si vuole
  // includere e si aggancia da solo ai bordi reali) oppure "manual"
  // (pennello/gomma classici, da attivare esplicitamente per le rifiniture fini
  // che il lazo non riesce a isolare bene).
  let cutoutMode = "loop";
  let cutoutLoopPoints = null; // punti (coordinate canvas) tracciati durante il gesto, solo mentre si disegna
  let cutoutEdgeMap = null; // Float32Array w*h, mappa dei contorni (gradiente Sobel): calcolata una volta per foto e riusata a ogni lazo
  let cutoutBlobMap = null; // { labels, sizeMap, threshold }: regioni a basso contrasto interno, calcolate per foto (e per soglia) e riusate a ogni lazo
  // Operazione del lazo: "add" (aggiunge al soggetto) oppure "remove" (toglie
  // dal soggetto, cioe' lo trasforma in sfondo trasparente).
  let cutoutLoopOp = "add";
  // Parametri del lazo, tutti regolabili da slider.
  let cutoutLoopHardness = 100;      // 0-100: 100 = bordo netto, meno = bordo sfumato (feather)
  let cutoutLoopExact = false;       // true = segue esattamente il tratto, senza aggancio ai bordi
  let cutoutLoopEdgeThreshold = 60;  // soglia gradiente: piu' bassa = piu' dettaglio (piu' pezzi)
  let cutoutLoopCoverRatio = 0.5;    // quota minima di un pezzo dentro al tratto per sceglierlo
  let cutoutLoopReachPx = 40;        // sconfinamento massimo oltre la linea disegnata
  // Cronologia per "Annulla": istantanee della maschera prima di ogni modifica.
  const cutoutUndoStack = [];
  const CUTOUT_UNDO_MAX = 6;
  // Contorno ritaglio (eroderlo/dilata la maschera di N px) e bordo bianco adesivo:
  // entrambi a 0 all'apertura dell'editor, come richiesto ("sempre inizialmente centrale").
  let cutoutMaskOffsetPx = 0;
  let cutoutOutlineWidthPx = 0;
  let cutoutSmoothPx = 0;

  // Zoom/pan del canvas di ritaglio (pizzico con due dita) e mirino di precisione
  // per il pennello: vedi sezione dedicata piu' sotto.
  let cutoutZoom = 1;
  let cutoutPanX = 0;
  let cutoutPanY = 0;
  const CUTOUT_MAX_ZOOM = 6;

  function applyCutoutTransform() {
    cutoutCanvas.style.transform = `translate(${cutoutPanX}px, ${cutoutPanY}px) scale(${cutoutZoom})`;
  }

  function resetCutoutView() {
    cutoutZoom = 1;
    cutoutPanX = 0;
    cutoutPanY = 0;
    applyCutoutTransform();
    const btn = document.getElementById("cutoutZoomResetBtn");
    if (btn) btn.classList.add("hidden");
  }

  let cutoutRenderScheduled = false;
  /** Raggruppa in un solo ricalcolo per frame le tante notifiche ravvicinate che un
   *  trascinamento genera (decine di eventi touchmove): erodeDilateAlpha lavora
   *  sull'intera maschera, e ripeterlo ad ogni singolo campione e' cio' che mandava
   *  in stallo la WebView su "Contorno ritaglio" e "Bordo bianco adesivo". */
  function scheduleCutoutRender() {
    if (cutoutRenderScheduled) return;
    cutoutRenderScheduled = true;
    requestAnimationFrame(() => {
      cutoutRenderScheduled = false;
      renderCutoutPreview();
    });
  }

  function openCutoutEditor(dataUrl) {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > CUTOUT_MAX_SIDE) {
        const s = CUTOUT_MAX_SIDE / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }

      cutoutSourceCanvas = document.createElement("canvas");
      cutoutSourceCanvas.width = w;
      cutoutSourceCanvas.height = h;
      cutoutSourceCanvas.getContext("2d").drawImage(img, 0, 0, w, h);
      cutoutEdgeMap = null; // foto nuova: la mappa dei contorni va ricalcolata
      cutoutBlobMap = null;

      cutoutMaskCanvas = document.createElement("canvas");
      cutoutMaskCanvas.width = w;
      cutoutMaskCanvas.height = h;
      const mctx = cutoutMaskCanvas.getContext("2d");
      mctx.fillStyle = "#ffffff";
      mctx.fillRect(0, 0, w, h);

      cutoutCanvas.width = w;
      cutoutCanvas.height = h;

      cutoutMaskOffsetPx = 0;
      cutoutOutlineWidthPx = 0;
      cutoutSmoothPx = 0;
      setSlider("cutoutOffsetRange", 0);
      setSlider("cutoutOutlineRange", 0);
      setSlider("cutoutSmoothRange", 0);
      setCutoutMode("loop");
      resetCutoutView();
      clearCutoutUndo();

      cutoutModal.classList.remove("hidden");
      renderCutoutPreview();
      requestAiCutout();
    };
    img.onerror = () => showToast("Immagine non valida");
    img.src = dataUrl;
  }

  /** Riapre l'editor di ritaglio sulla sessione gia' in corso (mascherina, zoom
   *  ripristinato, contorno/offset gia' impostati), senza rilanciare l'AI. */
  function reopenCutoutEditor() {
    if (!cutoutSourceCanvas || !cutoutMaskCanvas) {
      if (state.photoDataUrl) openCutoutEditor(state.photoDataUrl);
      else requestImage("fg-source");
      return;
    }
    cutoutCanvas.width = cutoutSourceCanvas.width;
    cutoutCanvas.height = cutoutSourceCanvas.height;
    setSlider("cutoutOffsetRange", cutoutMaskOffsetPx);
    setSlider("cutoutOutlineRange", cutoutOutlineWidthPx);
    setSlider("cutoutSmoothRange", cutoutSmoothPx);
    setCutoutMode("loop");
    resetCutoutView();
    cutoutModal.classList.remove("hidden");
    renderCutoutPreview();
  }

  // ---------------------------------------------------------------------------
  // Contorno ritaglio ed erosione/dilatazione della maschera (via canvas 2D)
  // ---------------------------------------------------------------------------
  // Il Canvas non offre operazioni morfologiche pronte, quindi la maschera si
  // "cresce" o "restringe" con un min/max filter separabile sul canale alpha:
  // un passaggio orizzontale seguito da uno verticale con la stessa finestra
  // equivale esattamente a un min/max su un intorno quadrato di lato 2r+1.
  // radius positivo = dilata (allarga), negativo = erode (restringe).

  /** Massimo/minimo scorrevole in O(n) con una coda monotona: usato sia in
   *  orizzontale sia in verticale per far scalare bene anche foto grandi. */
  function slidingExtreme(arr, n, r, useMax) {
    const out = new Uint8ClampedArray(n);
    const dq = new Int32Array(n);
    let head = 0, tail = 0, lastAdded = -1;
    for (let j = 0; j < n; j++) {
      const iAdd = Math.min(n - 1, j + r);
      while (lastAdded < iAdd) {
        lastAdded++;
        const v = arr[lastAdded];
        while (tail > head && (useMax ? arr[dq[tail - 1]] <= v : arr[dq[tail - 1]] >= v)) tail--;
        dq[tail++] = lastAdded;
      }
      const leftBound = Math.max(0, j - r);
      while (dq[head] < leftBound) head++;
      out[j] = arr[dq[head]];
    }
    return out;
  }

  /** Restituisce una nuova maschera (bianco pieno, solo alpha variabile) cresciuta
   *  o ristretta di radiusPx pixel rispetto a maskCanvas. radiusPx = 0 -> stessa maschera. */
  function erodeDilateAlpha(maskCanvas, radiusPx) {
    const r = Math.round(radiusPx);
    if (!r) return maskCanvas;
    const useMax = r > 0;
    const rad = Math.abs(r);
    const w = maskCanvas.width, h = maskCanvas.height;
    const src = maskCanvas.getContext("2d").getImageData(0, 0, w, h).data;

    const alpha = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = src[i * 4 + 3];

    const tmp = new Uint8ClampedArray(w * h);
    const rowBuf = new Uint8ClampedArray(w);
    for (let y = 0; y < h; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) rowBuf[x] = alpha[off + x];
      tmp.set(slidingExtreme(rowBuf, w, rad, useMax), off);
    }

    const out = new Uint8ClampedArray(w * h);
    const colBuf = new Uint8ClampedArray(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) colBuf[y] = tmp[y * w + x];
      const colOut = slidingExtreme(colBuf, h, rad, useMax);
      for (let y = 0; y < h; y++) out[y * w + x] = colOut[y];
    }

    const outCanvas = document.createElement("canvas");
    outCanvas.width = w;
    outCanvas.height = h;
    const octx = outCanvas.getContext("2d");
    const outData = octx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      outData.data[i * 4] = 255;
      outData.data[i * 4 + 1] = 255;
      outData.data[i * 4 + 2] = 255;
      outData.data[i * 4 + 3] = out[i];
    }
    octx.putImageData(outData, 0, 0);
    return outCanvas;
  }

  /** Sfuma i bordi (gia' erosi/dilatati, quindi tipicamente "a scalini") di una
   *  maschera alpha: l'erosione/dilatazione usa un kernel quadrato (per essere
   *  veloce), quindi a raggi grandi i contorni escono un po' "a blocchi". Un
   *  leggero blur post-elaborazione li arrotonda senza dover rifare il filtro
   *  con un kernel circolare, molto piu' lento. */
  function smoothAlphaMask(maskCanvas, blurPx) {
    if (blurPx <= 0) return maskCanvas;
    const out = document.createElement("canvas");
    out.width = maskCanvas.width;
    out.height = maskCanvas.height;
    const octx = out.getContext("2d");
    octx.filter = `blur(${blurPx}px)`;
    octx.drawImage(maskCanvas, 0, 0);
    octx.filter = "none";
    return out;
  }

  /** Foto ritagliata con la maschera effettiva applicata, su un canvas riusato
   *  per non riallocarne uno nuovo a ogni frame durante il disegno col pennello. */
  function buildMaskedSubject(effectiveMask) {
    if (!cutoutMaskedSubjectCanvas) cutoutMaskedSubjectCanvas = document.createElement("canvas");
    const c = cutoutMaskedSubjectCanvas;
    c.width = cutoutSourceCanvas.width;
    c.height = cutoutSourceCanvas.height;
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(cutoutSourceCanvas, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(effectiveMask, 0, 0);
    g.globalCompositeOperation = "source-over";
    return c;
  }

  function requestAiCutout() {
    if (!isNative || !cutoutSourceCanvas) {
      showToast("Il ritaglio AI richiede l'app Android: usa il pennello");
      return;
    }
    setCutoutMode("loop");
    cutoutLoading.classList.remove("hidden");
    Android.cutoutSubject(cutoutSourceCanvas.toDataURL("image/jpeg", 0.92));
  }

  window.onSubjectCutout = function (maskDataUrl, errorMessage) {
    cutoutLoading.classList.add("hidden");
    if (!maskDataUrl) {
      showToast(errorMessage || "Soggetto non riconosciuto: usa il pennello");
      return;
    }
    applyCutoutMask(maskDataUrl);
  };

  function applyCutoutMask(maskDataUrl) {
    const maskImg = new Image();
    maskImg.onload = () => {
      pushCutoutUndo();
      const mctx = cutoutMaskCanvas.getContext("2d");
      mctx.clearRect(0, 0, cutoutMaskCanvas.width, cutoutMaskCanvas.height);
      mctx.drawImage(maskImg, 0, 0, cutoutMaskCanvas.width, cutoutMaskCanvas.height);
      renderCutoutPreview();
    };
    maskImg.src = maskDataUrl;
  }

  function renderCutoutPreview() {
    // Nessuna foto/maschera ancora caricata (es. i controlli vengono inizializzati
    // all'avvio, prima di aprire l'editor): niente da disegnare.
    if (!cutoutSourceCanvas || !cutoutMaskCanvas) return;
    const w = cutoutCanvas.width, h = cutoutCanvas.height;

    let effectiveMask = cutoutMaskOffsetPx
      ? erodeDilateAlpha(cutoutMaskCanvas, cutoutMaskOffsetPx)
      : cutoutMaskCanvas;
    if (cutoutSmoothPx > 0) effectiveMask = smoothAlphaMask(effectiveMask, cutoutSmoothPx);

    // Soggetto (+ eventuale bordo bianco adesivo) composti su un canvas a parte:
    // le operazioni "destination-in" qui sotto cancellerebbero il fantasma della
    // foto originale se lavorassero direttamente sul canvas visibile.
    if (!cutoutCompositeCanvas) cutoutCompositeCanvas = document.createElement("canvas");
    cutoutCompositeCanvas.width = w;
    cutoutCompositeCanvas.height = h;
    const cctx = cutoutCompositeCanvas.getContext("2d");
    cctx.clearRect(0, 0, w, h);

    if (cutoutOutlineWidthPx > 0) {
      let outlineMask = erodeDilateAlpha(effectiveMask, cutoutOutlineWidthPx);
      if (cutoutSmoothPx > 0) outlineMask = smoothAlphaMask(outlineMask, cutoutSmoothPx);
      cctx.fillStyle = "#ffffff";
      cctx.fillRect(0, 0, w, h);
      cctx.globalCompositeOperation = "destination-in";
      cctx.drawImage(outlineMask, 0, 0);
      cctx.globalCompositeOperation = "source-over";
    }
    cctx.drawImage(buildMaskedSubject(effectiveMask), 0, 0);

    // Composizione finale sul canvas visibile: prima il fantasma della foto
    // originale in trasparenza (cosi' si vede sempre dove sono le zone scartate
    // dall'AI, es. una pianta, invece della sola scacchiera vuota), poi il
    // soggetto (+ bordo) a piena opacita' sopra.
    cutoutCtx.clearRect(0, 0, w, h);
    cutoutCtx.save();
    cutoutCtx.globalAlpha = CUTOUT_GHOST_OPACITY;
    cutoutCtx.drawImage(cutoutSourceCanvas, 0, 0);
    cutoutCtx.restore();
    cutoutCtx.drawImage(cutoutCompositeCanvas, 0, 0);

    // Tratto-guida mentre si disegna il lazo: stessa canvas/stesso sistema di
    // coordinate del contenuto, quindi resta perfettamente allineato anche con
    // zoom/pan attivi (niente canvas separato da tenere sincronizzato). Si
    // vede anche il segmento (tratteggiato) che chiuderebbe il lazo se si
    // rilasciasse ora, cosi' si capisce subito che forma verra' rasterizzata.
    //
    // Stile "luminoso": alone sfumato (shadowBlur) sotto un tratto nitido quasi
    // bianco, piu' un puntino a cometa sulla punta che segue il dito - stessa
    // idea vista in altri editor di foto moderni. Tutti gli spessori/raggi sono
    // divisi per cutoutZoom, come gia' faceva il tratto originale, cosi' lo
    // spessore percepito a schermo resta costante anche disegnando zoomati.
    if (cutoutLoopPoints && cutoutLoopPoints.length > 0) {
      cutoutCtx.save();
      const scale = 1 / cutoutZoom;
      const removing = cutoutLoopOp === "remove";
      const glowColor = removing ? "rgba(255, 120, 145, 0.95)" : "rgba(180, 255, 235, 0.95)";
      const coreColor = removing ? "#fff4f6" : "#f4fffb";

      const strokePath = () => {
        cutoutCtx.beginPath();
        cutoutCtx.moveTo(cutoutLoopPoints[0].x, cutoutLoopPoints[0].y);
        for (let i = 1; i < cutoutLoopPoints.length; i++) {
          cutoutCtx.lineTo(cutoutLoopPoints[i].x, cutoutLoopPoints[i].y);
        }
        cutoutCtx.stroke();
      };

      cutoutCtx.lineJoin = "round";
      cutoutCtx.lineCap = "round";

      // Alone: tratto largo e sfumato sotto a tutto il resto.
      cutoutCtx.shadowColor = glowColor;
      cutoutCtx.shadowBlur = 16 * scale;
      cutoutCtx.strokeStyle = glowColor;
      cutoutCtx.lineWidth = Math.max(3, 5 * scale);
      strokePath();

      // Tratto nitido sopra l'alone.
      cutoutCtx.shadowBlur = 6 * scale;
      cutoutCtx.strokeStyle = coreColor;
      cutoutCtx.lineWidth = Math.max(1.8, 2.4 * scale);
      strokePath();

      // Segmento tratteggiato che anticipa la chiusura del lazo.
      if (cutoutLoopPoints.length > 1) {
        cutoutCtx.shadowBlur = 8 * scale;
        cutoutCtx.strokeStyle = removing ? "rgba(255,244,246,0.55)" : "rgba(244,255,251,0.55)";
        cutoutCtx.lineWidth = Math.max(1.2, 1.6 * scale);
        cutoutCtx.setLineDash([7 * scale, 6 * scale]);
        cutoutCtx.beginPath();
        const last = cutoutLoopPoints[cutoutLoopPoints.length - 1];
        cutoutCtx.moveTo(last.x, last.y);
        cutoutCtx.lineTo(cutoutLoopPoints[0].x, cutoutLoopPoints[0].y);
        cutoutCtx.stroke();
        cutoutCtx.setLineDash([]);
      }

      // Puntino a cometa sulla punta del tratto, dove si trova il dito ora.
      const tip = cutoutLoopPoints[cutoutLoopPoints.length - 1];
      cutoutCtx.shadowColor = glowColor;
      cutoutCtx.shadowBlur = 14 * scale;
      cutoutCtx.fillStyle = "#ffffff";
      cutoutCtx.beginPath();
      cutoutCtx.arc(tip.x, tip.y, Math.max(4, 6 * scale), 0, Math.PI * 2);
      cutoutCtx.fill();

      cutoutCtx.restore();
    }
  }

  function cutoutCanvasPoint(evt) {
    const rect = cutoutCanvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return {
      x: ((point.clientX - rect.left) / rect.width) * cutoutCanvas.width,
      y: ((point.clientY - rect.top) / rect.height) * cutoutCanvas.height,
    };
  }

  function cutoutPaintAt(x, y) {
    const mctx = cutoutMaskCanvas.getContext("2d");
    mctx.globalCompositeOperation = cutoutTool === "eraser" ? "destination-out" : "source-over";
    mctx.fillStyle = "#ffffff";
    mctx.beginPath();
    mctx.arc(x, y, cutoutBrushSize / 2, 0, Math.PI * 2);
    mctx.fill();
    mctx.globalCompositeOperation = "source-over";
    // Sincrono (non scheduleCutoutRender/rAF): la lente viene disegnata subito
    // dopo questa chiamata e deve leggere il canvas gia' aggiornato col tratto
    // appena fatto, non quello del frame precedente.
    renderCutoutPreview();
  }

  // ---------------------------------------------------------------------------
  // Lazo a mano libera: si traccia un contorno grezzo e impreciso intorno a
  // quello che si vuole includere (es. il muro con i graffiti), e al rilascio
  // il contorno si aggancia da solo agli oggetti veri dell'immagine, invece di
  // selezionare a peso morto tutto quello che sta dentro il tratto disegnato.
  //
  // Come funziona: l'immagine viene divisa una volta sola (per foto, come la
  // mappa dei contorni) in regioni a basso contrasto interno ("macchie": ogni
  // pixel e' unito ai vicini il cui gradiente e' sotto soglia, con un
  // Union-Find). Una macchia e' inclusa nella selezione solo se la META' O
  // PIU' della sua superficie totale cade dentro al tratto grezzo: una scritta
  // piccola interamente dentro al tratto entra per intero (comprese le parti
  // che sporgono leggermente fuori), mentre uno sfondo ampio di cui il tratto
  // copre solo un lembo resta fuori. Cosi' un tratto disegnato attorno a una
  // scritta prende la scritta e non anche lo sfondo dietro. Limite di fondo:
  // se il tratto include davvero PIU' della meta' di un sia pure oggetto
  // indesiderato (es. lo sfondo intorno a un piccolo soggetto), quello resta
  // dentro; l'eventuale eccesso si toglie col pennello/gomma manuale.
  // ---------------------------------------------------------------------------
  // Valori di default (regolabili da slider, vedi cutoutLoop* sopra):
  //  - soglia di gradiente sopra la quale si considera un bordo vero: 60
  //  - quota minima (sulla superficie TOTALE della macchia) dentro al tratto: 50%
  //  - sconfinamento massimo oltre il tratto disegnato: 40 px
  const LOOP_FEATHER_MAX_PX = 12; // sfumatura massima del bordo con durezza lazo = 0

  /** Mappa dei contorni (intensita' del bordo per ogni pixel, via gradiente
   *  Sobel su scala di grigi) calcolata una sola volta per foto e riusata a
   *  ogni lazo: e' il costo computazionale principale dello strumento, quindi
   *  conviene calcolarla una volta sola invece che a ogni gesto. */
  function ensureCutoutEdgeMap() {
    if (cutoutEdgeMap) return cutoutEdgeMap;
    const w = cutoutSourceCanvas.width, h = cutoutSourceCanvas.height;
    const src = cutoutSourceCanvas.getContext("2d").getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      gray[i] = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
    }
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1]
          + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
          + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        mag[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    cutoutEdgeMap = mag;
    return mag;
  }

  /** Divide l'immagine (una volta per foto) in "macchie": regioni di pixel
   *  reciprocamente raggiungibili senza mai attraversare un bordo vero
   *  (gradiente sopra la soglia "Dettaglio bordi"). Ogni macchia e' tipicamente un
   *  oggetto o una zona di sfondo uniforme; il lazo, invece di selezionare
   *  alla cieca tutto cio' che copre, sceglie quali macchie includere in
   *  base a quanto le copre (vedi runLoopSelection). Union-Find con path
   *  compression: costo lineare nel numero di pixel, come la mappa dei
   *  contorni con cui condivide la cache. */
  function ensureCutoutBlobMap() {
    if (cutoutBlobMap && cutoutBlobMap.threshold === cutoutLoopEdgeThreshold) return cutoutBlobMap;
    const threshold = cutoutLoopEdgeThreshold;
    const w = cutoutSourceCanvas.width, h = cutoutSourceCanvas.height;
    const edgeMap = ensureCutoutEdgeMap();
    const n = w * h;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      a = find(a); b = find(b);
      if (a !== b) parent[a] = b;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x < w - 1 && Math.max(edgeMap[i], edgeMap[i + 1]) <= threshold) union(i, i + 1);
        if (y < h - 1 && Math.max(edgeMap[i], edgeMap[i + w]) <= threshold) union(i, i + w);
      }
    }
    const labels = new Int32Array(n);
    const sizeMap = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      labels[i] = r;
      sizeMap.set(r, (sizeMap.get(r) || 0) + 1);
    }
    cutoutBlobMap = { labels, sizeMap, threshold };
    return cutoutBlobMap;
  }

  // ---- Annulla -------------------------------------------------------------
  const cutoutUndoBtn = document.getElementById("cutoutUndoBtn");
  function updateCutoutUndoBtn() {
    if (cutoutUndoBtn) cutoutUndoBtn.disabled = cutoutUndoStack.length === 0;
  }
  /** Salva la maschera attuale prima di una modifica, per poterla annullare. */
  function pushCutoutUndo() {
    if (!cutoutMaskCanvas) return;
    const w = cutoutMaskCanvas.width, h = cutoutMaskCanvas.height;
    cutoutUndoStack.push(cutoutMaskCanvas.getContext("2d").getImageData(0, 0, w, h));
    if (cutoutUndoStack.length > CUTOUT_UNDO_MAX) cutoutUndoStack.shift();
    updateCutoutUndoBtn();
  }
  function clearCutoutUndo() {
    cutoutUndoStack.length = 0;
    updateCutoutUndoBtn();
  }
  function cutoutUndo() {
    if (!cutoutMaskCanvas || cutoutUndoStack.length === 0) return;
    const snap = cutoutUndoStack.pop();
    cutoutMaskCanvas.getContext("2d").putImageData(snap, 0, 0);
    updateCutoutUndoBtn();
    renderCutoutPreview();
  }

  function runLoopSelection(points) {
    if (!cutoutSourceCanvas || !cutoutMaskCanvas || points.length < 3) return;
    const w = cutoutSourceCanvas.width, h = cutoutSourceCanvas.height;

    // Rasterizza il lazo grezzo con l'API Canvas: gestisce da sola poligoni
    // irregolari/autointersecanti, molto piu' robusto di uno scanline scritto
    // a mano per un tratto disegnato a mano libera.
    const roughCanvas = document.createElement("canvas");
    roughCanvas.width = w;
    roughCanvas.height = h;
    const rctx = roughCanvas.getContext("2d");
    rctx.fillStyle = "#fff";
    rctx.beginPath();
    rctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) rctx.lineTo(points[i].x, points[i].y);
    rctx.closePath();
    rctx.fill();
    const roughAlpha = rctx.getImageData(0, 0, w, h).data;

    // Quanto il risultato puo' uscire dal tratto: poligono + fascia di
    // "Margine oltre il tratto" px tutt'intorno (piu' preciso del vecchio
    // riquadro rettangolare, che permetteva sconfinamenti anche in diagonale).
    let capAlpha = roughAlpha;
    if (cutoutLoopReachPx > 0) {
      rctx.strokeStyle = "#fff";
      rctx.lineJoin = "round";
      rctx.lineCap = "round";
      rctx.lineWidth = cutoutLoopReachPx * 2;
      rctx.stroke();
      capAlpha = rctx.getImageData(0, 0, w, h).data;
    }

    const selected = new Uint8ClampedArray(w * h); // 0-255: copertura della selezione per pixel

    if (cutoutLoopExact) {
      // Nessun aggancio: si prende esattamente il poligono disegnato.
      for (let i = 0; i < w * h; i++) selected[i] = roughAlpha[i * 4 + 3];
    } else {
      const { labels, sizeMap } = ensureCutoutBlobMap();

      // Per ogni macchia toccata dal tratto grezzo, conta quanti dei suoi pixel
      // (sulla superficie TOTALE della macchia, non solo dentro al tratto)
      // cadono dentro al tratto.
      const overlapCount = new Map();
      for (let i = 0; i < w * h; i++) {
        if (roughAlpha[i * 4 + 3] === 0) continue;
        const lb = labels[i];
        overlapCount.set(lb, (overlapCount.get(lb) || 0) + 1);
      }
      const includedBlobs = new Set();
      overlapCount.forEach((count, lb) => {
        if (count / sizeMap.get(lb) >= cutoutLoopCoverRatio) includedBlobs.add(lb);
      });

      for (let i = 0; i < w * h; i++) {
        if (capAlpha[i * 4 + 3] === 0) continue;
        if (includedBlobs.has(labels[i])) selected[i] = 255;
      }
    }

    pushCutoutUndo();

    // La selezione diventa un'immagine bianca con alpha = copertura, cosi' si
    // puo' sfumare (durezza < 100) e poi aggiungere o togliere dalla maschera
    // con le normali operazioni di composizione del canvas.
    const selCanvas = document.createElement("canvas");
    selCanvas.width = w;
    selCanvas.height = h;
    const sctx = selCanvas.getContext("2d");
    const selData = sctx.createImageData(w, h);
    const sd = selData.data;
    for (let i = 0; i < selected.length; i++) {
      const a = selected[i];
      if (!a) continue;
      const o = i * 4;
      sd[o] = 255; sd[o + 1] = 255; sd[o + 2] = 255; sd[o + 3] = a;
    }
    sctx.putImageData(selData, 0, 0);

    let finalSel = selCanvas;
    const featherPx = ((100 - cutoutLoopHardness) / 100) * LOOP_FEATHER_MAX_PX;
    if (featherPx > 0.25) {
      finalSel = document.createElement("canvas");
  
