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
    // ATTENZIONE: file demo (uso personale) - vedi nota di licenza in style.css.
    { key: "calcio", label: "Calcio (demo)", css: "'Calcio', sans-serif", bundled: true },
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

  const state = {
    bg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0, rotation: 0 },
    fg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0 },
    photoDataUrl: null,
    bgDim: 0,
    linkFgToBg: false,
    clock: { enabled: true, mode: "time", customText: "", format: "24", style: defaultStyle(150, 0.30, true) },
    date: { enabled: true, format: "full", uppercase: false, style: defaultStyle(38, 0.38, false) },
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
    const h12 = h % 12 === 0 ? 12 : h % 12;
    // Ore e minuti attaccati, senza alcun separatore (ne' ":" ne' spazio).
    switch (c.format) {
      case "24short": return h + pad2(m);
      case "12": return h12 + pad2(m);
      case "12ampm": return h12 + pad2(m) + (h < 12 ? " AM" : " PM");
      default: return pad2(h) + pad2(m);
    }
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

  function measureTracked(context, text, tracking) {
    if (!text) return 0;
    if (!tracking) return context.measureText(text).width;
    let total = 0;
    for (const ch of text) total += context.measureText(ch).width;
    return total + tracking * (text.length - 1);
  }

  function drawTrackedLine(context, text, y, tracking, mode) {
    const paint = mode === "stroke" ? context.strokeText.bind(context) : context.fillText.bind(context);
    if (!tracking) {
      context.textAlign = "center";
      paint(text, 0, y);
      return;
    }
    context.textAlign = "left";
    let x = -measureTracked(context, text, tracking) / 2;
    for (const ch of text) {
      paint(ch, x, y);
      x += context.measureText(ch).width + tracking;
    }
  }

  function drawLines(context, lines, firstY, lineHeight, tracking, mode) {
    let y = firstY;
    for (const line of lines) {
      drawTrackedLine(context, line, y, tracking, mode);
      y += lineHeight;
    }
  }

  function wrapLines(context, text, maxWidth, tracking) {
    const out = [];
    for (const raw of String(text).split("\n")) {
      const words = raw.split(" ");
      let current = "";
      for (const word of words) {
        const test = current ? current + " " + word : word;
        if (measureTracked(context, test, tracking) > maxWidth && current) {
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
  function drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, mode, strokeWidth, shadowColor, shadowBlur, shadowOffsetY) {
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
    drawLines(octx, lines, firstY, lineHeight, tracking, mode);

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
    let fadeTop = Math.max(0, Math.min(1, 1 - t));       // dove l'alpha inizia a scendere da 1
    let fadeBottom = Math.max(0, Math.min(1, 1 - t * 0.5)); // dove l'alpha arriva a 0
    if (fadeBottom <= fadeTop) fadeBottom = Math.min(1, fadeTop + 0.001);
    grad.addColorStop(0, color);
    if (fadeTop > 0) grad.addColorStop(fadeTop, color);
    grad.addColorStop(fadeBottom, hexToRgba(color, 0));
    if (fadeBottom < 1) grad.addColorStop(1, hexToRgba(color, 0));
  }

  /** Disegna un livello di testo e restituisce il riquadro occupato (frazioni 0..1). */
  function drawTextLayer(context, w, h, style, text, multiline) {
    if (!text) return null;
    const k = w / CANVAS_W;
    let size = style.size * k;
    if (size <= 0) return null;

    const sx = style.stretchX > 0 ? style.stretchX : 1;
    const sy = style.stretchY > 0 ? style.stretchY : 1;
    let tracking = style.tracking * k;
    const alpha = Math.max(0, Math.min(1, style.opacity));

    context.save();
    context.globalAlpha = alpha;
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineCap = "round";
    const weight = style.bold ? "700" : "400";
    const italic = style.italic ? "italic " : "";
    context.font = `${italic}${weight} ${size}px ${fontCss(style.fontKey)}`;

    // Adattamento automatico su una riga (orologio in modalita' "ora", data): i
    // motori di testo di WebView e di Android nativo possono misurare lo stesso
    // font a parita' di "size" con larghezze diverse. Se il testo naturale sfora
    // il canvas lo restringiamo qui in proporzione, cosi' l'anteprima nell'editor
    // e il risultato reale sul dispositivo restano sempre coerenti, qualunque sia
    // il font scelto.
    let effK = k;
    if (!multiline) {
      const naturalW = measureTracked(context, String(text), tracking) * sx;
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

    const lines = multiline ? wrapLines(context, text, (w * 0.92) / sx, tracking) : [String(text)];
    const lineHeight = size * 1.12;
    const firstY = (-(lines.length - 1) * lineHeight) / 2;

    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, measureTracked(context, line, tracking));

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
      drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, "stroke", gw * 2, style.glowColor, gw * 1.6, 0);
      context.strokeStyle = style.glowColor;
      context.lineWidth = gw * 2;
      drawLines(context, lines, firstY, lineHeight, tracking, "stroke");
    }

    // --- contorno netto ---
    if (style.outlineWidth > 0) {
      if (shadowPending) {
        drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, "stroke", style.outlineWidth * effK * 2, `rgba(0,0,0,${style.shadowOpacity})`, style.shadowBlur * effK, style.shadowOffsetY * effK);
        shadowPending = false;
      }
      context.strokeStyle = style.outlineColor;
      context.lineWidth = style.outlineWidth * effK * 2;
      drawLines(context, lines, firstY, lineHeight, tracking, "stroke");
    }

    // --- riempimento ---
    if (shadowPending) {
      drawUnifiedShadow(context, lines, firstY, lineHeight, tracking, maxW, "fill", 0, `rgba(0,0,0,${style.shadowOpacity})`, style.shadowBlur * effK, style.shadowOffsetY * effK);
      shadowPending = false;
    }
    if (style.gradient && maxW > 0) {
      const dir = style.gradientDirection || "horizontal";
      if (dir === "vertical" || dir === "fadeDown") {
        const top = firstY - lineHeight / 2;
        const bottom = firstY + (lines.length - 1) * lineHeight + lineHeight / 2;
        const grad = context.createLinearGradient(0, top, 0, bottom);
        if (dir === "fadeDown") {
          addFadeDownStops(grad, style.color, style.gradientFadeOpacity || 0);
        } else {
          grad.addColorStop(0, style.color);
          grad.addColorStop(1, style.color2);
        }
        context.fillStyle = grad;
      } else {
        const grad = context.createLinearGradient(-maxW / 2, 0, maxW / 2, 0);
        grad.addColorStop(0, style.color);
        grad.addColorStop(1, style.color2);
        context.fillStyle = grad;
      }
    } else {
      context.fillStyle = style.color;
    }
    drawLines(context, lines, firstY, lineHeight, tracking, "fill");

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

    const clockBox = state.clock.enabled
      ? drawTextLayer(context, w, h, state.clock.style, clockString(), state.clock.mode === "custom")
      : null;

    const dateBox = state.date.enabled
      ? drawTextLayer(context, w, h, state.date.style, dateString(), false)
      : null;

    if (state.fg.img) {
      const link = state.linkFgToBg;
      drawCover(
        context, state.fg.img, w, h,
        link ? state.bg.scale * state.fg.scale : state.fg.scale,
        link ? state.bg.offX + state.fg.offX : state.fg.offX,
        link ? state.bg.offY + state.fg.offY : state.fg.offY,
        link ? state.bg.rotation : 0
      );
    }

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

  // ===========================================================================
  // TOAST
  // ===========================================================================
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }

  // ===========================================================================
  // TAB
  // ===========================================================================
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      document.getElementById("tab-panels").scrollTop = 0;
    });
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

  function applySlider(s, rawValue, doRender) {
    const v = Math.round(Math.max(s.min, Math.min(s.max, rawValue)));
    s.input.value = v;
    if (s.setter) s.setter(v);
    if (s.badge) s.badge.textContent = s.formatter ? s.formatter(v) : String(v);
    paintSliderFill(s, v);
    // Con l'editor di ritaglio aperto l'anteprima principale e' nascosta sotto al
    // modal: ridisegnarla ad ogni campione di trascinamento (oltre al gia' costoso
    // ridisegno del setter dello slider stesso) raddoppiava il lavoro sul thread JS.
    // Durante il trascinamento di "Contorno ritaglio"/"Bordo bianco adesivo" questo
    // bastava a saturare il thread e bloccare l'intera WebView (persino "Applica").
    if (doRender && (!cutoutModal || cutoutModal.classList.contains("hidden"))) renderPreview();
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
      if (Math.abs(v - s.center) <= span * MAGNET) v = s.center;
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
        applySlider(s, Number(s.input.value) + delta, true);
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

  function closeColorPopover() {
    if (colorPopoverEl) {
      colorPopoverEl.remove();
      colorPopoverEl = null;
      document.removeEventListener("mousedown", onColorPopoverOutside, true);
      document.removeEventListener("touchstart", onColorPopoverOutside, true);
    }
  }

  function onColorPopoverOutside(e) {
    if (colorPopoverEl && !colorPopoverEl.contains(e.target)) closeColorPopover();
  }

  function openColorPopover(anchorEl, onChange) {
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
    state.fg.scale = 1;
    state.fg.offX = 0;
    state.fg.offY = 0;
    setSlider("fgScaleRange", 0);
    setSlider("fgXRange", 0);
    setSlider("fgYRange", 0);
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
  };

  // ===========================================================================
  // RITAGLIO SOGGETTO
  // ===========================================================================
  const cutoutModal = document.getElementById("cutoutModal");
  const cutoutCanvas = document.getElementById("cutoutCanvas");
  const cutoutCtx = cutoutCanvas.getContext("2d");
  const cutoutLoading = document.getElementById("cutoutLoading");
  const CUTOUT_MAX_SIDE = 1400;

  let cutoutSourceCanvas = null;
  let cutoutMaskCanvas = null;
  let cutoutMaskedSubjectCanvas = null;
  let cutoutTool = "brush";
  let cutoutBrushSize = 30;
  let cutoutDrawing = false;
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
      resetCutoutView();

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
    cutoutLoading.classList.remove("hidden");
    Android.cutoutSubject(cutoutSourceCanvas.toDataURL("image/jpeg", 0.92));
  }

  window.onSubjectCutout = function (maskDataUrl, errorMessage) {
    cutoutLoading.classList.add("hidden");
    if (!maskDataUrl) {
      showToast(errorMessage || "Soggetto non riconosciuto: usa il pennello");
      return;
    }
    const maskImg = new Image();
    maskImg.onload = () => {
      const mctx = cutoutMaskCanvas.getContext("2d");
      mctx.clearRect(0, 0, cutoutMaskCanvas.width, cutoutMaskCanvas.height);
      mctx.drawImage(maskImg, 0, 0, cutoutMaskCanvas.width, cutoutMaskCanvas.height);
      renderCutoutPreview();
    };
    maskImg.src = maskDataUrl;
  };

  function renderCutoutPreview() {
    cutoutCtx.clearRect(0, 0, cutoutCanvas.width, cutoutCanvas.height);

    let effectiveMask = cutoutMaskOffsetPx
      ? erodeDilateAlpha(cutoutMaskCanvas, cutoutMaskOffsetPx)
      : cutoutMaskCanvas;
    if (cutoutSmoothPx > 0) effectiveMask = smoothAlphaMask(effectiveMask, cutoutSmoothPx);

    if (cutoutOutlineWidthPx > 0) {
      let outlineMask = erodeDilateAlpha(effectiveMask, cutoutOutlineWidthPx);
      if (cutoutSmoothPx > 0) outlineMask = smoothAlphaMask(outlineMask, cutoutSmoothPx);
      cutoutCtx.fillStyle = "#ffffff";
      cutoutCtx.fillRect(0, 0, cutoutCanvas.width, cutoutCanvas.height);
      cutoutCtx.globalCompositeOperation = "destination-in";
      cutoutCtx.drawImage(outlineMask, 0, 0);
      cutoutCtx.globalCompositeOperation = "source-over";
    }

    cutoutCtx.drawImage(buildMaskedSubject(effectiveMask), 0, 0);
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
    scheduleCutoutRender();
  }

  // ---------------------------------------------------------------------------
  // Mirino di precisione: mentre disegni col pennello, il dito copre esattamente
  // il punto che stai toccando. Qui mostriamo un cerchietto ingrandito "a lente",
  // spostato sopra al dito, con al centro un mirino + il contorno reale del
  // pennello: cosi' si vede cosa si sta per cancellare/ripristinare prima di farlo.
  // ---------------------------------------------------------------------------
  const cutoutLoupe = document.getElementById("cutoutLoupe");
  const cutoutLoupeCtx = cutoutLoupe ? cutoutLoupe.getContext("2d") : null;
  const LOUPE_SIZE = 120;
  const LOUPE_ZOOM = 3;

  function showCutoutLoupe(evt, canvasPoint) {
    if (!cutoutLoupeCtx) return;
    const p = evt.touches ? evt.touches[0] : evt;
    const cropSide = LOUPE_SIZE / LOUPE_ZOOM;

    cutoutLoupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    cutoutLoupeCtx.fillStyle = "#1a1a22";
    cutoutLoupeCtx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    cutoutLoupeCtx.drawImage(
      cutoutCanvas,
      canvasPoint.x - cropSide / 2, canvasPoint.y - cropSide / 2, cropSide, cropSide,
      0, 0, LOUPE_SIZE, LOUPE_SIZE
    );

    cutoutLoupeCtx.strokeStyle = cutoutTool === "eraser" ? "#ff5470" : "#5ee6c8";
    cutoutLoupeCtx.lineWidth = 2;
    cutoutLoupeCtx.beginPath();
    cutoutLoupeCtx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, (cutoutBrushSize / 2) * LOUPE_ZOOM, 0, Math.PI * 2);
    cutoutLoupeCtx.stroke();
    cutoutLoupeCtx.beginPath();
    cutoutLoupeCtx.moveTo(LOUPE_SIZE / 2 - 8, LOUPE_SIZE / 2);
    cutoutLoupeCtx.lineTo(LOUPE_SIZE / 2 + 8, LOUPE_SIZE / 2);
    cutoutLoupeCtx.moveTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 8);
    cutoutLoupeCtx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 + 8);
    cutoutLoupeCtx.stroke();

    // Posizionata sopra al dito (in coordinate di pagina): se sei troppo vicino al
    // bordo alto dello schermo, la mostriamo sotto invece che farla uscire dallo schermo.
    const FINGER_OFFSET = 90;
    let left = p.clientX - LOUPE_SIZE / 2;
    let top = p.clientY - LOUPE_SIZE - FINGER_OFFSET;
    if (top < 8) top = p.clientY + FINGER_OFFSET;
    left = Math.max(8, Math.min(window.innerWidth - LOUPE_SIZE - 8, left));
    cutoutLoupe.style.left = left + "px";
    cutoutLoupe.style.top = top + "px";
    cutoutLoupe.classList.remove("hidden");
  }

  function hideCutoutLoupe() {
    if (cutoutLoupe) cutoutLoupe.classList.add("hidden");
  }

  // ---------------------------------------------------------------------------
  // Pizzico con due dita per zoomare/spostare il canvas (per rifinire bene i
  // bordi), un dito solo per disegnare col pennello/gomma.
  // ---------------------------------------------------------------------------
  let cutoutPinch = null;

  function touchDist(t0, t1) { return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); }
  function touchMid(t0, t1) { return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 }; }

  function cutoutPointerDown(evt) {
    if (!cutoutSourceCanvas) return;
    if (evt.touches && evt.touches.length >= 2) {
      cutoutDrawing = false;
      hideCutoutLoupe();
      const [t0, t1] = evt.touches;
      cutoutPinch = {
        startDist: touchDist(t0, t1),
        startZoom: cutoutZoom,
        startPanX: cutoutPanX,
        startPanY: cutoutPanY,
        startMid: touchMid(t0, t1),
      };
      evt.preventDefault();
      return;
    }
    cutoutDrawing = true;
    const p = cutoutCanvasPoint(evt);
    cutoutPaintAt(p.x, p.y);
    showCutoutLoupe(evt, p);
    evt.preventDefault();
  }

  function cutoutPointerMove(evt) {
    if (cutoutPinch && evt.touches && evt.touches.length >= 2) {
      const [t0, t1] = evt.touches;
      const dist = touchDist(t0, t1);
      const mid = touchMid(t0, t1);
      cutoutZoom = Math.min(CUTOUT_MAX_ZOOM, Math.max(1, cutoutPinch.startZoom * (dist / cutoutPinch.startDist)));
      cutoutPanX = cutoutPinch.startPanX + (mid.x - cutoutPinch.startMid.x);
      cutoutPanY = cutoutPinch.startPanY + (mid.y - cutoutPinch.startMid.y);
      applyCutoutTransform();
      const btn = document.getElementById("cutoutZoomResetBtn");
      if (btn) btn.classList.toggle("hidden", cutoutZoom <= 1.03);
      evt.preventDefault();
      return;
    }
    if (!cutoutDrawing) return;
    const p = cutoutCanvasPoint(evt);
    cutoutPaintAt(p.x, p.y);
    showCutoutLoupe(evt, p);
    evt.preventDefault();
  }

  function cutoutPointerUp(evt) {
    if (evt && evt.touches && evt.touches.length >= 2) return; // resta un dito nel pizzico
    cutoutPinch = null;
    cutoutDrawing = false;
    hideCutoutLoupe();
  }

  cutoutCanvas.addEventListener("mousedown", cutoutPointerDown);
  cutoutCanvas.addEventListener("mousemove", cutoutPointerMove);
  window.addEventListener("mouseup", cutoutPointerUp);
  cutoutCanvas.addEventListener("touchstart", cutoutPointerDown, { passive: false });
  cutoutCanvas.addEventListener("touchmove", cutoutPointerMove, { passive: false });
  cutoutCanvas.addEventListener("touchend", cutoutPointerUp);
  cutoutCanvas.addEventListener("touchcancel", cutoutPointerUp);

  const cutoutZoomResetBtn = document.getElementById("cutoutZoomResetBtn");
  if (cutoutZoomResetBtn) cutoutZoomResetBtn.addEventListener("click", resetCutoutView);

  document.querySelectorAll(".cutout-tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cutout-tool-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      cutoutTool = btn.dataset.tool;
    });
  });

  bindRange("cutoutBrushRange", "cutoutBrushValue", (v) => { cutoutBrushSize = v; });
  bindRange(
    "cutoutOffsetRange", "cutoutOffsetValue",
    (v) => { cutoutMaskOffsetPx = v; scheduleCutoutRender(); },
    (v) => (v > 0 ? "+" : "") + v + " px"
  );
  bindRange(
    "cutoutOutlineRange", "cutoutOutlineValue",
    (v) => { cutoutOutlineWidthPx = v; scheduleCutoutRender(); },
    (v) => v + " px"
  );
  bindRange(
    "cutoutSmoothRange", "cutoutSmoothValue",
    (v) => { cutoutSmoothPx = v; scheduleCutoutRender(); },
    (v) => v + " px"
  );

  document.getElementById("cutoutResetBtn").addEventListener("click", requestAiCutout);

  document.getElementById("cutoutClearBtn").addEventListener("click", () => {
    const mctx = cutoutMaskCanvas.getContext("2d");
    mctx.clearRect(0, 0, cutoutMaskCanvas.width, cutoutMaskCanvas.height);
    renderCutoutPreview();
  });

  document.getElementById("cutoutCancelBtn").addEventListener("click", () => {
    cutoutModal.classList.add("hidden");
  });

  document.getElementById("cutoutApplyBtn").addEventListener("click", () => {
    if (!cutoutSourceCanvas) {
      cutoutModal.classList.add("hidden");
      return;
    }
    const dataUrl = cutoutCanvas.toDataURL("image/png");
    const img = new Image();
    img.onload = () => {
      state.fg.img = img;
      state.fg.dataUrl = dataUrl;
      state.fg.scale = 1;
      state.fg.offX = 0;
      state.fg.offY = 0;
      setSlider("fgScaleRange", 0);
      setSlider("fgXRange", 0);
      setSlider("fgYRange", 0);
      const thumb = document.getElementById("thumbFg");
      thumb.style.backgroundImage = `url(${dataUrl})`;
      thumb.innerHTML = "";
      cutoutModal.classList.add("hidden");
      renderPreview();
      showToast("Soggetto applicato nella posizione originale");
    };
    img.src = dataUrl;
  });

  // ===========================================================================
  // CONTROLLI DEI LIVELLI DI TESTO (orologio e data: stessi controlli, stati separati)
  // ===========================================================================
  function bindTextLayer(prefix, getLayer) {
    const st = () => getLayer().style;

    bindSelect(prefix + "FontSelect", (v) => { st().fontKey = v; });
    bindCheck(prefix + "BoldCheck", (v) => { st().bold = v; });
    bindCheck(prefix + "ItalicCheck", (v) => { st().italic = v; });
    bindRange(prefix + "SizeRange", prefix + "SizeValue", (v) => { st().size = v; });
    bindRange(prefix + "TrackRange", prefix + "TrackValue", (v) => { st().tracking = v; });

    bindColor(prefix + "ColorPicker", (v) => { st().color = v; });
    bindColor(prefix + "Color2Picker", (v) => { st().color2 = v; });
    function syncGradientVisibility() {
      const on = !!st().gradient;
      const dir = st().gradientDirection || "horizontal";
      const dirWrap = document.getElementById(prefix + "GradientDirWrap");
      if (dirWrap) dirWrap.classList.toggle("hidden", !on);
      const color2El = document.getElementById(prefix + "Color2Picker");
      if (color2El) color2El.classList.toggle("hidden", !on || dir === "fadeDown");
      const fadeWrap = document.getElementById(prefix + "GradientFadeWrap");
      if (fadeWrap) fadeWrap.classList.toggle("hidden", !on || dir !== "fadeDown");
    }
    bindCheck(prefix + "GradientCheck", (v) => { st().gradient = v; syncGradientVisibility(); });
    bindSelect(prefix + "GradientDirSelect", (v) => { st().gradientDirection = v; syncGradientVisibility(); });
    bindRange(prefix + "GradientFadeRange", prefix + "GradientFadeValue", (v) => { st().gradientFadeOpacity = v / 100; }, (v) => v + "%");
    bindRange(prefix + "OpacityRange", prefix + "OpacityValue", (v) => { st().opacity = v / 100; }, (v) => v + "%");

    bindRange(prefix + "OutlineRange", prefix + "OutlineValue", (v) => { st().outlineWidth = v; });
    bindColor(prefix + "OutlineColor", (v) => { st().outlineColor = v; });
    bindRange(prefix + "GlowRange", prefix + "GlowValue", (v) => { st().glowWidth = v; });
    bindColor(prefix + "GlowColor", (v) => { st().glowColor = v; });
    bindRange(prefix + "ShadowRange", prefix + "ShadowValue", (v) => { st().shadowOpacity = v / 100; }, (v) => v + "%");
    bindRange(prefix + "ShadowBlurRange", prefix + "ShadowBlurValue", (v) => { st().shadowBlur = v; });
    bindRange(prefix + "ShadowOffRange", prefix + "ShadowOffValue", (v) => { st().shadowOffsetY = v; });
    bindRange(prefix + "PlateRange", prefix + "PlateValue", (v) => { st().plateOpacity = v / 100; }, (v) => v + "%");
    bindColor(prefix + "PlateColor", (v) => { st().plateColor = v; });

    bindRange(prefix + "XRange", prefix + "XValue", (v) => { st().x = v / 100; }, (v) => v + "%");
    bindRange(prefix + "YRange", prefix + "YValue", (v) => { st().y = v / 100; }, (v) => v + "%");
    bindRange(prefix + "RotationRange", prefix + "RotationValue", (v) => { st().rotation = v; }, (v) => v + "\u00B0");
    bindRange(prefix + "StretchXRange", prefix + "StretchXValue", (v) => { st().stretchX = v / 100; }, (v) => v + "%");
    bindRange(prefix + "StretchYRange", prefix + "StretchYValue", (v) => { st().stretchY = v / 100; }, (v) => v + "%");
  }

  function syncTextLayerUi(prefix, layer) {
    const s = layer.style;
    const set = (id, prop, value) => { const el = document.getElementById(id); if (el) el[prop] = value; };
    const setColor = (id, value) => { const el = document.getElementById(id); if (el) setColorValue(el, value); };
    set(prefix + "FontSelect", "value", s.fontKey);
    set(prefix + "BoldCheck", "checked", s.bold);
    set(prefix + "ItalicCheck", "checked", s.italic);
    setColor(prefix + "ColorPicker", s.color);
    setColor(prefix + "Color2Picker", s.color2);
    set(prefix + "GradientCheck", "checked", !!s.gradient);
    set(prefix + "GradientDirSelect", "value", s.gradientDirection || "horizontal");
    const dirWrapEl = document.getElementById(prefix + "GradientDirWrap");
    if (dirWrapEl) dirWrapEl.classList.toggle("hidden", !s.gradient);
    const color2El = document.getElementById(prefix + "Color2Picker");
    if (color2El) color2El.classList.toggle("hidden", !s.gradient || s.gradientDirection === "fadeDown");
    const fadeWrapEl = document.getElementById(prefix + "GradientFadeWrap");
    if (fadeWrapEl) fadeWrapEl.classList.toggle("hidden", !s.gradient || s.gradientDirection !== "fadeDown");
    setSlider(prefix + "GradientFadeRange", Math.round((s.gradientFadeOpacity || 0) * 100));
    setColor(prefix + "OutlineColor", s.outlineColor);
    setColor(prefix + "GlowColor", s.glowColor);
    setColor(prefix + "PlateColor", s.plateColor);
    setSlider(prefix + "SizeRange", s.size);
    setSlider(prefix + "TrackRange", s.tracking);
    setSlider(prefix + "OpacityRange", Math.round(s.opacity * 100));
    setSlider(prefix + "OutlineRange", s.outlineWidth);
    setSlider(prefix + "GlowRange", s.glowWidth);
    setSlider(prefix + "ShadowRange", Math.round(s.shadowOpacity * 100));
    setSlider(prefix + "ShadowBlurRange", s.shadowBlur);
    setSlider(prefix + "ShadowOffRange", s.shadowOffsetY);
    setSlider(prefix + "PlateRange", Math.round(s.plateOpacity * 100));
    setSlider(prefix + "XRange", Math.round(s.x * 100));
    setSlider(prefix + "YRange", Math.round(s.y * 100));
    setSlider(prefix + "RotationRange", Math.round(s.rotation || 0));
    setSlider(prefix + "StretchXRange", Math.round(s.stretchX * 100));
    setSlider(prefix + "StretchYRange", Math.round(s.stretchY * 100));
  }

  fillFontSelect("clockFontSelect", state.clock.style.fontKey);
  fillFontSelect("dateFontSelect", state.date.style.fontKey);
  bindTextLayer("clock", () => state.clock);
  bindTextLayer("date", () => state.date);

  // --- specifico orologio ---
  // Il "testo fisso" non e' piu' offerto in interfaccia: l'orologio mostra
  // sempre l'ora corrente. syncClockMode() resta come no-op innocuo nel caso
  // qualche configurazione salvata in precedenza avesse ancora mode:"custom".
  function syncClockMode() {
    state.clock.mode = "time";
  }
  syncClockMode();

  bindCheck("clockEnabledCheck", (v) => { state.clock.enabled = v; });
  bindSelect("clockFormatSelect", (v) => { state.clock.format = v; });

  document.getElementById("clockResetBtn").addEventListener("click", () => {
    state.clock.style = defaultStyle(150, 0.30, true);
    syncTextLayerUi("clock", state.clock);
    renderPreview();
    showToast("Orologio ripristinato");
  });

  // --- specifico data ---
  bindCheck("dateEnabledCheck", (v) => { state.date.enabled = v; });
  bindSelect("dateFormatSelect", (v) => { state.date.format = v; });
  bindCheck("dateUppercaseCheck", (v) => { state.date.uppercase = v; });

  document.getElementById("dateResetBtn").addEventListener("click", () => {
    state.date.style = defaultStyle(38, 0.38, false);
    syncTextLayerUi("date", state.date);
    renderPreview();
    showToast("Data ripristinata");
  });

  // ===========================================================================
  // SFONDO
  // ===========================================================================
  bindRange("bgScaleRange", "bgScaleValue", (v) => { state.bg.scale = sliderToScale(v); }, scaleFormatter);
  bindRange("bgXRange", "bgXValue", (v) => { state.bg.offX = v / 100; });
  bindRange("bgYRange", "bgYValue", (v) => { state.bg.offY = v / 100; });
  bindRange("bgRotationRange", "bgRotationValue", (v) => { state.bg.rotation = v; }, (v) => v + "°");
  bindRange("dimRange", "dimValue", (v) => { state.bgDim = v; }, (v) => v + "%");
  bindCheck("linkFgCheck", (v) => { state.linkFgToBg = v; });

  function quickRotate(delta) {
    let next = (state.bg.rotation + delta) % 360;
    if (next > 180) next -= 360;
    if (next < -180) next += 360;
    setSlider("bgRotationRange", next);
    renderPreview();
  }
  document.getElementById("bgRotateLeftBtn").addEventListener("click", () => quickRotate(-90));
  document.getElementById("bgRotateRightBtn").addEventListener("click", () => quickRotate(90));

  document.getElementById("bgResetBtn").addEventListener("click", () => {
    setSlider("bgScaleRange", 0);
    setSlider("bgXRange", 0);
    setSlider("bgYRange", 0);
    setSlider("bgRotationRange", 0);
    setSlider("dimRange", 0);
    renderPreview();
    showToast("Sfondo ripristinato");
  });

  // ===========================================================================
  // SOGGETTO
  // ===========================================================================
  bindRange("fgScaleRange", "fgScaleValue", (v) => { state.fg.scale = sliderToScale(v); }, scaleFormatter);
  bindRange("fgXRange", "fgXValue", (v) => { state.fg.offX = v / 100; });
  bindRange("fgYRange", "fgYValue", (v) => { state.fg.offY = v / 100; });

  document.getElementById("fgResetBtn").addEventListener("click", () => {
    setSlider("fgScaleRange", 0);
    setSlider("fgXRange", 0);
    setSlider("fgYRange", 0);
    renderPreview();
    showToast("Soggetto riportato nella posizione originale");
  });

  // ===========================================================================
  // RESET TUTTO (icona nell'header) — doppio tocco di conferma
  // ===========================================================================
  let resetAllArmed = false;
  let resetAllTimer = null;
  document.getElementById("resetAllBtn").addEventListener("click", () => {
    if (!resetAllArmed) {
      resetAllArmed = true;
      showToast("Tocca di nuovo per ripristinare tutto");
      clearTimeout(resetAllTimer);
      resetAllTimer = setTimeout(() => { resetAllArmed = false; }, 3000);
      return;
    }
    resetAllArmed = false;
    clearTimeout(resetAllTimer);

    state.clock = { enabled: true, mode: "time", customText: "", format: "24", style: defaultStyle(150, 0.30, true) };
    state.date = { enabled: true, format: "full", uppercase: false, style: defaultStyle(38, 0.38, false) };
    state.bgDim = 0;
    state.linkFgToBg = false;
    state.bg.scale = 1; state.bg.offX = 0; state.bg.offY = 0; state.bg.rotation = 0;
    clearSubject();

    document.getElementById("clockEnabledCheck").checked = true;
    document.getElementById("clockFormatSelect").value = "24";
    syncClockMode();
    document.getElementById("dateEnabledCheck").checked = true;
    document.getElementById("dateFormatSelect").value = "full";
    document.getElementById("dateUppercaseCheck").checked = false;
    document.getElementById("linkFgCheck").checked = false;

    syncTextLayerUi("clock", state.clock);
    syncTextLayerUi("date", state.date);
    syncImageUi();
    renderPreview();
    showToast("Tutto ripristinato");
  });

  function syncImageUi() {
    setSlider("bgScaleRange", scaleToSlider(state.bg.scale));
    setSlider("bgXRange", Math.round(state.bg.offX * 100));
    setSlider("bgYRange", Math.round(state.bg.offY * 100));
    setSlider("bgRotationRange", Math.round(state.bg.rotation));
    setSlider("dimRange", Math.round(state.bgDim));
    setSlider("fgScaleRange", scaleToSlider(state.fg.scale));
    setSlider("fgXRange", Math.round(state.fg.offX * 100));
    setSlider("fgYRange", Math.round(state.fg.offY * 100));
    const link = document.getElementById("linkFgCheck");
    if (link) link.checked = state.linkFgToBg;
  }

  // ===========================================================================
  // PIPETTA: copia un colore dalla foto
  // ---------------------------------------------------------------------------
  // Accanto a ogni selettore di colore compare una pipetta. Premendola, l'anteprima
  // entra in modalita' prelievo: trascinando il dito si vede in tempo reale il
  // colore sotto al punto toccato e, al rilascio, quel colore finisce nel campo che
  // ha avviato il prelievo. Il prelievo avviene su una copia dell'anteprima che
  // contiene SOLO foto e soggetto (niente orologio, data o velo scuro): altrimenti
  // si finirebbe per copiare il colore del testo invece che quello dell'immagine.
  // ===========================================================================
  const eyedropOverlay = document.getElementById("eyedropOverlay");
  const eyedropBubble = document.getElementById("eyedropBubble");
  const eyedropSwatch = document.getElementById("eyedropSwatch");
  const eyedropHex = document.getElementById("eyedropHex");

  let eyedrop = null;          // { input, btn } quando il prelievo e' attivo
  let eyedropCanvas = null;    // copia con i soli livelli immagine
  let eyedropPicking = false;
  let eyedropLastHex = null;

  function toHex(n) { return Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0"); }

  function buildEyedropSource() {
    const c = document.createElement("canvas");
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#000000";
    g.fillRect(0, 0, c.width, c.height);
    if (state.bg.img) {
      drawCover(g, state.bg.img, c.width, c.height, state.bg.scale, state.bg.offX, state.bg.offY, state.bg.rotation);
    }
    if (state.fg.img) {
      const link = state.linkFgToBg;
      drawCover(
        g, state.fg.img, c.width, c.height,
        link ? state.bg.scale * state.fg.scale : state.fg.scale,
        link ? state.bg.offX + state.fg.offX : state.fg.offX,
        link ? state.bg.offY + state.fg.offY : state.fg.offY,
        link ? state.bg.rotation : 0
      );
    }
    return c;
  }

  function sampleColorAt(xFrac, yFrac) {
    if (!eyedropCanvas) return null;
    const g = eyedropCanvas.getContext("2d", { willReadFrequently: true });
    const x = Math.min(eyedropCanvas.width - 1, Math.max(0, Math.round(xFrac * eyedropCanvas.width)));
    const y = Math.min(eyedropCanvas.height - 1, Math.max(0, Math.round(yFrac * eyedropCanvas.height)));
    try {
      // Media su un quadratino di 5x5: su una foto rumorosa il singolo pixel
      // restituirebbe un colore che a occhio non corrisponde a quello toccato.
      const r = 2;
      const x0 = Math.max(0, x - r);
      const y0 = Math.max(0, y - r);
      const w = Math.min(eyedropCanvas.width - x0, r * 2 + 1);
      const h = Math.min(eyedropCanvas.height - y0, r * 2 + 1);
      const data = g.getImageData(x0, y0, w, h).data;
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        sr += data[i] * a; sg += data[i + 1] * a; sb += data[i + 2] * a; n += a;
      }
      if (n <= 0) return "#000000";
      return "#" + toHex(sr / n) + toHex(sg / n) + toHex(sb / n);
    } catch (e) {
      return null;
    }
  }

  function startEyedrop(onCommit) {
    if (!state.bg.img) { showToast("Carica prima una foto"); return; }
    stopEyedrop();
    eyedropCanvas = buildEyedropSource();
    eyedrop = { onCommit: onCommit };
    eyedropOverlay.classList.remove("hidden");
    eyedropBubble.classList.remove("show");
    dragHint.style.opacity = "0";
  }

  function stopEyedrop() {
    eyedrop = null;
    eyedropCanvas = null;
    eyedropPicking = false;
    eyedropLastHex = null;
    eyedropOverlay.classList.add("hidden");
    eyedropBubble.classList.remove("show");
    dragHint.style.opacity = "1";
  }

  function previewEyedrop(hex) {
    if (!hex) return;
    eyedropLastHex = hex;
    eyedropBubble.classList.add("show");
    eyedropSwatch.style.background = hex;
    eyedropHex.textContent = hex.toUpperCase();
  }

  /** Applica il colore al campo che ha avviato il prelievo. */
  function commitEyedrop(hex) {
    if (!eyedrop || !hex) { stopEyedrop(); return; }
    const onCommit = eyedrop.onCommit;
    stopEyedrop();
    onCommit(hex);
    showToast("Colore copiato: " + hex.toUpperCase());
  }

  const EYEDROP_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M16.5 3.5a2.4 2.4 0 013.4 3.4l-1.9 1.9 1 1-1.6 1.6-1-1L8.6 18H5.5v-3.1l8.6-8.6-1-1L14.7 3.7l1 1z" />' +
    "</svg>";

  // Cambiando scheda il prelievo in corso si annulla: la pipetta resterebbe
  // armata mentre l'utente guarda un pannello non piu' pertinente.
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => { if (eyedrop) stopEyedrop(); }));

  // ===========================================================================
  // TRASCINAMENTO SULL'ANTEPRIMA
  // ===========================================================================
  let dragTarget = null;

  function canvasPointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return {
      xFrac: clamp01((point.clientX - rect.left) / rect.width),
      yFrac: clamp01((point.clientY - rect.top) / rect.height),
    };
  }
  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  function boxDistance(box, xFrac, yFrac) {
    if (!box) return Infinity;
    const dx = Math.max(0, Math.abs(xFrac - box.x) - Math.max(box.halfW, 0.03));
    const dy = Math.max(0, Math.abs(yFrac - box.y) - Math.max(box.halfH, 0.02));
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handlePointerDown(evt) {
    const p = canvasPointFromEvent(evt);
    if (eyedrop) {
      eyedropPicking = true;
      previewEyedrop(sampleColorAt(p.xFrac, p.yFrac));
      evt.preventDefault();
      return;
    }
    const dDate = state.date.enabled ? boxDistance(hitBoxes.date, p.xFrac, p.yFrac) : Infinity;
    const dClock = state.clock.enabled ? boxDistance(hitBoxes.clock, p.xFrac, p.yFrac) : Infinity;
    if (Math.min(dDate, dClock) > 0.06) return;
    dragTarget = dDate <= dClock ? "date" : "clock";
    dragHint.style.opacity = "0";
    evt.preventDefault();
  }

  function handlePointerMove(evt) {
    if (eyedrop) {
      if (!eyedropPicking) return;
      const q = canvasPointFromEvent(evt);
      previewEyedrop(sampleColorAt(q.xFrac, q.yFrac));
      evt.preventDefault();
      return;
    }
    if (!dragTarget) return;
    const p = canvasPointFromEvent(evt);
    const prefix = dragTarget;
    setSlider(prefix + "XRange", Math.round(p.xFrac * 100));
    setSlider(prefix + "YRange", Math.round(p.yFrac * 100));
    renderPreview();
    evt.preventDefault();
  }

  function handlePointerUp() {
    if (eyedrop) {
      if (eyedropPicking) commitEyedrop(eyedropLastHex);
      return;
    }
    dragTarget = null;
    dragHint.style.opacity = "1";
  }

  canvas.addEventListener("mousedown", handlePointerDown);
  canvas.addEventListener("mousemove", handlePointerMove);
  window.addEventListener("mouseup", handlePointerUp);
  canvas.addEventListener("touchstart", handlePointerDown, { passive: false });
  canvas.addEventListener("touchmove", handlePointerMove, { passive: false });
  canvas.addEventListener("touchend", handlePointerUp);

  // ===========================================================================
  // CONFIG + AZIONI
  // ===========================================================================
  function styleJson(s) {
    return {
      fontKey: s.fontKey, bold: s.bold, italic: s.italic, size: s.size,
      color: s.color, gradient: s.gradient, gradientDirection: s.gradientDirection || "horizontal", gradientFadeOpacity: s.gradientFadeOpacity || 0, color2: s.color2, opacity: s.opacity, x: s.x, y: s.y,
      stretchX: s.stretchX, stretchY: s.stretchY, rotation: s.rotation || 0, tracking: s.tracking,
      outlineWidth: s.outlineWidth, outlineColor: s.outlineColor,
      glowWidth: s.glowWidth, glowColor: s.glowColor,
      shadowOpacity: s.shadowOpacity, shadowBlur: s.shadowBlur, shadowOffsetY: s.shadowOffsetY,
      plateOpacity: s.plateOpacity, plateColor: s.plateColor,
    };
  }

  function buildConfig() {
    return {
      version: 3,
      clock: {
        enabled: state.clock.enabled,
        mode: state.clock.mode,
        customText: state.clock.customText,
        format: state.clock.format,
        style: styleJson(state.clock.style),
      },
      date: {
        enabled: state.date.enabled,
        format: state.date.format,
        uppercase: state.date.uppercase,
        style: styleJson(state.date.style),
      },
      bgDim: state.bgDim,
      bgScale: state.bg.scale,
      bgOffX: state.bg.offX,
      bgOffY: state.bg.offY,
      bgRotation: state.bg.rotation,
      fgScale: state.fg.scale,
      fgOffX: state.fg.offX,
      fgOffY: state.fg.offY,
      linkFgToBg: state.linkFgToBg,
    };
  }

  document.getElementById("applyLiveBtn").addEventListener("click", () => {
    if (!state.bg.img || !state.bg.dataUrl) {
      showToast("Carica prima una foto");
      return;
    }
    if (!isNative) {
      showToast("Lo sfondo animato richiede l'app Android");
      return;
    }
    try {
      Android.applyLiveWallpaper(JSON.stringify(buildConfig()), state.bg.dataUrl, state.fg.dataUrl || null);
    } catch (e) {
      showToast("Errore: " + e);
    }
  });

  document.getElementById("exportPngBtn").addEventListener("click", () => {
    if (!state.bg.img) {
      showToast("Carica prima una foto");
      return;
    }
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_W;
    exportCanvas.height = CANVAS_H;
    render(exportCanvas.getContext("2d"), exportCanvas.width, exportCanvas.height);
    const dataUrl = exportCanvas.toDataURL("image/png");
    const fileName = "depth_wallpaper_" + Date.now() + ".png";

    if (isNative) {
      Android.saveImage(dataUrl, fileName);
    } else {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName;
      link.click();
      showToast("Immagine scaricata");
    }
  });

  window.onImageSaved = function (success) {
    showToast(success ? "Salvato in Galleria \u2713" : "Errore durante il salvataggio");
  };

  // ===========================================================================
  // RIPRISTINO SESSIONE
  // ===========================================================================
  function applyConfig(cfg) {
    if (!cfg) return;
    try {
      if (cfg.clock) {
        state.clock.enabled = cfg.clock.enabled !== false;
        state.clock.mode = cfg.clock.mode || "time";
        state.clock.customText = cfg.clock.customText || "";
        state.clock.format = cfg.clock.format || "24";
        if (cfg.clock.style) Object.assign(state.clock.style, cfg.clock.style);
        state.clock.style.fontKey = normalizeFontKey(state.clock.style.fontKey);
      }
      if (cfg.date) {
        state.date.enabled = cfg.date.enabled !== false;
        state.date.format = cfg.date.format || "full";
        state.date.uppercase = !!cfg.date.uppercase;
        if (cfg.date.style) Object.assign(state.date.style, cfg.date.style);
        state.date.style.fontKey = normalizeFontKey(state.date.style.fontKey);
      }
      state.bgDim = Number(cfg.bgDim) || 0;
      state.bg.scale = Number(cfg.bgScale) || 1;
      state.bg.offX = Number(cfg.bgOffX) || 0;
      state.bg.offY = Number(cfg.bgOffY) || 0;
      state.bg.rotation = Number(cfg.bgRotation) || 0;
      state.fg.scale = Number(cfg.fgScale) || 1;
      state.fg.offX = Number(cfg.fgOffX) || 0;
      state.fg.offY = Number(cfg.fgOffY) || 0;
      state.linkFgToBg = !!cfg.linkFgToBg;

      document.getElementById("clockEnabledCheck").checked = state.clock.enabled;
      document.getElementById("clockFormatSelect").value = state.clock.format;
      // Una configurazione salvata in precedenza potrebbe avere mode:"custom":
      // l'interfaccia non lo offre piu', quindi si ricade sempre sull'ora corrente.
      syncClockMode();
      document.getElementById("dateEnabledCheck").checked = state.date.enabled;
      document.getElementById("dateFormatSelect").value = state.date.format;
      document.getElementById("dateUppercaseCheck").checked = state.date.uppercase;

      syncTextLayerUi("clock", state.clock);
      syncTextLayerUi("date", state.date);
      syncImageUi();
    } catch (e) {
      // configurazione vecchia o incompleta: si resta sui valori attuali
    }
  }

  window.onRestoreState = function (configJson, bgDataUrl, fgDataUrl) {
    try {
      if (configJson) applyConfig(JSON.parse(configJson));
    } catch (e) { /* ignora */ }

    if (bgDataUrl) {
      state.photoDataUrl = bgDataUrl;
      setBackground(bgDataUrl, false, false);
    }
    if (fgDataUrl) {
      const img = new Image();
      img.onload = () => {
        state.fg.img = img;
        state.fg.dataUrl = fgDataUrl;
        const thumb = document.getElementById("thumbFg");
        thumb.style.backgroundImage = `url(${fgDataUrl})`;
        thumb.innerHTML = "";
        renderPreview();
      };
      img.src = fgDataUrl;
    }
    renderPreview();
  };

  // ===========================================================================
  // PROPORZIONI DELL'ANTEPRIMA = PROPORZIONI DELLO SCHERMO
  // ---------------------------------------------------------------------------
  // L'anteprima era fissa a 1080x1920 (9:16), mentre gli schermi reali sono molto
  // piu' allungati (20:9 e oltre). Il testo viene dimensionato rispetto alla
  // larghezza, quindi sullo sfondo vero restava alto uguale ma, su un'immagine
  // molto piu' alta, sembrava piu' piccolo e finiva in un punto diverso.
  // Qui l'anteprima prende le proporzioni dello schermo: quello che si vede e'
  // quello che si ottiene, sia come sfondo animato sia come PNG esportato.
  // ===========================================================================
  function applyScreenAspect() {
    let w = 0;
    let h = 0;
    if (isNative && typeof Android.getScreenMetrics === "function") {
      try {
        const m = JSON.parse(Android.getScreenMetrics() || "{}");
        w = Number(m.width) || 0;
        h = Number(m.height) || 0;
      } catch (e) { /* si usa il ripiego qui sotto */ }
    }
    if (!(w > 0 && h > 0) && window.screen) {
      w = Math.min(window.screen.width, window.screen.height);
      h = Math.max(window.screen.width, window.screen.height);
    }
    if (!(w > 0 && h > 0)) return;

    const ratio = Math.min(2.6, Math.max(1.3, h / w));
    CANVAS_H = Math.round(CANVAS_W * ratio);
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const frame = document.getElementById("canvas-frame");
    if (frame) frame.style.aspectRatio = CANVAS_W + " / " + CANVAS_H;
  }

  // ===========================================================================
  // INIT
  // ===========================================================================
  applyScreenAspect();
  syncTextLayerUi("clock", state.clock);
  syncTextLayerUi("date", state.date);
  syncImageUi();
  renderPreview();

  // I font inclusi arrivano dopo il primo frame: ridisegna appena sono pronti.
  bundledFontsReady.then(() => { renderPreview(); });

  if (isNative && typeof Android.requestSavedState === "function") {
    try { Android.requestSavedState(); } catch (e) { /* ignora */ }
  }
})();
