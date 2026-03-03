/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  BootReceiver.java                                              ║
 * ║  Auto-Start Controller for AntiGravityCore                      ║
 * ║                                                                  ║
 * ║  Starts the service immediately on device boot, even before     ║
 * ║  user unlock (Direct Boot / File-Based Encryption support).     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "PG:BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.d(TAG, "Boot event received: " + action);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
                Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action) ||
                "android.intent.action.QUICKBOOT_POWERON".equals(action)) {

            Log.i(TAG, "Device booted. Starting AntiGravityCoreService...");

            Intent serviceIntent = new Intent(context, AntiGravityCoreService.class);
            // In Android O+, background services must be started via startForegroundService
            // However, as a persistent system app, standard startService may also work.
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        }
    }
}
