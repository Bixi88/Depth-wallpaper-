import com.android.build.api.variant.impl.VariantOutputImpl

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.depthwallpaper.creator"
    compileSdk = 34

    // Nome del file APK generato: senza questo Gradle usa sempre "<nome modulo>-<build
    // type>.apk" (cioe' "app-debug.apk"), che e' quello che si vede come "app_debug"
    // aprendo o condividendo il file scaricato (il nome dell'app installata, definito
    // da @string/app_name nel manifest, era gia' corretto: qui si sistema solo il nome
    // del FILE).
    base.archivesName.set("DepthWallpaperCreator")

    defaultConfig {
        applicationId = "com.depthwallpaper.creator"
        minSdk = 26
        targetSdk = 34
        versionCode = 11
        versionName = "5.6"
    }

    // I .ttf in assets/fonts restano non compressi: caricamento piu' rapido sia
    // dalla WebView (@font-face) sia dal renderer nativo (Typeface.createFromAsset).
    // Il .tflite dell'upscaler AI DEVE restare non compresso: TFLite lo mappa in
    // memoria (mmap) direttamente dall'APK, cosa impossibile se e' compresso.
    androidResources {
        noCompress += "ttf"
        noCompress += "tflite"
    }

    // Keystore di debug FISSO e versionato nel repo (keystore/debug.keystore).
    // Senza questo, ogni build (soprattutto su GitHub Actions, dove ogni run parte
    // da una VM pulita) verrebbe firmata con una chiave di debug casuale e diversa
    // ogni volta -> Android rifiuta l'installazione come "aggiornamento" e obbliga
    // a disinstallare la versione precedente ("app non installata" per firma diversa).
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("keystore/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = false
    }
}

// Il blocco sopra (base.archivesName) fissa solo il nome BASE del file: Gradle
// aggiunge comunque in automatico il suffisso del build type (es. "-debug"),
// quindi il file scaricato risultava "DepthWallpaperCreator-debug.apk". Qui si
// sovrascrive il nome file finale in modo esplicito, per ogni variante, cosi'
// non compare piu' la scritta "debug".
// NB: "outputFileName" non e' esposto dall'interfaccia base VariantOutput,
// serve castare a VariantOutputImpl (approccio documentato ufficialmente da
// Google per questo scenario: https://developer.android.com/build/build-variants#customize-apk-name).
androidComponents {
    onVariants { variant ->
        variant.outputs.forEach { output ->
            if (output is VariantOutputImpl) {
                output.outputFileName.set("DepthWallpaperCreator.apk")
            }
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("com.google.android.gms:play-services-mlkit-subject-segmentation:16.0.0-beta1")

    // Upscaling AI (Real-ESRGAN-General-x4v3 in TFLite): libreria pura Kotlin/Java,
    // nessun codice nativo NDK/C++ da aggiungere al progetto. Il delegate NNAPI
    // (opzionale, per sfruttare NPU/DSP dove disponibile) e' incluso nel core.
    implementation("org.tensorflow:tensorflow-lite:2.16.1")
}
