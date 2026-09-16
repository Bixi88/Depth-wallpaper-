# Depth Wallpaper Creator

App Android per creare un **vero sfondo animato (Live Wallpaper)** con **effetto profondità**
in stile iOS ("Depth Effect Wallpaper"): l'orologio resta agganciato dietro al soggetto
ritagliato, esattamente come nello screenshot di riferimento di questo progetto.

## Concetto

Il sistema compone 3 livelli:

1. **Livello 0 — Sfondo**: l'immagine originale caricata dall'utente.
2. **Livello 1 — Orologio digitale**: testo stilizzato e personalizzabile (font, dimensione,
   colore, posizione, opacità, formato ora/data o testo libero), aggiornato in tempo reale.
3. **Livello 2 — Soggetto ritagliato**: un PNG con trasparenza sovrapposto esattamente
   sopra l'orologio. Dove il soggetto è trasparente, l'orologio resta visibile; dove il
   soggetto è opaco, lo copre — creando l'illusione che l'orologio sia "dietro" al soggetto.

A differenza di un semplice export PNG, qui il risultato finale è un **Live Wallpaper Android
nativo**: l'orologio continua a ticchettare sulla Home e sul Lock screen, e (opzionale) i
livelli si muovono leggermente con il giroscopio per un effetto di profondità "vivo" —
la stessa tecnica usata dalle principali app "depth effect" per Android.

## Architettura

L'app è divisa in due parti nettamente separate:

```
app/src/main/
├── java/com/depthwallpaper/creator/
│   ├── MainActivity.kt            # Host WebView (editor) + bridge nativo
│   ├── DepthWallpaperService.kt   # Live Wallpaper nativo: Engine che disegna sul canvas di sistema
│   ├── DepthRenderer.kt           # Motore di composizione dei 3 layer (porting nativo del canvas HTML5)
│   ├── WallpaperConfig.kt         # Modello dati della configurazione (parsing del JSON dall'editor)
│   └── ConfigStore.kt             # Persistenza condivisa editor <-> live wallpaper (SharedPreferences + file immagine)
├── res/
│   ├── xml/wallpaper_depth.xml     # Descrittore di sistema del Live Wallpaper
│   └── ...                         # Layout, stringhe, icona adattiva
└── assets/                         # L'EDITOR (solo per la fase di progettazione)
    ├── index.html                   # Struttura: preview canvas + pannello controlli a tab
    ├── css/style.css                # Dashboard responsive (dark theme)
    └── js/app.js                    # Stato, anteprima live su Canvas HTML5, drag, invio configurazione
```

### 1. L'editor (WebView + Canvas HTML5)

Serve **solo per progettare** il wallpaper in modo interattivo: caricare le immagini,
scegliere font/colore/posizione dell'orologio, regolare zoom e offset dei livelli. La preview
è realizzata con `<canvas>` esattamente come un prototipo web, perché è comodo per iterare
rapidamente sull'interfaccia.

### 2. Il Live Wallpaper (Kotlin nativo, nessuna WebView)

Quando l'utente tocca **"Imposta sfondo"**, l'editor NON genera più un PNG: invia a
`MainActivity` la configurazione (JSON) e i due file immagine. `MainActivity` li salva su
disco (vedi `ConfigStore`) e apre il selettore di sistema per applicare
`DepthWallpaperService` come sfondo — è Android stesso, a quel punto, a mostrare la scelta
tra **Home**, **Lock screen** o **Entrambe**.

`DepthWallpaperService` è un `android.service.wallpaper.WallpaperService` che:

- ridisegna i 3 layer direttamente su `Canvas` (nessuna WebView: massima efficienza e battery-life);
- aggiorna l'orologio **esattamente all'inizio di ogni minuto** (non ogni secondo), per
  consumare pochissima batteria;
- ascolta `onOffsetsChanged` per un leggero parallasse quando si scorre tra le pagine della Home;
- se abilitato, usa l'accelerometro per un parallasse "al tocco/inclinazione" — sfondo, orologio
  e soggetto si muovono a velocità diverse, rafforzando l'illusione di profondità;
- si ferma completamente (nessun redraw, sensori disattivati) quando non è visibile, per
  rispettare la batteria;
- riceve un broadcast (`ConfigStore.ACTION_CONFIG_UPDATED`) e ricarica la configurazione
  all'istante se l'utente modifica il design mentre il wallpaper è già attivo.

### Bridge JavaScript ↔ Kotlin (solo lato editor)

