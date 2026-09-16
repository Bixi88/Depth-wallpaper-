(function () {
  "use strict";

  // ===========================================================================
  // COSTANTI
  // ===========================================================================
  const CANVAS_W = 1080;
  const CANVAS_H = 1920;

  // Font disponibili. Le chiavi sono le stesse usate lato Kotlin
  // (DepthRenderer.typefaceFor): l'anteprima e lo sfondo animato usano quindi
  // lo stesso carattere di sistema Android.
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
      shadow: true,
    };
  }

  const state = {
    bg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0, rotation: 0 },
    fg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0 },
    photoDataUrl: null, // foto sorgente per il ritaglio del soggetto
    bgDim: 0,
    clock: {
      enabled: true,
      mode: "time", // "time" | "custom"
      customText: "",
      format: "24",
      style: defaultStyle(150, 0.30, true),
    },
    date: {
      enabled: true,
      format: "full",
      uppercase: false,
      style: defaultStyle(38, 0.38, false),
    },
  };

  const isNative = typeof Android !== "undefined" && Android !== null;

  const canvas = document.getElementById("mainCanvas");
  const ctx = canvas.getContext("2d");
  const emptyState = document.getElementById("emptyState");
  const dragHint = document.getElementById("dragHint");

  // Riquadri occupati dall'ultimo disegno: servono per il trascinamento sull'anteprima.
  const hitBoxes = { clock: null, date: null };

  // ===========================================================================
  // RENDERING IMMAGINI
  // ===========================================================================

  /**
   * Geometria "cover" condivisa da sfondo e soggetto. Poiche' il PNG del ritaglio
   * conserva l'inquadratura completa della foto, usare la stessa geometria significa
   * che il soggetto ricade esattamente dove si trovava nella foto originale.
   */
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
  // RENDERING TESTO (orologio e data: stessa funzione, stati separati)
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
      case "fullYear":
        s = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        break;
      case "dayMonth":
        s = now.toLocaleDateString("it-IT", { day: "numeric", month: "long" });
        break;
      case "short":
        s = now.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
        break;
      case "numeric":
        s = now.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
        break;
      case "weekday":
        s = now.toLocaleDateString("it-IT", { weekday: "long" });
        break;
      default:
        s = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
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

  function drawTracked(context, text, y, tracking) {
    if (!tracking) {
      context.textAlign = "center";
      context.fillText(text, 0, y);
      return;
    }
    context.textAlign = "left";
    let x = -measureTracked(context, text, tracking) / 2;
    for (const ch of text) {
      context.fillText(ch, x, y);
      x += context.measureText(ch).width + tracking;
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

  /** Disegna un livello di testo e restituisce il suo riquadro (in frazioni 0..1). */
  function drawTextLayer(context, w, h, style, text, multiline) {
    if (!text) return null;
    const k = w / CANVAS_W;
    const size = style.size * k;
    if (size <= 0) return null;

    const sx = style.stretchX > 0 ? style.stretchX : 1;
    const sy = style.stretchY > 0 ? style.stretchY : 1;
    const tracking = style.tracking * k;

    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, style.opacity));
    context.fillStyle = style.color;
    context.textBaseline = "middle";
    if (style.shadow) {
      context.shadowColor = "rgba(0,0,0,0.45)";
      context.shadowBlur = size * 0.10;
      context.shadowOffsetY = size * 0.03;
    }
    const weight = style.bold ? "700" : "400";
    const italic = style.italic ? "italic " : "";
    context.font = `${italic}${weight} ${size}px ${fontCss(style.fontKey)}`;

    context.translate(style.x * w, style.y * h);
    context.scale(sx, sy);

    let boxW = 0;
    let boxH = size * 1.2;

    if (multiline) {
      const maxWidth = (w * 0.92) / sx;
      const lines = wrapLines(context, text, maxWidth, tracking);
      const lineHeight = size * 1.12;
      let lineY = (-(lines.length - 1) * lineHeight) / 2;
      for (const line of lines) {
        drawTracked(context, line, lineY, tracking);
        boxW = Math.max(boxW, measureTracked(context, line, tracking));
        lineY += lineHeight;
      }
      boxH = lines.length * lineHeight;
    } else {
      drawTracked(context, text, 0, tracking);
      boxW = measureTracked(context, text, tracking);
    }

    context.restore();

    return {
      x: style.x,
      y: style.y,
      halfW: (boxW * sx) / 2 / w,
      halfH: (boxH * sy) / 2 / h,
    };
  }

  // ===========================================================================
  // RENDER COMPLETO
  // ===========================================================================
  function render(context, w, h) {
    context.clearRect(0, 0, w, h);
    context.fillStyle = "#000000";
    context.fillRect(0, 0, w, h);

    // Livello 0: sfondo
    if (state.bg.img) {
      drawCover(context, state.bg.img, w, h, state.bg.scale, state.bg.offX, state.bg.offY, state.bg.rotation);
    }

    if (state.bgDim > 0) {
      context.fillStyle = `rgba(0,0,0,${(state.bgDim / 100) * 0.75})`;
      context.fillRect(0, 0, w, h);
    }

    // Livello 1: orologio
    const clockBox = state.clock.enabled
      ? drawTextLayer(context, w, h, state.clock.style, clockString(), state.clock.mode === "custom")
      : null;

    // Livello 1b: data
    const dateBox = state.date.enabled
      ? drawTextLayer(context, w, h, state.date.style, dateString(), false)
      : null;

    // Livello 2: soggetto, esattamente dov'era nella foto (piu' eventuali scostamenti)
    if (state.fg.img) {
      drawCover(
        context,
        state.fg.img,
        w,
        h,
        state.bg.scale * state.fg.scale,
        state.bg.offX + state.fg.offX,
        state.bg.offY + state.fg.offY,
        state.bg.rotation
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
  // HELPER CONTROLLI
  // ===========================================================================
  function bindRange(rangeId, badgeId, setter, formatter) {
    const range = document.getElementById(rangeId);
    const badge = document.getElementById(badgeId);
    range.addEventListener("input", () => {
      const v = Number(range.value);
      setter(v);
      if (badge) badge.textContent = formatter ? formatter(v) : v;
      renderPreview();
    });
  }

  function setRange(rangeId, badgeId, value, formatter) {
    const range = document.getElementById(rangeId);
    if (range) range.value = value;
    const badge = document.getElementById(badgeId);
    if (badge) badge.textContent = formatter ? formatter(value) : value;
  }

  function bindCheck(id, setter) {
    const el = document.getElementById(id);
    el.addEventListener("change", () => { setter(el.checked); renderPreview(); });
  }

  function bindSelect(id, setter) {
    const el = document.getElementById(id);
    el.addEventListener("change", () => { setter(el.value); renderPreview(); });
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

  fillFontSelect("clockFontSelect", state.clock.style.fontKey);
  fillFontSelect("dateFontSelect", state.date.style.fontKey);

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
    if (state.photoDataUrl) {
      openCutoutEditor(state.photoDataUrl);
    } else {
      requestImage("fg-source");
    }
  });

  document.getElementById("btnRemoveFg").addEventListener("click", () => {
    state.fg.img = null;
    state.fg.dataUrl = null;
    const thumb = document.getElementById("thumbFg");
    thumb.style.backgroundImage = "";
    thumb.innerHTML = "<span>vuoto</span>";
    renderPreview();
    showToast("Soggetto rimosso");
  });

  function setBackground(dataUrl, alsoAsSource) {
    const img = new Image();
    img.onload = () => {
      state.bg.img = img;
      state.bg.dataUrl = dataUrl;
      if (alsoAsSource) state.photoDataUrl = dataUrl;
      const thumb = document.getElementById("thumbBg");
      thumb.style.backgroundImage = `url(${dataUrl})`;
      thumb.innerHTML = "";
      renderPreview();
    };
    img.onerror = () => showToast("Immagine non valida");
    img.src = dataUrl;
  }

  /** Chiamata dal lato nativo (Kotlin) quando un'immagine e' stata selezionata. */
  window.onImageLoaded = function (layer, dataUrl, errorMessage) {
    if (!dataUrl) {
      showToast(errorMessage || "Nessuna immagine selezionata");
      return;
    }
    if (layer === "fg-source") {
      state.photoDataUrl = dataUrl;
      if (!state.bg.img) setBackground(dataUrl, false);
      openCutoutEditor(dataUrl);
      return;
    }
    setBackground(dataUrl, true);
  };

  // ===========================================================================
  // RITAGLIO SOGGETTO (ML Kit on-device + pennello)
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

  document.getElementById("cutoutBrushRange").addEventListener("input", (e) => {
    cutoutBrushSize = Number(e.target.value);
    document.getElementById("cutoutBrushValue").textContent = cutoutBrushSize;
  });

  document.getElementById("cutoutResetBtn").addEventListener("click", requestAiCutout);

  document.getElementById("cutoutClearBtn").addEventListener("click", () => {
    const mctx = cutoutMaskCanvas.getContext("2d");
    mctx.clearRect(0, 0, cutoutMaskCanvas.width, cutoutMaskCanvas.height);
    renderCutoutPreview();
  });

  document.getElementById("cutoutCancelBtn").addEventListener("click", () => {
    cutoutModal.classList.add("hidden");
  });

  /**
   * Applica il ritaglio. Il PNG conserva l'INTERA inquadratura della foto (lo sfondo
   * e' semplicemente trasparente): cosi' il soggetto viene ridisegnato con la stessa
   * geometria dello sfondo e resta esattamente al suo posto, senza riposizionamenti.
   */
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
      setRange("fgScaleRange", "fgScaleValue", 100, (v) => v + "%");
      setRange("fgXRange", "fgXValue", 0);
      setRange("fgYRange", "fgYValue", 0);
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
  // TAB OROLOGIO
  // ===========================================================================
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
  bindSelect("clockFontSelect", (v) => { state.clock.style.fontKey = v; });
  bindCheck("clockBoldCheck", (v) => { state.clock.style.bold = v; });
  bindCheck("clockItalicCheck", (v) => { state.clock.style.italic = v; });
  bindCheck("clockShadowCheck", (v) => { state.clock.style.shadow = v; });
  bindRange("clockSizeRange", "clockSizeValue", (v) => { state.clock.style.size = v; });
  bindRange("clockTrackRange", "clockTrackValue", (v) => { state.clock.style.tracking = v; });
  bindRange("clockOpacityRange", "clockOpacityValue", (v) => { state.clock.style.opacity = v / 100; }, (v) => v + "%");
  bindRange("clockXRange", "clockXValue", (v) => { state.clock.style.x = v / 100; }, (v) => v + "%");
  bindRange("clockYRange", "clockYValue", (v) => { state.clock.style.y = v / 100; }, (v) => v + "%");
  bindRange("clockStretchXRange", "clockStretchXValue", (v) => { state.clock.style.stretchX = v / 100; }, (v) => v + "%");
  bindRange("clockStretchYRange", "clockStretchYValue", (v) => { state.clock.style.stretchY = v / 100; }, (v) => v + "%");
  document.getElementById("clockColorPicker").addEventListener("input", (e) => {
    state.clock.style.color = e.target.value;
    renderPreview();
  });

  document.getElementById("clockResetBtn").addEventListener("click", () => {
    state.clock.style = defaultStyle(150, 0.30, true);
    syncClockUi();
    renderPreview();
    showToast("Orologio ripristinato");
  });

  // ===========================================================================
  // TAB DATA
  // ===========================================================================
  bindCheck("dateEnabledCheck", (v) => { state.date.enabled = v; });
  bindSelect("dateFormatSelect", (v) => { state.date.format = v; });
  bindCheck("dateUppercaseCheck", (v) => { state.date.uppercase = v; });
  bindSelect("dateFontSelect", (v) => { state.date.style.fontKey = v; });
  bindCheck("dateBoldCheck", (v) => { state.date.style.bold = v; });
  bindCheck("dateItalicCheck", (v) => { state.date.style.italic = v; });
  bindCheck("dateShadowCheck", (v) => { state.date.style.shadow = v; });
  bindRange("dateSizeRange", "dateSizeValue", (v) => { state.date.style.size = v; });
  bindRange("dateTrackRange", "dateTrackValue", (v) => { state.date.style.tracking = v; });
  bindRange("dateOpacityRange", "dateOpacityValue", (v) => { state.date.style.opacity = v / 100; }, (v) => v + "%");
  bindRange("dateXRange", "dateXValue", (v) => { state.date.style.x = v / 100; }, (v) => v + "%");
  bindRange("dateYRange", "dateYValue", (v) => { state.date.style.y = v / 100; }, (v) => v + "%");
  bindRange("dateStretchXRange", "dateStretchXValue", (v) => { state.date.style.stretchX = v / 100; }, (v) => v + "%");
  bindRange("dateStretchYRange", "dateStretchYValue", (v) => { state.date.style.stretchY = v / 100; }, (v) => v + "%");
  document.getElementById("dateColorPicker").addEventListener("input", (e) => {
    state.date.style.color = e.target.value;
    renderPreview();
  });

  document.getElementById("dateResetBtn").addEventListener("click", () => {
    state.date.style = defaultStyle(38, 0.38, false);
    syncDateUi();
    renderPreview();
    showToast("Data ripristinata");
  });

  // ===========================================================================
  // TAB SFONDO
  // ===========================================================================
  bindRange("bgScaleRange", "bgScaleValue", (v) => { state.bg.scale = v / 100; }, (v) => v + "%");
  bindRange("bgXRange", "bgXValue", (v) => { state.bg.offX = v / 100; });
  bindRange("bgYRange", "bgYValue", (v) => { state.bg.offY = v / 100; });
  bindRange("bgRotationRange", "bgRotationValue", (v) => { state.bg.rotation = v; }, (v) => v + "°");
  bindRange("dimRange", "dimValue", (v) => { state.bgDim = v; }, (v) => v + "%");

  function quickRotate(delta) {
    let next = (state.bg.rotation + delta) % 360;
    if (next > 180) next -= 360;
    if (next < -180) next += 360;
    state.bg.rotation = next;
    setRange("bgRotationRange", "bgRotationValue", next, (v) => v + "°");
    renderPreview();
  }
  document.getElementById("bgRotateLeftBtn").addEventListener("click", () => quickRotate(-90));
  document.getElementById("bgRotateRightBtn").addEventListener("click", () => quickRotate(90));

  document.getElementById("bgResetBtn").addEventListener("click", () => {
    state.bg.scale = 1; state.bg.offX = 0; state.bg.offY = 0; state.bg.rotation = 0; state.bgDim = 0;
    setRange("bgScaleRange", "bgScaleValue", 100, (v) => v + "%");
    setRange("bgXRange", "bgXValue", 0);
    setRange("bgYRange", "bgYValue", 0);
    setRange("bgRotationRange", "bgRotationValue", 0, (v) => v + "°");
    setRange("dimRange", "dimValue", 0, (v) => v + "%");
    renderPreview();
    showToast("Sfondo ripristinato");
  });

  // ===========================================================================
  // TAB SOGGETTO
  // ===========================================================================
  bindRange("fgScaleRange", "fgScaleValue", (v) => { state.fg.scale = v / 100; }, (v) => v + "%");
  bindRange("fgXRange", "fgXValue", (v) => { state.fg.offX = v / 100; });
  bindRange("fgYRange", "fgYValue", (v) => { state.fg.offY = v / 100; });

  document.getElementById("fgResetBtn").addEventListener("click", () => {
    state.fg.scale = 1; state.fg.offX = 0; state.fg.offY = 0;
    setRange("fgScaleRange", "fgScaleValue", 100, (v) => v + "%");
    setRange("fgXRange", "fgXValue", 0);
    setRange("fgYRange", "fgYValue", 0);
    renderPreview();
    showToast("Soggetto riportato nella posizione originale");
  });

  // ===========================================================================
  // SINCRONIZZAZIONE UI <- STATO
  // ===========================================================================
  function syncClockUi() {
    const s = state.clock.style;
    document.getElementById("clockEnabledCheck").checked = state.clock.enabled;
    document.getElementById("clockFormatSelect").value = state.clock.format;
    document.getElementById("customTextInput").value = state.clock.customText;
    document.getElementById("clockFontSelect").value = s.fontKey;
    document.getElementById("clockBoldCheck").checked = s.bold;
    document.getElementById("clockItalicCheck").checked = s.italic;
    document.getElementById("clockShadowCheck").checked = s.shadow;
    document.getElementById("clockColorPicker").value = s.color;
    setRange("clockSizeRange", "clockSizeValue", s.size);
    setRange("clockTrackRange", "clockTrackValue", s.tracking);
    setRange("clockOpacityRange", "clockOpacityValue", Math.round(s.opacity * 100), (v) => v + "%");
    setRange("clockXRange", "clockXValue", Math.round(s.x * 100), (v) => v + "%");
    setRange("clockYRange", "clockYValue", Math.round(s.y * 100), (v) => v + "%");
    setRange("clockStretchXRange", "clockStretchXValue", Math.round(s.stretchX * 100), (v) => v + "%");
    setRange("clockStretchYRange", "clockStretchYValue", Math.round(s.stretchY * 100), (v) => v + "%");
    document.querySelectorAll("#clockModeSeg .seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === state.clock.mode);
    });
    syncClockMode();
  }

  function syncDateUi() {
    const s = state.date.style;
    document.getElementById("dateEnabledCheck").checked = state.date.enabled;
    document.getElementById("dateFormatSelect").value = state.date.format;
    document.getElementById("dateUppercaseCheck").checked = state.date.uppercase;
    document.getElementById("dateFontSelect").value = s.fontKey;
    document.getElementById("dateBoldCheck").checked = s.bold;
    document.getElementById("dateItalicCheck").checked = s.italic;
    document.getElementById("dateShadowCheck").checked = s.shadow;
    document.getElementById("dateColorPicker").value = s.color;
    setRange("dateSizeRange", "dateSizeValue", s.size);
    setRange("dateTrackRange", "dateTrackValue", s.tracking);
    setRange("dateOpacityRange", "dateOpacityValue", Math.round(s.opacity * 100), (v) => v + "%");
    setRange("dateXRange", "dateXValue", Math.round(s.x * 100), (v) => v + "%");
    setRange("dateYRange", "dateYValue", Math.round(s.y * 100), (v) => v + "%");
    setRange("dateStretchXRange", "dateStretchXValue", Math.round(s.stretchX * 100), (v) => v + "%");
    setRange("dateStretchYRange", "dateStretchYValue", Math.round(s.stretchY * 100), (v) => v + "%");
  }

  function syncImageUi() {
    setRange("bgScaleRange", "bgScaleValue", Math.round(state.bg.scale * 100), (v) => v + "%");
    setRange("bgXRange", "bgXValue", Math.round(state.bg.offX * 100));
    setRange("bgYRange", "bgYValue", Math.round(state.bg.offY * 100));
    setRange("bgRotationRange", "bgRotationValue", Math.round(state.bg.rotation), (v) => v + "°");
    setRange("dimRange", "dimValue", Math.round(state.bgDim), (v) => v + "%");
    setRange("fgScaleRange", "fgScaleValue", Math.round(state.fg.scale * 100), (v) => v + "%");
    setRange("fgXRange", "fgXValue", Math.round(state.fg.offX * 100));
    setRange("fgYRange", "fgYValue", Math.round(state.fg.offY * 100));
  }

  // ===========================================================================
  // TRASCINAMENTO DI OROLOGIO E DATA SULL'ANTEPRIMA
  // ===========================================================================
  let dragTarget = null; // "clock" | "date"

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
    const best = Math.min(dDate, dClock);
    if (best > 0.06) return; // tocco lontano da entrambi: nessun trascinamento
    dragTarget = dDate <= dClock ? "date" : "clock";
    dragHint.style.opacity = "0";
    evt.preventDefault();
  }

  function handlePointerMove(evt) {
    if (!dragTarget) return;
    const p = canvasPointFromEvent(evt);
    const style = dragTarget === "date" ? state.date.style : state.clock.style;
    style.x = p.xFrac;
    style.y = p.yFrac;
    const prefix = dragTarget === "date" ? "date" : "clock";
    setRange(prefix + "XRange", prefix + "XValue", Math.round(p.xFrac * 100), (v) => v + "%");
    setRange(prefix + "YRange", prefix + "YValue", Math.round(p.yFrac * 100), (v) => v + "%");
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
  // CONFIG JSON + AZIONI PRINCIPALI
  // ===========================================================================
  function styleJson(s) {
    return {
      fontKey: s.fontKey,
      bold: s.bold,
      italic: s.italic,
      size: s.size,
      color: s.color,
      opacity: s.opacity,
      x: s.x,
      y: s.y,
      stretchX: s.stretchX,
      stretchY: s.stretchY,
      tracking: s.tracking,
      shadow: s.shadow,
    };
  }

  function buildConfig() {
    return {
      version: 2,
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
  // RIPRISTINO DELLA SESSIONE PRECEDENTE (icona ingranaggio / riapertura app)
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
      syncClockUi();
      syncDateUi();
      syncImageUi();
    } catch (e) {
      // configurazione vecchia o incompleta: si riparte dai valori di default
    }
  }

  window.onRestoreState = function (configJson, bgDataUrl, fgDataUrl) {
    try {
      if (configJson) applyConfig(JSON.parse(configJson));
    } catch (e) { /* ignora */ }

    if (bgDataUrl) {
      state.photoDataUrl = bgDataUrl;
      setBackground(bgDataUrl, false);
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
  // INIZIALIZZAZIONE
  // ===========================================================================
  syncClockUi();
  syncDateUi();
  syncImageUi();
  renderPreview();

  if (isNative && typeof Android.requestSavedState === "function") {
    try { Android.requestSavedState(); } catch (e) { /* ignora */ }
  }
})();
