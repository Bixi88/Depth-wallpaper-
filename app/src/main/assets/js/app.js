(function () {
  "use strict";

  // ===========================================================================
  // COSTANTI
  // ===========================================================================
  const CANVAS_W = 1080;
  const CANVAS_H = 1920;

  const FONTS = [
    { key: "sans", label: "Sans (Roboto)", css: "sans-serif" },
    { key: "sansLight", label: "Sans Light", css: "sans-serif-light, sans-serif" },
    { key: "sansMedium", label: "Sans Medium", css: "sans-serif-medium, sans-serif" },
    { key: "sansBlack", label: "Sans Black", css: "sans-serif-black, sans-serif" },
    { key: "sansThin", label: "Sans Thin", css: "sans-serif-thin, sans-serif" },
    { key: "condensed", label: "Condensed", css: "sans-serif-condensed, 'Arial Narrow', sans-serif" },
    { key: "condensedLight", label: "Condensed Light", css: "sans-serif-condensed-light, sans-serif-condensed, sans-serif" },
    { key: "smallcaps", label: "Maiuscoletto", css: "sans-serif-smallcaps, sans-serif" },
    { key: "serif", label: "Serif", css: "serif" },
    { key: "monospace", label: "Monospace", css: "monospace" },
    { key: "cursive", label: "Corsivo decorativo", css: "cursive" },
  ];

  function fontCss(key) {
    const f = FONTS.find((x) => x.key === key);
    return f ? f.css : "sans-serif";
  }

  function defaultStyle(size, y, bold) {
    return {
      fontKey: "sans",
      bold: !!bold,
      italic: false,
      size: size,
      color: "#ffffff",
      opacity: 1,
      x: 0.5,
      y: y,
      stretchX: 1,
      stretchY: 1,
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
    switch (c.format) {
      case "24short": return h + ":" + pad2(m);
      case "12": return h12 + ":" + pad2(m);
      case "12ampm": return h12 + ":" + pad2(m) + (h < 12 ? " AM" : " PM");
      default: return pad2(h) + ":" + pad2(m);
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

  /** Disegna un livello di testo e restituisce il riquadro occupato (frazioni 0..1). */
  function drawTextLayer(context, w, h, style, text, multiline) {
    if (!text) return null;
    const k = w / CANVAS_W;
    const size = style.size * k;
    if (size <= 0) return null;

    const sx = style.stretchX > 0 ? style.stretchX : 1;
    const sy = style.stretchY > 0 ? style.stretchY : 1;
    const tracking = style.tracking * k;
    const alpha = Math.max(0, Math.min(1, style.opacity));

    context.save();
    context.globalAlpha = alpha;
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineCap = "round";
    const weight = style.bold ? "700" : "400";
    const italic = style.italic ? "italic " : "";
    context.font = `${italic}${weight} ${size}px ${fontCss(style.fontKey)}`;

    context.translate(style.x * w, style.y * h);
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
      context.shadowBlur = style.shadowBlur * k;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = style.shadowOffsetY * k;
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
      const gw = style.glowWidth * k;
      context.strokeStyle = style.glowColor;
      context.lineWidth = gw * 2;
      context.shadowColor = style.glowColor;
      context.shadowBlur = gw * 1.6;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = 0;
      drawLines(context, lines, firstY, lineHeight, tracking, "stroke");
      clearShadow(context);
    }

    // --- contorno netto ---
    if (style.outlineWidth > 0) {
      applyShadowIfPending();
      context.strokeStyle = style.outlineColor;
      context.lineWidth = style.outlineWidth * k * 2;
      drawLines(context, lines, firstY, lineHeight, tracking, "stroke");
      clearShadow(context);
    }

    // --- riempimento ---
    applyShadowIfPending();
    context.fillStyle = style.color;
    drawLines(context, lines, firstY, lineHeight, tracking, "fill");

    context.restore();

    return {
      x: style.x,
      y: style.y,
      halfW: (maxW * sx) / 2 / w,
      halfH: ((lines.length * lineHeight) * sy) / 2 / h,
    };
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
  // muove SOLO dopo un movimento chiaramente orizzontale (oltre 6px e piu'
  // orizzontale che verticale) e in modo relativo, quindi un tocco non sposta
  // nulla e lo scorrimento verticale resta libero. Ogni slider ha un pallino sul
  // valore di riferimento: toccandolo si torna li', trascinando ci si "aggancia".
  // ===========================================================================
  const sliders = {};
  const MAGNET = 0.025; // 2,5% della corsa

  function applySlider(s, rawValue, doRender) {
    const v = Math.round(Math.max(s.min, Math.min(s.max, rawValue)));
    s.input.value = v;
    if (s.setter) s.setter(v);
    if (s.badge) s.badge.textContent = s.formatter ? s.formatter(v) : String(v);
    if (doRender) renderPreview();
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

    const dot = document.createElement("button");
    dot.className = "slider-center";
    dot.type = "button";
    dot.title = "Torna al valore centrale";
    const p = (s.center - s.min) / (s.max - s.min);
    dot.style.left = `calc(10px + ${p} * (100% - 20px))`;
    dot.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applySlider(s, s.center, true);
    });
    row.appendChild(dot);

    let drag = null;

    function pointOf(evt) {
      const p = evt.touches ? evt.touches[0] : evt;
      return { x: p.clientX, y: p.clientY };
    }

    function onDown(evt) {
      if (evt.target === dot) return;
      const p = pointOf(evt);
      drag = { x: p.x, y: p.y, startVal: Number(input.value), active: false };
    }

    function onMove(evt) {
      if (!drag) return;
      const p = pointOf(evt);
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;

      if (!drag.active) {
        if (Math.abs(dy) > Math.abs(dx)) { drag = null; return; } // scorrimento verticale
        if (Math.abs(dx) < 6) return;
        drag.active = true;
        row.classList.add("dragging");
      }
      if (evt.cancelable) evt.preventDefault();

      const width = Math.max(1, input.getBoundingClientRect().width - 20);
      const span = s.max - s.min;
      let v = drag.startVal + (dx / width) * span;
      if (Math.abs(v - s.center) <= span * MAGNET) v = s.center;
      applySlider(s, v, true);
    }

    function onUp() {
      if (drag) row.classList.remove("dragging");
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

  function bindRange(rangeId, badgeId, setter, formatter) {
    const input = document.getElementById(rangeId);
    if (!input) return;
    const s = {
      input: input,
      badge: badgeId ? document.getElementById(badgeId) : null,
      setter: setter,
      formatter: formatter,
      min: Number(input.min),
      max: Number(input.max),
      center: input.dataset.center !== undefined ? Number(input.dataset.center) : Number(input.value),
    };
    sliders[rangeId] = s;
    buildSliderRow(s);
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

  function bindColor(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => { setter(el.value); renderPreview(); });
  }

  function fillFontSelect(id, selectedKey) {
    const sel = document.getElementById(id);
    sel.innerHTML = "";
    FONTS.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.key;
      opt.textContent = f.label;
      opt.style.fontFamily = f.css;
      if (f.key === selectedKey) opt.selected = true;
      sel.appendChild(opt);
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
    if (state.photoDataUrl) openCutoutEditor(state.photoDataUrl);
    else requestImage("fg-source");
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
  let cutoutTool = "brush";
  let cutoutBrushSize = 30;
  let cutoutDrawing = false;

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

      cutoutModal.classList.remove("hidden");
      renderCutoutPreview();
      requestAiCutout();
    };
    img.onerror = () => showToast("Immagine non valida");
    img.src = dataUrl;
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
    cutoutCtx.drawImage(cutoutSourceCanvas, 0, 0);
    cutoutCtx.globalCompositeOperation = "destination-in";
    cutoutCtx.drawImage(cutoutMaskCanvas, 0, 0);
    cutoutCtx.globalCompositeOperation = "source-over";
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
    renderCutoutPreview();
  }

  function cutoutPointerDown(evt) {
    if (!cutoutSourceCanvas) return;
    cutoutDrawing = true;
    const p = cutoutCanvasPoint(evt);
    cutoutPaintAt(p.x, p.y);
    evt.preventDefault();
  }
  function cutoutPointerMove(evt) {
    if (!cutoutDrawing) return;
    const p = cutoutCanvasPoint(evt);
    cutoutPaintAt(p.x, p.y);
    evt.preventDefault();
  }
  function cutoutPointerUp() { cutoutDrawing = false; }

  cutoutCanvas.addEventListener("mousedown", cutoutPointerDown);
  cutoutCanvas.addEventListener("mousemove", cutoutPointerMove);
  window.addEventListener("mouseup", cutoutPointerUp);
  cutoutCanvas.addEventListener("touchstart", cutoutPointerDown, { passive: false });
  cutoutCanvas.addEventListener("touchmove", cutoutPointerMove, { passive: false });
  cutoutCanvas.addEventListener("touchend", cutoutPointerUp);

  document.querySelectorAll(".cutout-tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cutout-tool-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      cutoutTool = btn.dataset.tool;
    });
  });

  bindRange("cutoutBrushRange", "cutoutBrushValue", (v) => { cutoutBrushSize = v; });

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
    bindRange(prefix + "StretchXRange", prefix + "StretchXValue", (v) => { st().stretchX = v / 100; }, (v) => v + "%");
    bindRange(prefix + "StretchYRange", prefix + "StretchYValue", (v) => { st().stretchY = v / 100; }, (v) => v + "%");
  }

  function syncTextLayerUi(prefix, layer) {
    const s = layer.style;
    const set = (id, prop, value) => { const el = document.getElementById(id); if (el) el[prop] = value; };
    set(prefix + "FontSelect", "value", s.fontKey);
    set(prefix + "BoldCheck", "checked", s.bold);
    set(prefix + "ItalicCheck", "checked", s.italic);
    set(prefix + "ColorPicker", "value", s.color);
    set(prefix + "OutlineColor", "value", s.outlineColor);
    set(prefix + "GlowColor", "value", s.glowColor);
    set(prefix + "PlateColor", "value", s.plateColor);
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
    setSlider(prefix + "StretchXRange", Math.round(s.stretchX * 100));
    setSlider(prefix + "StretchYRange", Math.round(s.stretchY * 100));
  }

  fillFontSelect("clockFontSelect", state.clock.style.fontKey);
  fillFontSelect("dateFontSelect", state.date.style.fontKey);
  bindTextLayer("clock", () => state.clock);
  bindTextLayer("date", () => state.date);

  // --- specifico orologio ---
  const customTextGroup = document.getElementById("customTextGroup");
  const clockFormatGroup = document.getElementById("clockFormatGroup");

  function syncClockMode() {
    const custom = state.clock.mode === "custom";
    customTextGroup.style.display = custom ? "block" : "none";
    clockFormatGroup.style.display = custom ? "none" : "block";
  }

  document.querySelectorAll("#clockModeSeg .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#clockModeSeg .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.clock.mode = btn.dataset.mode;
      syncClockMode();
      renderPreview();
    });
  });
  syncClockMode();

  document.getElementById("customTextInput").addEventListener("input", (e) => {
    state.clock.customText = e.target.value;
    renderPreview();
  });

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
    const dDate = state.date.enabled ? boxDistance(hitBoxes.date, p.xFrac, p.yFrac) : Infinity;
    const dClock = state.clock.enabled ? boxDistance(hitBoxes.clock, p.xFrac, p.yFrac) : Infinity;
    if (Math.min(dDate, dClock) > 0.06) return;
    dragTarget = dDate <= dClock ? "date" : "clock";
    dragHint.style.opacity = "0";
    evt.preventDefault();
  }

  function handlePointerMove(evt) {
    if (!dragTarget) return;
    const p = canvasPointFromEvent(evt);
    const prefix = dragTarget;
    setSlider(prefix + "XRange", Math.round(p.xFrac * 100));
    setSlider(prefix + "YRange", Math.round(p.yFrac * 100));
    renderPreview();
    evt.preventDefault();
  }

  function handlePointerUp() {
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
      color: s.color, opacity: s.opacity, x: s.x, y: s.y,
      stretchX: s.stretchX, stretchY: s.stretchY, tracking: s.tracking,
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
      }
      if (cfg.date) {
        state.date.enabled = cfg.date.enabled !== false;
        state.date.format = cfg.date.format || "full";
        state.date.uppercase = !!cfg.date.uppercase;
        if (cfg.date.style) Object.assign(state.date.style, cfg.date.style);
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
      document.getElementById("customTextInput").value = state.clock.customText;
      document.querySelectorAll("#clockModeSeg .seg-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === state.clock.mode);
      });
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
  // INIT
  // ===========================================================================
  syncTextLayerUi("clock", state.clock);
  syncTextLayerUi("date", state.date);
  syncImageUi();
  renderPreview();

  if (isNative && typeof Android.requestSavedState === "function") {
    try { Android.requestSavedState(); } catch (e) { /* ignora */ }
  }
})();
