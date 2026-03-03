/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  AntiGravityDeviceAdmin.java                                    ║
 * ║  MDM / Device Administration Receiver                           ║
 * ║                                                                  ║
 * ║  Required for lockdown, remote wipe, disabled camera,           ║
 * ║  and forcing standard screen lock implementations natively.     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class AntiGravityDeviceAdmin extends DeviceAdminReceiver {

    private static final String TAG = "PG:DeviceAdmin";

    @Override
    public void onEnabled(Context context, Intent intent) {
        super.onEnabled(context, intent);
        Log.i(TAG, "Device Admin Privileges ENABLED.");
        // We could theoretically lock out un-installation here by
        // managing user restrictions or configuring MDM lock-tasks.
    }

    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        Log.w(TAG, "User attempting to disable Device Admin!");
        // We can warn the user that they are compromising their anti-theft security.
        return "Disabling this will leave your phone vulnerable to theft and wipe data! Proceed?";
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        super.onDisabled(context, intent);
        Log.e(TAG, "Device Admin Privileges DISABLED.");
        // Thief has bypassed a layer. Trigger high alert snapshot?
        DeviceHealthSnapshot snapshot = new DeviceHealthSnapshot();
        snapshot.timestampMs = System.currentTimeMillis();
        snapshot.trigger = "ALERT_ADMIN_DISABLED";
        LocalFlashDumper.dumpToNVRAM(context, snapshot);
    }

    @Override
    public void onPasswordFailed(Context context, Intent intent) {
        super.onPasswordFailed(context, intent);
        Log.w(TAG, "Lock screen password failed attempt detected.");
        // E.g., if > 3 attempts, capture front camera photo and run Last Gasp logic
    }
}
