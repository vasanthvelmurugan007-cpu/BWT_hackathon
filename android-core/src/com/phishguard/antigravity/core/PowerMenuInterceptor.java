/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  PowerMenuInterceptor.java                                      ║
 * ║  Requirement 1: Power Persistence                               ║
 * ║                                                                  ║
 * ║  Intercepts GlobalActions (the Power Menu dialog) by hooking     ║
 * ║  into WindowManagerService's GlobalActionsProvider interface.    ║
 * ║                                                                  ║
 * ║  When isStolenMode == true:                                      ║
 * ║    - Long press power → "Authentication Required" fragment       ║
 * ║    - Power Off / Restart options → return null (suppressed)      ║
 * ║    - Emergency call → allowed (legal requirement)                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * PowerMenuInterceptor — Hijacks the power menu when in stolen mode.
 *
 * Architecture:
 *
 * ┌─────────────────┐
 * │ Physical Power │ ← Hardware event
 * │ Button │
 * └────────┬─────────┘
 * │
 * ┌────────▼─────────┐
 * │ PhoneWindowMgr │ ← Framework layer (interceptSingleKeyBeforeQueueing)
 * │ interceptKeyTi │
 * └────────┬─────────┘
 * │
 * ┌────────▼─────────┐
 * │ GlobalActions │ ← We hook HERE
 * │ .showDialog() │
 * └────────┬─────────┘
 * │
 * ┌────────▼─────────┐
 * │ OUR INTERCEPTOR │ → Returns auth fragment or null
 * └──────────────────┘
 *
 * AOSP Integration Point:
 * In a real AOSP build, this class would implement
 * GlobalActionsProvider and be registered via:
 * frameworks/base/services/core/java/com/android/server/policy/
 * GlobalActionsProvider.java
 *
 * For the PhishGuard demo, we simulate this by:
 * 1. Using an AccessibilityService to detect power key events
 * 2. Overlaying a system-level auth dialog on top of the power menu
 * 3. Using SYSTEM_ALERT_WINDOW to block interaction
 */
public class PowerMenuInterceptor {

    private static final String TAG = "PG:PowerInterceptor";

    private final Context mContext;
    private final AtomicBoolean mStolenMode;
    private final AtomicBoolean mInterceptionEnabled = new AtomicBoolean(false);
    private final Handler mUiHandler = new Handler(Looper.getMainLooper());

    // WindowManager for overlay
    private WindowManager mWindowManager;
    private View mAuthOverlay;
    private boolean mOverlayShowing = false;

    // Authentication state
    private static final int MAX_AUTH_ATTEMPTS = 3;
    private int mAuthAttempts = 0;
    private long mLastAttemptTimestamp = 0;
    private static final long LOCKOUT_DURATION_MS = 30_000; // 30s lockout

    public PowerMenuInterceptor(Context context, AtomicBoolean stolenMode) {
        mContext = context;
        mStolenMode = stolenMode;
        mWindowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    // ═════════════════════════════════════════════════════════════
    // REGISTRATION
    // ═════════════════════════════════════════════════════════════

    /**
     * Register with WindowManagerService.
     *
     * In AOSP source, this would be:
     * LocalServices.getService(WindowManagerInternal.class)
     * .registerGlobalActionsProvider(this);
     *
     * In our implementation, we register as the highest-priority
     * key event interceptor.
     */
    public void registerWithWindowManager() {
        Log.d(TAG, "Registered as GlobalActions interceptor");
        // In AOSP: hook into PhoneWindowManager.interceptKeyBeforeQueueing()
        // In demo: AccessibilityService + overlay approach
    }

    public void setInterceptionEnabled(boolean enabled) {
        mInterceptionEnabled.set(enabled);
        Log.d(TAG, "Power menu interception: " + (enabled ? "ENABLED" : "DISABLED"));
    }

    // ═════════════════════════════════════════════════════════════
    // GLOBAL ACTIONS INTERCEPTION
    // ═════════════════════════════════════════════════════════════

    /**
     * Called when the system wants to show the power menu (GlobalActions).
     *
     * AOSP signature:
     * 
     * @Override
     *           public void showGlobalActions() { ... }
     *
     * @return true if we consumed the event (suppressed the real menu)
     */
    public boolean onGlobalActionsRequested() {
        if (!mStolenMode.get() || !mInterceptionEnabled.get()) {
            // Normal mode: let the real power menu show
            return false;
        }

        Log.w(TAG, "Power menu INTERCEPTED in stolen mode!");

        // Show our auth-required overlay instead
        mUiHandler.post(this::showAuthenticationOverlay);

        // Consume the event — real power menu will NOT show
        return true;
    }

    /**
     * Intercept individual power menu actions.
     *
     * In AOSP GlobalActions, each action (Power Off, Restart, etc.)
     * is an Action object. We override them to return null.
     *
     * @param actionTag "power_off", "restart", "screenshot", "emergency"
     * @return null to suppress, or the original action to allow
     */
    public Object interceptGlobalAction(String actionTag) {
        if (!mStolenMode.get() || !mInterceptionEnabled.get()) {
            return actionTag; // pass-through
        }

        switch (actionTag) {
            case "power_off":
            case "restart":
            case "recovery":
            case "bootloader":
                // BLOCK these — return null
                Log.w(TAG, "BLOCKED action: " + actionTag);
                return null;

            case "emergency":
                // MUST allow emergency calls (legal requirement in all jurisdictions)
                Log.d(TAG, "ALLOWED action: emergency (legal requirement)");
                return actionTag;

            case "lockdown":
                // Allow lockdown — it helps our cause
                Log.d(TAG, "ALLOWED action: lockdown");
                return actionTag;

            default:
                Log.d(TAG, "BLOCKED unknown action: " + actionTag);
                return null;
        }
    }

    // ═════════════════════════════════════════════════════════════
    // AUTHENTICATION OVERLAY
    // ═════════════════════════════════════════════════════════════

    /**
     * Shows a system-level "Authentication Required" overlay that
     * blocks the power menu.
     *
     * Uses TYPE_SYSTEM_ERROR (or TYPE_APPLICATION_OVERLAY on API 26+)
     * to sit above everything, including the power menu.
     */
    private void showAuthenticationOverlay() {
        if (mOverlayShowing)
            return;

        // Check for lockout
        if (mAuthAttempts >= MAX_AUTH_ATTEMPTS) {
            long elapsed = System.currentTimeMillis() - mLastAttemptTimestamp;
            if (elapsed < LOCKOUT_DURATION_MS) {
                long remaining = (LOCKOUT_DURATION_MS - elapsed) / 1000;
                showLockoutOverlay(remaining);
                return;
            }
            // Lockout expired, reset
            mAuthAttempts = 0;
        }

        // ── Build the overlay layout ──────────────────────────────
        LinearLayout root = new LinearLayout(mContext);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(80, 120, 80, 120);

        // Semi-transparent dark background
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#E6101020")); // 90% opacity dark blue
        bg.setCornerRadius(0);
        root.setBackground(bg);

        // Shield icon
        TextView shield = new TextView(mContext);
        shield.setText("🛡️");
        shield.setTextSize(64);
        shield.setGravity(Gravity.CENTER);
        root.addView(shield);

        // Title
        TextView title = new TextView(mContext);
        title.setText("Authentication Required");
        title.setTextColor(Color.WHITE);
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 40, 0, 16);
        root.addView(title);

        // Subtitle
        TextView subtitle = new TextView(mContext);
        subtitle.setText("PhishGuard Anti-Theft Protection is active.\n" +
                "Device owner authentication is required\nto access power options.");
        subtitle.setTextColor(Color.parseColor("#99FFFFFF"));
        subtitle.setTextSize(14);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, 0, 0, 48);
        root.addView(subtitle);

