plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.depthwallpaper.creator"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.depthwallpaper.creator"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "2.0"
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

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("com.google.android.gms:play-services-mlkit-subject-segmentation:16.0.0-beta1")
}
