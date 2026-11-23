package com.brokenveilprotocol.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "brokenveil/game_background")
            .setMethodCallHandler { call, result ->
                try {
                    when (call.method) {
                        "setVoiceActive" -> {
                            val intent = Intent(this, GameVoiceService::class.java)
                            if (call.arguments != true) {
                                stopService(intent)
                            } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                                == PackageManager.PERMISSION_GRANTED
                            ) {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                    startForegroundService(intent)
                                } else {
                                    startService(intent)
                                }
                            }
                            result.success(null)
                        }
                        "prepareAlerts" -> {
                            requestAlertPermission()
                            result.success(null)
                        }
                        "notifyObjectiveIntrusion" -> {
                            notifyObjectiveIntrusion(call.arguments as? String ?: "Objectif")
                            result.success(null)
                        }
                        else -> result.notImplemented()
                    }
                } catch (error: RuntimeException) {
                    result.error("GAME_BACKGROUND", error.message, null)
                }
            }
    }

    private fun requestAlertPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) return
        val preferences = getSharedPreferences("game_notifications", MODE_PRIVATE)
        if (!preferences.getBoolean("requested", false)) {
            preferences.edit().putBoolean("requested", true).apply()
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 8121)
        }
    }

    private fun notifyObjectiveIntrusion(objective: String) {
        val manager = getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return
        val channelId = "game_objective_alerts"
        val openGame = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(channelId, "Alertes d’objectif", NotificationManager.IMPORTANCE_HIGH),
            )
            Notification.Builder(this, channelId)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setPriority(Notification.PRIORITY_HIGH)
                .setDefaults(Notification.DEFAULT_ALL)
        }
        manager.notify(
            objective, 8122,
            builder.setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("Rogue détecté")
                .setContentText("Un Rogue est dans votre zone · $objective")
                .setContentIntent(openGame)
                .setAutoCancel(true)
                .build(),
        )
    }
}
