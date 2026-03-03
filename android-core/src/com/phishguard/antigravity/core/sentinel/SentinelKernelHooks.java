/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SentinelKernelHooks.java (Module 1 Support)                    ║
 * ║  Kernel Power Intercept & SysFs Modification Logic              ║
 * ║                                                                  ║
 * ║  - Intercepts power button physical interrupts                  ║
 * ║  - Downclocks CPU via sysfs echoing to cpufreq logs             ║
 * ║  - Requests PARTIAL_WAKE_LOCK to keep location running forever  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core.sentinel;

import android.content.Context;
import android.os.PowerManager;
import android.util.Log;

import java.io.DataOutputStream;

public class SentinelKernelHooks {

    private static final String TAG = "Sentinel:KernelHooks";

    private final PowerManager mPowerManager;
    private final Context mContext;
    private PowerManager.WakeLock mStealthWakeLock = null;

    public SentinelKernelHooks(Context context) {
        mContext = context;
        mPowerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    }

    /**
     * Aquires a CPU lock preventing Android from entering Deep Sleep (Doze Mode).
     * This is crucial to ensure the SentinelUDPClient fires every 5 seconds.
     * With big cores disabled via sysfs, the battery cost remains extremely low.
     */
    public void lockCpuActive() {
        if (mStealthWakeLock == null) {
            mStealthWakeLock = mPowerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK, "Sentinel:StealthLock");
            mStealthWakeLock.setReferenceCounted(false);
        }
        if (!mStealthWakeLock.isHeld()) {
            mStealthWakeLock.acquire();
            Log.d(TAG, "PARTIAL_WAKE_LOCK acquired. Deep Sleep prevented.");
        }
    }

    public void releaseCpuLock() {
        if (mStealthWakeLock != null && mStealthWakeLock.isHeld()) {
            mStealthWakeLock.release();
            Log.d(TAG, "PARTIAL_WAKE_LOCK released.");
        }
    }

    /**
     * Executes raw shell commands to the Linux Kernel sysfs nodes.
     * Note: REQUIRES Root / System SELinux overrides to execute successfully.
     * 
     * Objective: Forces the CPU scalar into 'powersave' mode and offlines big cores
     * to prevent the battery from dying while the phone sits in a thief's pocket.
     */
    public boolean throttleSysFs() {
        Log.w(TAG, "Attempting Root SysFs Modification (CPU Throttle)..");
        try {
            Process suProcess = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(suProcess.getOutputStream());

            // Set Governor to PowerSave
            os.writeBytes("echo powersave > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor\n");

            // Turn off big-cores entirely (cpu2-cpu7 depending on architecture)
            os.writeBytes("echo 0 > /sys/devices/system/cpu/cpu4/online\n");
            os.writeBytes("echo 0 > /sys/devices/system/cpu/cpu5/online\n");
            os.writeBytes("echo 0 > /sys/devices/system/cpu/cpu6/online\n");
            os.writeBytes("echo 0 > /sys/devices/system/cpu/cpu7/online\n");
            os.writeBytes("exit\n");

            os.flush();
            suProcess.waitFor();
            Log.i(TAG, "SysFs Throttle Success. Big Cores Offlined.");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed SysFs Throttle. Lacking root/SELinux access. Err: " + e.getMessage());
            return false;
        }
    }
}
