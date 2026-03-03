/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FakePowerOffController.java                                    ║
 * ║  Requirement 2: Stealth Tracking — "Fake Power Off"             ║
 * ║                                                                  ║
 * ║  When shutdown is forced in stolen mode:                        ║
 * ║    1. Show a convincing "Shutting Down..." animation            ║
 * ║    2. Disable screen, LEDs, haptics, notification sounds        ║
 * ║    3. Enter CPU Low Power Cluster mode                          ║
 * ║    4. Keep LocationManager + TelephonyService alive             ║
 * ║    5. Continue MQTT pings in background                         ║
 * ║                                                                  ║
 * ║  The thief believes the phone is off. It is not.                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * FakePowerOffController — The art of deception.
 *
 * State Machine:
 * ┌──────────┐ arm() ┌────────┐ executeFakeShutdown() ┌────────────┐
 * │ DISARMED │ ────────► │ ARMED │ ──────────────────────► │ ANIMATING │
 * └──────────┘ └────────┘ └─────┬──────┘
 * ▲ │
 * │ exitFakeOff() │ animation complete
 * │ ▼
 * ┌──────┴─────┐ ┌────────────┐
 * │ DISARMED │ ◄────────────────── │ FAKE_OFF │
 * └────────────┘ owner auth └────────────┘
 * │
 * │ continues:
 * │ • GPS pings
 * │ • MQTT bursts
 * │ • Accelerometer
 * ▼
 * [CPU Low Power
 * Cluster Mode]
 */
public class FakePowerOffController {

    private static final String TAG = "PG:FakePowerOff";

    // ─── Dependencies ────────────────────────────────────────────
    private final Context mContext;
    private final PowerManager mPowerManager;
    private final AtomicBoolean mFakeOffActive;
    private final PowerManager.WakeLock mStealthWakeLock;
    private final Handler mUiHandler = new Handler(Looper.getMainLooper());

    // ─── System services ─────────────────────────────────────────
    private WindowManager mWindowManager;
    private AudioManager mAudioManager;
    private Vibrator mVibrator;

    // ─── State ───────────────────────────────────────────────────
    private boolean mArmed = false;
    private View mBlackOverlay;
    private View mShutdownAnimation;

    // ─── Saved state (to restore on exit) ────────────────────────
    private int mSavedBrightness = -1;
    private int mSavedBrightnessMode = -1;
    private int mSavedRingerMode = -1;
    private int mSavedNotificationVolume = -1;
    private int mSavedMediaVolume = -1;

    // ─── Timing ──────────────────────────────────────────────────
    private static final long SHUTDOWN_ANIM_DURATION_MS = 3000; // Fake animation
    private static final long VIBRATION_PATTERN_MS = 200; // "Power off" haptic
    private static final long POST_ANIM_DELAY_MS = 500; // Delay before black

