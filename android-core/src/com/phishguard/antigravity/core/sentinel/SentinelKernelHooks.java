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
     * Acquires a CPU lock preventing Android from entering Deep Sleep (Doze Mode).
     * This is crucial to ensure the SentinelUDPClient fires every 5 seconds.
     * With big cores disabled via sysfs, the battery cost remains extremely low.
     */
    public void lockCpuActive() {
        if (mPowerManager == null) {
            Log.e(TAG, "PowerManager is null, cannot acquire WakeLock");
            return;
        }
        if (mStealthWakeLock == null) {
            mStealthWakeLock = mPowerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK, "Sentinel:StealthLock");
            mStealthWakeLock.setReferenceCounted(false);
        }
        if (!mStealthWakeLock.isHeld()) {
            mStealthWakeLock.acquire(10 * 60 * 1000L); // 10 minutes max timeout
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
        Process suProcess = null;
        try {
            suProcess = Runtime.getRuntime().exec("su");
            try (DataOutputStream os = new DataOutputStream(suProcess.getOutputStream())) {

                // Set Governor to PowerSave
                os.writeBytes("echo powersave > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor\n");

                // Dynamically detect available cores and offline all but cpu0
                java.io.File cpuDir = new java.io.File("/sys/devices/system/cpu/");
                java.io.File[] files = cpuDir.listFiles();
                if (files != null) {
                    for (java.io.File f : files) {
                        if (f.getName().matches("cpu[1-9][0-9]*")) {
                            String onlinePath = f.getAbsolutePath() + "/online";
                            java.io.File onlineFile = new java.io.File(onlinePath);
                            if (onlineFile.exists() && onlineFile.canWrite()) {
                                os.writeBytes("echo 0 > " + onlinePath + "\n");
                            }
                        }
                    }
                }
                os.writeBytes("exit\n");
                os.flush();
            }

            // Consume streams to avoid hang
            new Thread(() -> {
                try {
                    java.io.InputStream is = suProcess.getInputStream();
                    while (is.read() != -1)
                        ;
                } catch (Exception ignore) {
                }
            }).start();
            new Thread(() -> {
                try {
                    java.io.InputStream es = suProcess.getErrorStream();
                    while (es.read() != -1)
                        ;
                } catch (Exception ignore) {
                }
            }).start();

            boolean finished = false;
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                finished = suProcess.waitFor(5, java.util.concurrent.TimeUnit.SECONDS);
            } else {
                suProcess.waitFor();
                finished = true;
            }

            if (!finished) {
                suProcess.destroyForcibly();
                Log.e(TAG, "SysFs Throttle timed out.");
                return false;
            }

            if (suProcess.exitValue() == 0) {
                Log.i(TAG, "SysFs Throttle Success. Big Cores Offlined.");
                return true;
            } else {
                Log.e(TAG, "SysFs Throttle failed with exit code: " + suProcess.exitValue());
                return false;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            Log.e(TAG, "SysFs Throttle interrupted", e);
            if (suProcess != null)
                suProcess.destroyForcibly();
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Failed SysFs Throttle.", e);
            if (suProcess != null)
                suProcess.destroyForcibly();
            return false;
        }
    }
}