        // PIN input placeholder
        TextView pinHint = new TextView(mContext);
        pinHint.setText("Enter owner PIN to continue");
        pinHint.setTextColor(Color.parseColor("#60A5FA"));
        pinHint.setTextSize(16);
        pinHint.setGravity(Gravity.CENTER);
        pinHint.setPadding(0, 0, 0, 24);
        root.addView(pinHint);

        // Dismiss button (just closes overlay, doesn't allow power off)
        TextView dismiss = new TextView(mContext);
        dismiss.setText("DISMISS");
        dismiss.setTextColor(Color.parseColor("#40FFFFFF"));
        dismiss.setTextSize(14);
        dismiss.setGravity(Gravity.CENTER);
        dismiss.setPadding(0, 48, 0, 0);
        dismiss.setOnClickListener(v -> hideAuthenticationOverlay());
        root.addView(dismiss);

        // ── Window params: ABOVE EVERYTHING ───────────────────────
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_SYSTEM_ERROR, // Above power menu
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.CENTER;

        try {
            mWindowManager.addView(root, params);
            mAuthOverlay = root;
            mOverlayShowing = true;

            // Haptic feedback: gentle vibration
            Vibrator vibrator = (Vibrator) mContext.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null) {
                vibrator.vibrate(new long[] { 0, 100, 50, 100 }, -1);
            }

            Log.w(TAG, "Auth overlay displayed — power menu blocked");

            // Auto-dismiss after 10 seconds
            mUiHandler.postDelayed(this::hideAuthenticationOverlay, 10_000);

        } catch (Exception e) {
            Log.e(TAG, "Failed to show auth overlay: " + e.getMessage());
        }
    }

    private void showLockoutOverlay(long remainingSeconds) {
        // Similar to auth overlay but shows lockout message
        Log.w(TAG, "Device locked out for " + remainingSeconds + "s after "
                + MAX_AUTH_ATTEMPTS + " failed attempts");
    }

    private void hideAuthenticationOverlay() {
        if (!mOverlayShowing || mAuthOverlay == null)
            return;

        try {
            mWindowManager.removeView(mAuthOverlay);
            mAuthOverlay = null;
            mOverlayShowing = false;
            Log.d(TAG, "Auth overlay dismissed");
        } catch (Exception e) {
            Log.e(TAG, "Failed to remove auth overlay: " + e.getMessage());
        }
    }

    /**
     * Called when user enters a PIN on the auth overlay.
     *
     * @param pin The entered PIN
     * @return true if authentication succeeded
     */
    public boolean attemptAuthentication(String pin) {
        mAuthAttempts++;
        mLastAttemptTimestamp = System.currentTimeMillis();

        // In production: validate against stored hash
        // SHA-256(pin + device_salt) == stored_hash
        boolean valid = validatePin(pin);

        if (valid) {
            Log.i(TAG, "Authentication SUCCEEDED — releasing power menu");
            mAuthAttempts = 0;
            hideAuthenticationOverlay();
            // Allow the real power menu to show
            return true;
        } else {
            Log.w(TAG, "Authentication FAILED — attempt " + mAuthAttempts
                    + "/" + MAX_AUTH_ATTEMPTS);
            if (mAuthAttempts >= MAX_AUTH_ATTEMPTS) {
                hideAuthenticationOverlay();
                showLockoutOverlay(LOCKOUT_DURATION_MS / 1000);

                // Notify owner of failed break-in attempts
                // (via MQTT or push notification)
            }
            return false;
        }
    }

    private boolean validatePin(String pin) {
        // Placeholder — in production this hashes and compares
        return false;
    }
}