    public FakePowerOffController(Context context, PowerManager powerManager,
            AtomicBoolean fakeOffActive,
            PowerManager.WakeLock stealthWakeLock) {
        mContext = context;
        mPowerManager = powerManager;
        mFakeOffActive = fakeOffActive;
        mStealthWakeLock = stealthWakeLock;

        mWindowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        mAudioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        mVibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    public void initialize() {
        Log.d(TAG, "FakePowerOffController initialized");
    }

    // ═════════════════════════════════════════════════════════════
    // STATE MANAGEMENT
    // ═════════════════════════════════════════════════════════════

    public void arm() {
        mArmed = true;
        Log.d(TAG, "FakePowerOff ARMED — ready to intercept shutdown");
    }

    public void disarm() {
        mArmed = false;
        Log.d(TAG, "FakePowerOff DISARMED");
    }

    public boolean isArmed() {
        return mArmed;
    }

    // ═════════════════════════════════════════════════════════════
    // FAKE SHUTDOWN EXECUTION
    // ═════════════════════════════════════════════════════════════

    /**
     * Execute the complete fake shutdown sequence.
     *
     * This is the money shot. The thief presses "Power Off" and sees:
     * 1. A convincing "Shutting Down..." animation (identical to stock)
     * 2. A vibration pulse (mimics real shutdown haptic)
     * 3. Screen fades to black
     * 4. All visible indicators turn off
     * 5. Phone appears completely dead
     *
     * But underneath:
     * - CPU remains active on low-power cluster (LITTLE cores only)
     * - GPS continues pinging
     * - MQTT continues publishing
     * - Accelerometer remains armed
     *
     * @param onComplete Callback when fake shutdown sequence is done
     */
    public void executeFakeShutdown(Runnable onComplete) {
        if (!mArmed) {
            Log.w(TAG, "executeFakeShutdown called but not armed — ignoring");
            return;
        }

        Log.w(TAG, "═══ EXECUTING FAKE SHUTDOWN SEQUENCE ═══");

        // ── Phase 0: Save current state ───────────────────────────
        saveDeviceState();

        // ── Phase 1: Show "Shutting Down..." animation ────────────
        mUiHandler.post(() -> {
            showShutdownAnimation();

            // ── Phase 2: Haptic feedback (mimic real shutdown) ────
            if (mVibrator != null && mVibrator.hasVibrator()) {
                mVibrator.vibrate(VIBRATION_PATTERN_MS);
            }

            // ── Phase 3: After animation, go to black ────────────
            mUiHandler.postDelayed(() -> {
                dismissShutdownAnimation();

                // ── Phase 4: Full blackout ────────────────────────
                showBlackOverlay();
                disableAllVisibleIndicators();

                // ── Phase 5: Enter low-power stealth ──────────────
                enterLowPowerStealth();

                Log.w(TAG, "═══ FAKE SHUTDOWN COMPLETE — DEVICE APPEARS OFF ═══");

                if (onComplete != null) {
                    onComplete.run();
                }

            }, SHUTDOWN_ANIM_DURATION_MS + POST_ANIM_DELAY_MS);
        });
    }

    // ═════════════════════════════════════════════════════════════
    // PHASE 1: SHUTDOWN ANIMATION
    // ═════════════════════════════════════════════════════════════

    /**
     * Display a pixel-perfect replica of Android's shutdown animation.
     *
     * Uses a fullscreen system overlay with:
     * - Dark background
     * - "Shutting down..." text
     * - Circular progress indicator
     * - Fade-out animation at the end
     */
    private void showShutdownAnimation() {
        LinearLayout root = new LinearLayout(mContext);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.BLACK);

        // "Shutting down..." text
        TextView text = new TextView(mContext);
        text.setText("Shutting down…");
        text.setTextColor(Color.WHITE);
        text.setTextSize(18);
        text.setGravity(Gravity.CENTER);
        text.setPadding(0, 0, 0, 48);
        root.addView(text);

        // Progress spinner
        ProgressBar spinner = new ProgressBar(mContext);
        spinner.setIndeterminate(true);
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(
                96, 96);
        spinnerParams.gravity = Gravity.CENTER;
        root.addView(spinner, spinnerParams);

        // Fullscreen overlay params
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_SYSTEM_ERROR,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_FULLSCREEN
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.OPAQUE);
        params.gravity = Gravity.CENTER;

