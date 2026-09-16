(function () {
  "use strict";

  // ===========================================================================
  // STATO GLOBALE
  // ===========================================================================
  // Risoluzione interna del canvas: fissa e alta, cosi' la preview e' gia'
  // alla risoluzione di export (nessun ricalcolo separato necessario).
  const CANVAS_W = 1080;
  const CANVAS_H = 1920;

  // Chiave breve -> stack CSS per la preview. Le stesse chiavi vengono mappate,
  // lato Kotlin (DepthRenderer.typefaceFor), sul Typeface di sistema più vicino:
  // questo garantisce che editor e sfondo animato usino "lo stesso font" concettuale.
  const FONT_CSS_MAP = {
    sans: "'Segoe UI', Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    monospace: "'Courier New', monospace",
    condensed: "'Arial Narrow', sans-serif-condensed, sans-serif",
  };

  const state = {
    bg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0 },
    fg: { img: null, dataUrl: null, scale: 1, offX: 0, offY: 0 },
    clock: {
      mode: "time", // "time" | "custom"
      customText: "",
      showDate: true,
      font: "sans", // chiave in FONT_CSS_MAP
      bold: true,
      size: 140, // px alla risoluzione 1080x1920
      color: "#ffffff",
      opacity: 1,
      x: 0.5, // 0..1 relativo alla larghezza
      y: 0.35, // 0..1 relativo all'altezza
    },
    bgDim: 0, // 0..100
    parallaxEnabled: true,
  };

  const isNative = typeof Android !== "undefined" && Android !== null;

  // ===========================================================================
  // RIFERIMENTI DOM
  // ===========================================================================
  const canvas = document.getElementById("mainCanvas");
  const ctx = canvas.getContext("2d");
  const emptyState = document.getElementById("emptyState");
  const dragHint = document.getElementById("dragHint");

  // ===========================================================================
  // RENDERING
  // ===========================================================================

  /** Disegna un'immagine in modalita' "cover" (riempie tutto il rettangolo). */
  function drawCover(context, img, rectW, rectH, scale, offXFrac, offYFrac) {
    const imgRatio = img.width / img.height;
    const rectRatio = rectW / rectH;

    let drawW, drawH;
    if (imgRatio > rectRatio) {
      drawH = rectH * scale;
      drawW = drawH * imgRatio;
    } else {
      drawW = rectW * scale;
      drawH = drawW / imgRatio;
    }

    const maxOffX = Math.abs(drawW - rectW) / 2 + rectW * 0.5;
    const maxOffY = Math.abs(drawH - rectH) / 2 + rectH * 0.5;

    const cx = rectW / 2 + offXFrac * maxOffX * 0.5;
    const cy = rectH / 2 + offYFrac * maxOffY * 0.5;

    context.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  }

  /** Disegna il soggetto in modalita' "contain", ancorato in basso (come un ritaglio a figura intera). */
  function drawSubjectContain(context, img, rectW, rectH, scale, offXFrac, offYFrac) {
    const imgRatio = img.width / img.height;
    let drawW = rectW * scale;
    let drawH = drawW / imgRatio;

    if (drawH > rectH * scale * 1.4) {
      drawH = rectH * scale * 1.4;
      drawW = drawH * imgRatio;
    }

    const cx = rectW / 2 + offXFrac * rectW * 0.4;
    const baseY = rectH - drawH * 0.42; // ancoraggio verso il basso, con un margine
    const cy = baseY + offYFrac * rectH * 0.3;

    context.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  }

  function formatTimeParts() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const dateStr = now.toLocaleDateString("it-IT", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return { time: `${hh}:${mm}`, date: dateStr };
  }

  function drawClockLayer(context, w, h) {
    const c = state.clock;
    context.save();
    context.globalAlpha = c.opacity;
    context.fillStyle = c.color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "rgba(0,0,0,0.35)";
    context.shadowBlur = c.size * 0.06;

    const weight = c.bold ? "700" : "400";
    const fontFamily = FONT_CSS_MAP[c.font] || FONT_CSS_MAP.sans;
    const x = c.x * w;
    const y = c.y * h;

    if (c.mode === "time") {
      const { time, date } = formatTimeParts();
      context.font = `${weight} ${c.size}px ${fontFamily}`;
      context.fillText(time, x, y);

      if (c.showDate) {
        context.font = `${weight} ${Math.round(c.size * 0.22)}px ${fontFamily}`;
        context.fillText(date, x, y + c.size * 0.62);
      }
    } else {
      const text = c.customText && c.customText.trim().length > 0 ? c.customText : "Il tuo testo";
      context.font = `${weight} ${c.size}px ${fontFamily}`;
      wrapAndDrawText(context, text, x, y, w * 0.86, c.size * 1.05);
    }

    context.restore();
  }

  function wrapAndDrawText(context, text, cx, cy, maxWidth, lineHeight) {
    const words = text.split(" ");
    const lines = [];
    let current = "";
    for (const word of words) {
      const test = current ? current + " " + word : word;
      if (context.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    const totalH = lines.length * lineHeight;
    let startY = cy - totalH / 2 + lineHeight / 2;
    for (const line of lines) {
      context.fillText(line, cx, startY);
      startY += lineHeight;
    }
  }

  /** Funzione di rendering unica: usata sia per la preview live sia per l'export ad alta risoluzione. */
  function render(context, w, h) {
    context.clearRect(0, 0, w, h);

    // Livello 0: sfondo
    context.fillStyle = "#000000";
    context.fillRect(0, 0, w, h);

    if (state.bg.img) {
      drawCover(context, state.bg.img, w, h, state.bg.scale, state.bg.offX, state.bg.offY);
    }

    if (state.bgDim > 0) {
      context.fillStyle = `rgba(0,0,0,${(state.bgDim / 100) * 0.65})`;
      context.fillRect(0, 0, w, h);
    }

    // Livello 1: orologio
    drawClockLayer(context, w, h);

    // Livello 2: soggetto ritagliato (sopra l'orologio -> effetto di profondita')
    if (state.fg.img) {
      drawSubjectContain(context, state.fg.img, w, h, state.fg.scale, state.fg.offX, state.fg.offY);
    }
  }

  function renderPreview() {
    render(ctx, CANVAS_W, CANVAS_H);
    emptyState.classList.toggle("hidden", !!state.bg.img);
  }

  let tickTimer = null;
  function ensureClockTicking() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (state.clock.mode === "time") renderPreview();
    }, 1000);
  }

  // ===========================================================================
  // TOAST
  // ===========================================================================
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ===========================================================================
  // TAB NAVIGATION
  // ===========================================================================
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ===========================================================================
  // MEDIA: upload immagini (nativo Android oppure fallback browser per test desktop)
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
    reader.onload = () => window.onImageLoaded(browserPickLayer, reader.result);
    reader.readAsDataURL(file);
  });

  document.getElementById("btnUploadBg").addEventListener("click", () => requestImage("bg"));
  document.getElementById("btnUploadFg").addEventListener("click", () => requestImage("fg"));

  /** Chiamata dal lato nativo (Kotlin) quando un'immagine e' stata selezionata e letta. */
  window.onImageLoaded = function (layer, dataUrl) {
    if (!dataUrl) {
      showToast("Nessuna immagine selezionata");
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (layer === "bg") {
        state.bg.img = img;
        state.bg.dataUrl = dataUrl;
        document.getElementById("thumbBg").style.backgroundImage = `url(${dataUrl})`;
        document.getElementById("thumbBg").innerHTML = "";
      } else {
        state.fg.img = img;
        state.fg.dataUrl = dataUrl;
        document.getElementById("thumbFg").style.backgroundImage = `url(${dataUrl})`;
        document.getElementById("thumbFg").innerHTML = "";
      }
      renderPreview();
    };
    img.onerror = () => showToast("Immagine non valida");
    img.src = dataUrl;
  };

  // ===========================================================================
  // TAB OROLOGIO: controlli
  // ===========================================================================
  const customTextGroup = document.getElementById("customTextGroup");
  const showDateGroup = document.getElementById("showDateGroup");

  document.querySelectorAll("#clockModeSeg .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#clockModeSeg .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.clock.mode = btn.dataset.mode;
      customTextGroup.style.display = state.clock.mode === "custom" ? "block" : "none";
      showDateGroup.style.display = state.clock.mode === "custom" ? "none" : "block";
      renderPreview();
    });
  });

  document.getElementById("customTextInput").addEventListener("input", (e) => {
    state.clock.customText = e.target.value;
    renderPreview();
  });

  document.getElementById("showDateCheck").addEventListener("change", (e) => {
    state.clock.showDate = e.target.checked;
    renderPreview();
  });

  document.getElementById("fontSelect").addEventListener("change", (e) => {
    state.clock.font = e.target.value;
    renderPreview();
  });

  document.getElementById("boldCheck").addEventListener("change", (e) => {
    state.clock.bold = e.target.checked;
    renderPreview();
  });

  bindRange("sizeRange", "sizeValue", (v) => { state.clock.size = v; }, (v) => v);
  bindRange("opacityRange", "opacityValue", (v) => { state.clock.opacity = v / 100; }, (v) => v + "%");
  bindRange("posXRange", "posXValue", (v) => { state.clock.x = v / 100; }, (v) => v + "%");
  bindRange("posYRange", "posYValue", (v) => { state.clock.y = v / 100; }, (v) => v + "%");

  document.getElementById("colorPicker").addEventListener("input", (e) => {
    state.clock.color = e.target.value;
    renderPreview();
  });

  // ===========================================================================
  // TAB EFFETTI: controlli
  // ===========================================================================
  bindRange("dimRange", "dimValue", (v) => { state.bgDim = v; }, (v) => v + "%");

  document.getElementById("parallaxCheck").addEventListener("change", (e) => {
    state.parallaxEnabled = e.target.checked;
  });

  bindRange("bgScaleRange", "bgScaleValue", (v) => { state.bg.scale = v / 100; }, (v) => v + "%");
  bindRange("bgXRange", "bgXValue", (v) => { state.bg.offX = v / 100; }, (v) => v);
  bindRange("bgYRange", "bgYValue", (v) => { state.bg.offY = v / 100; }, (v) => v);

  bindRange("fgScaleRange", "fgScaleValue", (v) => { state.fg.scale = v / 100; }, (v) => v + "%");
  bindRange("fgXRange", "fgXValue", (v) => { state.fg.offX = v / 100; }, (v) => v);
  bindRange("fgYRange", "fgYValue", (v) => { state.fg.offY = v / 100; }, (v) => v);

  document.getElementById("btnResetFx").addEventListener("click", () => {
    state.bg.scale = 1; state.bg.offX = 0; state.bg.offY = 0;
    state.fg.scale = 1; state.fg.offX = 0; state.fg.offY = 0;
    state.bgDim = 0;
    ["bgScaleRange:100", "bgXRange:0", "bgYRange:0", "fgScaleRange:100", "fgXRange:0", "fgYRange:0", "dimRange:0"]
      .forEach((pair) => {
        const [id, val] = pair.split(":");
        const el = document.getElementById(id);
        el.value = val;
        el.dispatchEvent(new Event("input"));
      });
    renderPreview();
  });

  /** Collega uno slider al suo badge numerico e ad un setter sullo stato. */
  function bindRange(rangeId, badgeId, setter, formatter) {
    const range = document.getElementById(rangeId);
    const badge = document.getElementById(badgeId);
    range.addEventListener("input", () => {
      const v = Number(range.value);
      setter(v);
      badge.textContent = formatter(v);
      renderPreview();
    });
  }

  // ===========================================================================
  // DRAG DELL'OROLOGIO DIRETTAMENTE SULLA PREVIEW
  // ===========================================================================
  let draggingClock = false;

  function canvasPointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    const xFrac = (point.clientX - rect.left) / rect.width;
    const yFrac = (point.clientY - rect.top) / rect.height;
    return { xFrac: clamp01(xFrac), yFrac: clamp01(yFrac) };
  }

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  function isNearClock(xFrac, yFrac) {
    const dx = xFrac - state.clock.x;
    const dy = yFrac - state.clock.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist < 0.22; // area di tolleranza generosa per il touch
  }

  function handlePointerDown(evt) {
    const { xFrac, yFrac } = canvasPointFromEvent(evt);
    if (isNearClock(xFrac, yFrac)) {
      draggingClock = true;
      dragHint.style.opacity = "0";
      evt.preventDefault();
    }
  }

  function handlePointerMove(evt) {
    if (!draggingClock) return;
    const { xFrac, yFrac } = canvasPointFromEvent(evt);
    state.clock.x = xFrac;
    state.clock.y = yFrac;
    document.getElementById("posXRange").value = Math.round(xFrac * 100);
    document.getElementById("posXValue").textContent = Math.round(xFrac * 100) + "%";
    document.getElementById("posYRange").value = Math.round(yFrac * 100);
    document.getElementById("posYValue").textContent = Math.round(yFrac * 100) + "%";
    renderPreview();
    evt.preventDefault();
  }

  function handlePointerUp() {
    draggingClock = false;
    dragHint.style.opacity = "1";
  }

  canvas.addEventListener("mousedown", handlePointerDown);
  canvas.addEventListener("mousemove", handlePointerMove);
  window.addEventListener("mouseup", handlePointerUp);

  canvas.addEventListener("touchstart", handlePointerDown, { passive: false });
  canvas.addEventListener("touchmove", handlePointerMove, { passive: false });
  canvas.addEventListener("touchend", handlePointerUp);

  // ===========================================================================
  // AZIONE PRINCIPALE: Imposta come sfondo animato (Live Wallpaper)
  // ===========================================================================
  function buildConfigJson() {
    return JSON.stringify({
      clock: {
        mode: state.clock.mode,
        customText: state.clock.customText,
        showDate: state.clock.showDate,
        fontKey: state.clock.font,
        bold: state.clock.bold,
        size: state.clock.size,
        color: state.clock.color,
        opacity: state.clock.opacity,
        x: state.clock.x,
        y: state.clock.y,
      },
      bgDim: state.bgDim,
      bgScale: state.bg.scale,
      bgOffX: state.bg.offX,
      bgOffY: state.bg.offY,
      fgScale: state.fg.scale,
      fgOffX: state.fg.offX,
      fgOffY: state.fg.offY,
      parallaxEnabled: state.parallaxEnabled,
    });
  }

  document.getElementById("applyLiveBtn").addEventListener("click", () => {
    if (!state.bg.img || !state.bg.dataUrl) {
      showToast("Carica prima un'immagine di sfondo");
      return;
    }
    if (!isNative) {
      showToast("Lo sfondo animato richiede l'app Android (non funziona nel browser di test)");
      return;
    }
    Android.applyLiveWallpaper(buildConfigJson(), state.bg.dataUrl, state.fg.dataUrl || null);
  });

  // ===========================================================================
  // AZIONE SECONDARIA: Esporta PNG statico (utile per condividere un'anteprima)
  // ===========================================================================
  document.getElementById("exportPngBtn").addEventListener("click", () => {
    if (!state.bg.img) {
      showToast("Carica prima un'immagine di sfondo");
      return;
    }

    // Render ad alta risoluzione su un canvas offscreen (2x la risoluzione base).
    const scaleFactor = 2;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_W * scaleFactor;
    exportCanvas.height = CANVAS_H * scaleFactor;
    const exportCtx = exportCanvas.getContext("2d");
    render(exportCtx, exportCanvas.width, exportCanvas.height);

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

  /** Chiamata dal lato nativo (Kotlin) dopo aver tentato di salvare il PNG in galleria. */
  window.onImageSaved = function (success) {
    showToast(success ? "Salvato in Galleria \u2713" : "Errore durante il salvataggio");
  };

  // ===========================================================================
  // INIZIALIZZAZIONE
  // ===========================================================================
  ensureClockTicking();
  renderPreview();
})();
