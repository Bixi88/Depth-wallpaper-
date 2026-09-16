package com.depthwallpaper.creator

import android.content.Context
import android.content.Intent
import java.io.File

/**
 * Punto unico di lettura/scrittura per tutto cio' che serve al Live Wallpaper:
 *  - il JSON di configurazione (impostazioni orologio + effetti)
 *  - i due file immagine (sfondo e soggetto ritagliato)
 *
 * L'editor (MainActivity/WebAppBridge) scrive qui quando l'utente tocca
 * "Imposta sfondo animato"; il DepthWallpaperService legge qui ad ogni avvio
 * e ogni volta che riceve il broadcast ACTION_CONFIG_UPDATED.
 */
object ConfigStore {

    private const val PREFS_NAME = "depth_wallpaper_prefs"
    private const val KEY_CONFIG_JSON = "config_json"

    const val ACTION_CONFIG_UPDATED = "com.depthwallpaper.creator.CONFIG_UPDATED"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun saveConfigJson(context: Context, json: String) {
        prefs(context).edit().putString(KEY_CONFIG_JSON, json).apply()
    }

    fun loadConfigJson(context: Context): String? =
        prefs(context).getString(KEY_CONFIG_JSON, null)

    fun bgFile(context: Context): File = File(context.filesDir, "layer_bg.img")
    fun fgFile(context: Context): File = File(context.filesDir, "layer_fg.img")

    /** Avvisa un eventuale DepthWallpaperService già attivo di ricaricare la configurazione. */
    fun notifyConfigUpdated(context: Context) {
        val intent = Intent(ACTION_CONFIG_UPDATED).setPackage(context.packageName)
        context.sendBroadcast(intent)
    }
}