| Metodo JS → Kotlin                                             | Cosa fa |
|------------------------------------------------------------------|---------|
| `Android.pickImage(layer)`                                       | Apre il selettore di sistema (SAF) e restituisce l'immagine come `data:` URL a `window.onImageLoaded(layer, dataUrl)` |
| `Android.applyLiveWallpaper(configJson, bgDataUrl, fgDataUrl)`    | Salva configurazione + immagini per `DepthWallpaperService` e apre il selettore di sistema per applicarlo |
| `Android.saveImage(pngDataUrl, fileName)`                        | (opzionale/secondario) Salva un PNG statico in `Pictures/DepthWallpaper`, utile solo per condividere un'anteprima |

Se `index.html` viene aperto in un browser desktop per test rapidi dell'interfaccia
(`Android` non definito), l'editor usa un fallback con `<input type="file">` e download via
link — utile per validare la UI senza ricompilare l'APK. Ovviamente in questa modalità
"Imposta sfondo" non è disponibile (richiede l'app Android).

### Limite noto: i font

L'editor mappa ogni font su una delle 4 famiglie che il rendering nativo Android sa
riprodurre in modo affidabile senza dipendenze esterne: `sans`, `serif`, `monospace`,
`condensed`. Il live wallpaper userà quindi il `Typeface` di sistema più vicino a quello
scelto in anteprima, non il font esatto (che sul web è disponibile ma su Android
richiederebbe di incorporare file `.ttf`).

## Fonti / ispirazione

L'architettura (rendering nativo diretto sul canvas del wallpaper, orologio aggiornato al
minuto per il risparmio energetico, sync della configurazione via broadcast) è ispirata
all'esame di app Android open-source e commerciali con lo stesso obiettivo, tra cui il
progetto open-source [`dipesht16/Depth`](https://github.com/dipesht16/Depth) (Flutter +
`DepthWallpaperService` nativo Kotlin) e diverse app "Depth Wallpaper & Live Clock"
disponibili su Google Play.

## Funzionalità del prototipo

- **Tab Media**: caricamento immagine di sfondo e soggetto ritagliato (PNG trasparente), con
  anteprima a thumbnail.
- **Tab Orologio**: modalità Ora corrente / Testo personalizzato, data opzionale, scelta font
  (sans/serif/monospace/condensed), grassetto, dimensione, colore, opacità, posizione X/Y via
  slider **oppure trascinando direttamente l'orologio sull'anteprima**.
- **Tab Effetti**: oscuramento dello sfondo per contrasto, zoom/posizione indipendenti per
  sfondo e soggetto, toggle del parallasse giroscopico.
- **Imposta sfondo** (azione principale): applica il design come Live Wallpaper Android reale.
- **Esporta anche come PNG statico** (azione secondaria): utile solo per condividere
  un'anteprima dell'immagine.

## Come aprire e compilare il progetto

1. Apri la cartella `DepthWallpaperCreator/` con **Android Studio** (Koala o successivo).
2. Al primo sync, Android Studio genererà automaticamente i file mancanti del Gradle Wrapper
   (`gradlew`, `gradlew.bat`, `gradle-wrapper.jar`) usando la versione indicata in
   `gradle/wrapper/gradle-wrapper.properties` (Gradle 8.7). In alternativa, con Gradle già
   installato:
   ```
   gradle wrapper --gradle-version 8.7
   ```
3. Lancia l'app su un emulatore o dispositivo reale (**minSdk 26 / Android 8.0+**). Nota: i
   Live Wallpaper con sensori funzionano meglio su dispositivo reale che su emulatore.
4. Per generare l'APK da riga di comando: `./gradlew assembleDebug` (l'APK sarà in
   `app/build/outputs/apk/debug/`).

## Requisiti

- Android Studio Koala (2024.1) o successivo
- JDK 17
- minSdk 26, targetSdk 34

## Idee per estensioni future

- Segmentazione automatica del soggetto (rimozione sfondo on-device con ML Kit / TensorFlow
  Lite) invece del solo caricamento manuale di un PNG già ritagliato.
- Salvataggio/caricamento di più progetti come preset riutilizzabili.
- Font personalizzati incorporati (`.ttf` in `res/font/`) per un rendering 1:1 con l'anteprima.
- Editor del testo della data con formati/lingue multiple.

## Licenza

Progetto rilasciato per uso didattico/prototipale: personalizza pure la licenza in base
alle tue esigenze prima della pubblicazione su GitHub (es. MIT).