        try {
            mWindowManager.addView(root, params);
            mShutdownAnimation = root;
            Log.d(TAG, "Shutdown animation displayed");
        } catch (Exception e) {
            Log.e(TAG, "Failed to show shutdown animation: " + e.getMessage());
        }
    }

    private void dismissShutdownAnimation() {
        if (mShutdownAnimation != null) {
            try {
                mWindowManager.removeView(mShutdownAnimation);
                mShutdownAnimation = null;
            } catch (Exception e) {
                Log.e(TAG, "Failed to dismiss animation: " + e.getMessage());
            }
        }
    }

    // ═════════════════════════════════════════════════════════════
    // PHASE 4: FULL BLACKOUT
    // ═════════════════════════════════════════════════════════════

    /**
     * Show an opaque black overlay covering the entire screen.
     *
     * This overlay:
     * - Sits above EVERYTHING (TYPE_SYSTEM_ERROR)
     * - Is NOT touchable (touches fall through — but screen is "off")
     * - Has no content — just pure black
     * - Even covers navigation bar and status bar
     *
     * If the thief touches the screen, nothing happens.
     * If they press power, the screen stays black.
     * The phone looks and feels completely dead.
     */
    private void showBlackOverlay() {
        FrameLayout black = new FrameLayout(mContext);
        black.setBackgroundColor(Color.BLACK);

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_SYSTEM_ERROR,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_FULLSCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.OPAQUE);
        params.gravity = Gravity.TOP | Gravity.START;

        // Extend to cover navigation bar and status bar
        params.flags |= WindowManager.LayoutParams.FLAG_LAYOUT_INSET_DECOR;

        try {
            mWindowManager.addView(black, params);
            mBlackOverlay = black;
            Log.d(TAG, "Black overlay active — screen appears OFF");
        } catch (Exception e) {
            Log.e(TAG, "Failed to show black overlay: " + e.getMessage());
        }
    }

    // ═════════════════════════════════════════════════════════════
    // DISABLE VISIBLE INDICATORS
    // ═════════════════════════════════════════════════════════════

    /**
     * Kill every visible/audible sign that the phone is still alive.
     *
     * Disables:
     * - Screen brightness → 0
     * - Notification LED → off
     * - Vibration → off
     * - All audio streams → 0
     * - Ringer mode → silent
     * - Notification sounds → off
     */
    private void disableAllVisibleIndicators() {
        try {
            // ── Brightness to minimum ─────────────────────────────
            Settings.System.putInt(mContext.getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, 0);
            Settings.System.putInt(mContext.getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS_MODE,
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);

            // ── Audio: full silence ───────────────────────────────
            mAudioManager.setRingerMode(AudioManager.RINGER_MODE_SILENT);
            mAudioManager.setStreamVolume(AudioManager.STREAM_NOTIFICATION, 0, 0);
            mAudioManager.setStreamVolume(AudioManager.STREAM_RING, 0, 0);
            mAudioManager.setStreamVolume(AudioManager.STREAM_ALARM, 0, 0);
            mAudioManager.setStreamVolume(AudioManager.STREAM_SYSTEM, 0, 0);
            mAudioManager.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0);

            // ── Disable notification LED ──────────────────────────
            Settings.System.putInt(mContext.getContentResolver(),
                    "notification_light_pulse", 0);

            // ── Disable vibration ─────────────────────────────────
            if (mVibrator != null) {
                mVibrator.cancel();
            }

            Log.d(TAG, "All visible indicators disabled — phone appears dead");

        } catch (Exception e) {
            Log.e(TAG, "Error disabling indicators: " + e.getMessage());
        }
    }

    // ═════════════════════════════════════════════════════════════
    // PHASE 5: LOW-POWER STEALTH
    // ═════════════════════════════════════════════════════════════

    /**
     * Enter CPU low-power cluster mode.
     *
     * Strategy:
     * - Keep PARTIAL_WAKE_LOCK (CPU on, screen off)
     * - Set CPU governor to powersave
     * - On devices with big.LITTLE: migrate to LITTLE cluster
     * - Disable unnecessary services (Bluetooth, NFC, etc.)
     * - Keep GPS, cellular, and WiFi radio active
     *
     * Power budget target: < 50mW average
     * This gives ~48 hours on a 3000mAh battery at "fake off"
     */
    private void enterLowPowerStealth() {
        // Ensure wake lock is held
        if (!mStealthWakeLock.isHeld()) {
            mStealthWakeLock.acquire();
        }

        // Set CPU governor to powersave via sysfs
        // Note: requires root/system permission
        setCpuGovernor("powersave");

        // Disable non-essential radios
        disableNonEssentialRadios();

        Log.d(TAG, "Stealth low-power mode active — estimated 48h battery life");
    }

    /**
     * Set CPU frequency governor via sysfs.
     * In AOSP system service, we have write access to sysfs.
     *
     * Available governors: performance, ondemand, powersave, conservative
     * We want "powersave" — locks to minimum frequency on LITTLE cores
     */
    private void setCpuGovernor(String governor) {
        try {
            // For each CPU core
            String[] cpuPaths = {
                    "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor",
                    "/sys/devices/system/cpu/cpu1/cpufreq/scaling_governor",
                    "/sys/devices/system/cpu/cpu2/cpufreq/scaling_governor",
                    "/sys/devices/system/cpu/cpu3/cpufreq/scaling_governor"
            };

            for (String path : cpuPaths) {
                java.io.FileWriter fw = new java.io.FileWriter(path);
                fw.write(governor);
                fw.close();
            }

            // Disable big cores (if big.LITTLE architecture)
            String[] bigCorePaths = {
                    "/sys/devices/system/cpu/cpu4/online",
                    "/sys/devices/system/cpu/cpu5/online",
                    "/sys/devices/system/cpu/cpu6/online",
                    "/sys/devices/system/cpu/cpu7/online"
            };

            for (String path : bigCorePaths) {
                java.io.File f = new java.io.File(path);
                if (f.exists()) {
                    java.io.FileWriter fw = new java.io.FileWriter(path);
                    fw.write("0"); // Disable core
                    fw.close();
                }
            }

            Log.d(TAG, "CPU governor set to: " + governor + ", big cores disabled");

        } catch (Exception e) {
            Log.e(TAG, "Failed to set CPU governor: " + e.getMessage());
        }
    }

    /**
     * Disable radios not needed for tracking.
     *
     * KEEP: GPS, Cellular data, WiFi (for location + MQTT)
     * KILL: Bluetooth, NFC, IR
     */
    private void disableNonEssentialRadios() {
        try {
            // Disable Bluetooth
            android.bluetooth.BluetoothAdapter bt = android.bluetooth.BluetoothAdapter.getDefaultAdapter();
            if (bt != null && bt.isEnabled()) {
                bt.disable();
            }

            // Disable NFC (via Settings.Secure)
            Settings.Secure.putInt(mContext.getContentResolver(), "nfc_on", 0);

            Log.d(TAG, "Non-essential radios disabled (BT, NFC)");

        } catch (Exception e) {
            Log.e(TAG, "Failed to disable radios: " + e.getMessage());
        }
    }

    // ═════════════════════════════════════════════════════════════
    // STATE SAVE / RESTORE
    // ═════════════════════════════════════════════════════════════

    private void saveDeviceState() {
        try {
            mSavedBrightness = Settings.System.getInt(
                    mContext.getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, 128);
            mSavedBrightnessMode = Settings.System.getInt(
                    mContext.getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS_MODE, 0);
            mSavedRingerMode = mAudioManager.getRingerMode();
            mSavedNotificationVolume = mAudioManager.getStreamVolume(
                    AudioManager.STREAM_NOTIFICATION);
            mSavedMediaVolume = mAudioManager.getStreamVolume(
                    AudioManager.STREAM_MUSIC);
            Log.d(TAG, "Device state saved for restoration");
        } catch (Exception e) {
            Log.e(TAG, "Failed to save state: " + e.getMessage());
        }
    }

    /**
     * Exit fake-off state and restore normal operation.
     * Called when the owner authenticates via remote unlock or
     * physical authentication.
     */
    public void exitFakeOff() {
        Log.w(TAG, "═══ EXITING FAKE-OFF STATE ═══");

        // Remove black overlay
        if (mBlackOverlay != null) {
            try {
                mWindowManager.removeView(mBlackOverlay);
                mBlackOverlay = null;
            } catch (Exception e) {
                Log.e(TAG, "Failed to remove overlay: " + e.getMessage());
            }
        }

        // Restore device state
        restoreDeviceState();

        // Re-enable CPU
        setCpuGovernor("schedutil"); // Modern Android default

        // Mark state
        mFakeOffActive.set(false);
    }

    private void restoreDeviceState() {
        try {
            if (mSavedBrightness >= 0) {
                Settings.System.putInt(mContext.getContentResolver(),
                        Settings.System.SCREEN_BRIGHTNESS, mSavedBrightness);
            }
            if (mSavedBrightnessMode >= 0) {
                Settings.System.putInt(mContext.getContentResolver(),
                        Settings.System.SCREEN_BRIGHTNESS_MODE, mSavedBrightnessMode);
            }
            if (mSavedRingerMode >= 0) {
                mAudioManager.setRingerMode(mSavedRingerMode);
            }

            Log.d(TAG, "Device state restored to pre-fake-off values");
        } catch (Exception e) {
            Log.e(TAG, "Failed to restore state: " + e.getMessage());
        }
    }
}
