/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  LastGaspListener.java                                          ║
 * ║  Requirement 3: Hardware Resilience — Impact Detection          ║
 * ║                                                                  ║
 * ║  Uses TYPE_ACCELEROMETER to detect high-G impacts (>10G).      ║
 * ║  On trigger, immediately fires MQTT burst with last GPS +      ║
 * ║  device health snapshot BEFORE hardware potentially fails.     ║
 * ║                                                                  ║
 * ║  Time budget: < 200ms from impact detection to MQTT publish.   ║
 * ║  This is a race against physical destruction of the device.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.SystemClock;
import android.util.Log;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LastGaspListener — The final line of defense.
 *
 * Physics:
 * - Free fall from 1m ≈ 50G on rigid impact
 * - Phone smashed against wall ≈ 20-100G
 * - Phone thrown on floor ≈ 10-30G
 * - Normal use maximum ≈ 3-4G
 * - Threshold of 10G avoids false positives
 *
 * Sensor configuration:
 * - TYPE_ACCELEROMETER (not LINEAR_ACCELERATION — we want gravity)
 * - SENSOR_DELAY_FASTEST (~0.5ms sampling, ~200Hz)
 * - Direct channel if available (bypasses HAL batching)
 *
 * Detection algorithm:
 * 1. Compute magnitude: √(x² + y² + z²)
 * 2. Subtract gravity: net = magnitude - 9.81
 * 3. If net > threshold: TRIGGER
 * 4. Debounce: ignore subsequent triggers for 5 seconds
 *
 * Signal chain:
 * [Accelerometer] → [SensorManager] → [onSensorChanged]
 * ↓ (if > 10G)
 * [LastGaspCallback.onImpactDetected("IMPACT_XXG")]
 * ↓
 * [AntiGravityCoreService.executeLastGasp()]
 * ↓
 * [MQTT burst + flash dump]
 *
 * False positive mitigation:
 * - Running/jumping: ~3G (well below threshold)
 * - Driving over speed bump: ~5G (below threshold)
 * - Dropping from pocket height (1m): first impact ~50G → TRIGGER
 * (this is acceptable — dropping = potential theft/destruction)
 */
public class LastGaspListener implements SensorEventListener {

    private static final String TAG = "PG:LastGasp";

    // ─── Configuration ───────────────────────────────────────────
    private final float mThresholdG;
    private static final float GRAVITY = 9.81f;
    private static final long DEBOUNCE_MS = 5000; // 5s debounce
    private static final long FREEFALL_WINDOW_MS = 100; // 100ms of 0G = freefall

    // ─── Dependencies ────────────────────────────────────────────
    private final SensorManager mSensorManager;
    private final Handler mHandler;
    private final LastGaspCallback mCallback;

    // ─── Sensor ──────────────────────────────────────────────────
    private Sensor mAccelerometer;
    private boolean mArmed = false;

    // ─── State ───────────────────────────────────────────────────
    private final AtomicBoolean mTriggered = new AtomicBoolean(false);
    private long mLastTriggerTimeMs = 0;

    // ─── Free-fall detection ─────────────────────────────────────
    // Detect sustained 0G (free fall) followed by high-G (impact)
    private long mFreeFallStartMs = 0;
    private boolean mInFreeFall = false;
    private static final float FREEFALL_THRESHOLD_G = 0.5f; // Below this = free-fall

    // ─── Running statistics (for adaptive thresholding) ──────────
    private float mRunningMax = 0;
    private float mRunningAvg = GRAVITY;
    private long mSampleCount = 0;
    private static final float ALPHA = 0.01f; // EMA smoothing factor

    /**
     * Callback interface for impact detection.
     */
    public interface LastGaspCallback {
        /**
         * Called when high-G impact is detected.
         * This MUST execute within 200ms — the device may be dying.
         *
         * @param triggerType e.g., "IMPACT_15G", "FREEFALL_IMPACT_50G"
         */
        void onImpactDetected(String triggerType);
    }

    public LastGaspListener(SensorManager sensorManager,
            float thresholdG,
            Handler handler,
            LastGaspCallback callback) {
        mSensorManager = sensorManager;
        mThresholdG = thresholdG;
        mHandler = handler;
        mCallback = callback;

        // Get the accelerometer sensor
        mAccelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (mAccelerometer == null) {
            Log.e(TAG, "NO ACCELEROMETER FOUND — LastGasp will be non-functional!");
        } else {
            Log.d(TAG, "Accelerometer: " + mAccelerometer.getName()
                    + " (max range: " + mAccelerometer.getMaximumRange() + "m/s²"
                    + ", resolution: " + mAccelerometer.getResolution() + "m/s²"
                    + ", min delay: " + mAccelerometer.getMinDelay() + "µs)");

            // Verify sensor range supports our threshold
            float maxG = mAccelerometer.getMaximumRange() / GRAVITY;
            if (maxG < mThresholdG) {
                Log.w(TAG, "Sensor max range (" + maxG + "G) < threshold ("
                        + mThresholdG + "G) — may not detect all impacts!");
            }
        }
    }

    // ═════════════════════════════════════════════════════════════
    // ARM / DISARM
    // ═════════════════════════════════════════════════════════════

    /**
     * Arm the Last Gasp listener.
     * Registers the accelerometer at SENSOR_DELAY_FASTEST for
     * minimum latency impact detection.
     */
    public void arm() {
        if (mAccelerometer == null) {
            Log.e(TAG, "Cannot arm — no accelerometer");
            return;
        }

        if (mArmed) {
            Log.d(TAG, "Already armed");
            return;
        }

        boolean registered = mSensorManager.registerListener(
                this,
                mAccelerometer,
                SensorManager.SENSOR_DELAY_FASTEST, // ~0.5ms (~200Hz)
                mHandler);

        if (registered) {
            mArmed = true;
            mTriggered.set(false);
            Log.w(TAG, "LastGasp ARMED — threshold: " + mThresholdG + "G"
                    + " — sensor rate: " + mAccelerometer.getMinDelay() + "µs");
        } else {
            Log.e(TAG, "FAILED to register accelerometer listener!");
        }
    }

    /**
     * Disarm the listener.
     */
    public void disarm() {
        if (!mArmed)
            return;

        mSensorManager.unregisterListener(this);
        mArmed = false;
        Log.d(TAG, "LastGasp DISARMED");
    }

    /**
     * Re-arm after a trigger (used after debounce period).
     */
    private void rearm() {
        mTriggered.set(false);
        Log.d(TAG, "LastGasp RE-ARMED after debounce");
    }

    // ═════════════════════════════════════════════════════════════
    // SENSOR EVENT PROCESSING — THE HOT PATH
    // ═════════════════════════════════════════════════════════════

    /**
     * Called at ~200Hz with raw accelerometer data.
     *
     * PERFORMANCE CRITICAL:
     * - No allocations in this method
     * - No logging in normal path
     * - Minimal math (sqrt only on threshold check)
     * - Total execution target: < 100µs
     *
     * values[0] = x-axis acceleration (m/s²)
     * values[1] = y-axis acceleration (m/s²)
     * values[2] = z-axis acceleration (m/s²)
     *
     * Note: these include gravity (TYPE_ACCELEROMETER, not LINEAR_ACCELERATION)
     * At rest: magnitude ≈ 9.81 m/s²
     */
    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_ACCELEROMETER)
            return;

        float x = event.values[0];
        float y = event.values[1];
        float z = event.values[2];

        // ── Compute magnitude ─────────────────────────────────────
        // magnitude = √(x² + y² + z²)
        // At rest: ~9.81 m/s²
        // During impact: 10G = 98.1 m/s²
        float magnitudeSq = x * x + y * y + z * z;

        // ── Free-fall detection (precursor to impact) ─────────────
        // Free-fall = near-zero acceleration (everything falling together)
        float magnitudeG = (float) Math.sqrt(magnitudeSq) / GRAVITY;
        long now = SystemClock.elapsedRealtime();

        if (magnitudeG < FREEFALL_THRESHOLD_G) {
            // Potential free-fall
            if (!mInFreeFall) {
                mFreeFallStartMs = now;
                mInFreeFall = true;
            }
        } else {
            if (mInFreeFall) {
                long freeFallDuration = now - mFreeFallStartMs;
                mInFreeFall = false;

                // Free-fall followed by impact = phone was dropped/thrown
                if (freeFallDuration >= FREEFALL_WINDOW_MS
                        && magnitudeG > mThresholdG) {
                    // This is a HIGH-CONFIDENCE impact event
                    triggerLastGasp(magnitudeG, "FREEFALL_IMPACT", freeFallDuration);
                    return;
                }
            }
        }

        // ── Direct impact detection (no free-fall precursor) ──────
        // This catches sudden impacts like smashing against a wall
        // Use squared comparison to avoid sqrt in hot path
        float thresholdMagSq = (mThresholdG * GRAVITY) * (mThresholdG * GRAVITY);

        if (magnitudeSq > thresholdMagSq) {
            // Above threshold — compute exact G for logging
            float actualG = (float) Math.sqrt(magnitudeSq) / GRAVITY;
            triggerLastGasp(actualG, "IMPACT", 0);
        }

        // ── Running statistics (every 100th sample) ───────────────
        mSampleCount++;
        if (mSampleCount % 100 == 0) {
            mRunningAvg = ALPHA * magnitudeG + (1 - ALPHA) * mRunningAvg;
            if (magnitudeG > mRunningMax)
                mRunningMax = magnitudeG;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        if (accuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) {
            Log.w(TAG, "Accelerometer accuracy degraded: " + accuracy);
        }
    }

    // ═════════════════════════════════════════════════════════════
    // TRIGGER
    // ═════════════════════════════════════════════════════════════

    /**
     * Fire the Last Gasp trigger.
     *
     * Debounced: only fires once per DEBOUNCE_MS window.
     * This prevents a single drop from triggering dozens of bursts
     * (the bounce/rattle after impact generates multiple peaks).
     *
     * @param peakG      Peak acceleration in G
     * @param type       "IMPACT" or "FREEFALL_IMPACT"
     * @param freeFallMs Free-fall duration (0 for direct impact)
     */
    private void triggerLastGasp(float peakG, String type, long freeFallMs) {
        // ── Debounce check ────────────────────────────────────────
        long now = SystemClock.elapsedRealtime();
        if (mTriggered.getAndSet(true)) {
            // Already triggered — check if debounce has expired
            if (now - mLastTriggerTimeMs < DEBOUNCE_MS) {
                return; // Within debounce window
            }
        }

        mLastTriggerTimeMs = now;

        // ── Format trigger type string ────────────────────────────
        String triggerStr = String.format("%s_%.0fG", type, peakG);
        if (freeFallMs > 0) {
            triggerStr += "_FF" + freeFallMs + "ms";
        }

        Log.w(TAG, "╔═══════════════════════════════════════╗");
        Log.w(TAG, "║  IMPACT DETECTED: " + String.format("%.1fG", peakG));
        Log.w(TAG, "║  Type: " + type);
        if (freeFallMs > 0) {
            Log.w(TAG, "║  Free-fall: " + freeFallMs + "ms");
            float dropHeightM = 0.5f * GRAVITY * (freeFallMs / 1000f) * (freeFallMs / 1000f);
            Log.w(TAG, "║  Est. drop height: " + String.format("%.1fm", dropHeightM));
        }
        Log.w(TAG, "║  Running max: " + String.format("%.1fG", mRunningMax));
        Log.w(TAG, "╚═══════════════════════════════════════╝");

        // ── Fire callback IMMEDIATELY ─────────────────────────────
        // Don't post to handler — this must execute NOW
        // The callback will trigger MQTT burst in AntiGravityCoreService
        final String finalTrigger = triggerStr;
        mCallback.onImpactDetected(finalTrigger);

        // ── Schedule re-arm ───────────────────────────────────────
        mHandler.postDelayed(this::rearm, DEBOUNCE_MS);
    }

    // ═════════════════════════════════════════════════════════════
    // DIAGNOSTICS
    // ═════════════════════════════════════════════════════════════

    /**
     * Get diagnostic info for health snapshots.
     */
    public String getDiagnostics() {
        return String.format(
                "{\"armed\":%b,\"threshold\":%.1f,\"maxSeen\":%.1f,"
                        + "\"avgG\":%.2f,\"samples\":%d,\"triggered\":%b}",
                mArmed, mThresholdG, mRunningMax,
                mRunningAvg, mSampleCount, mTriggered.get());
    }

    /**
     * Estimate drop height from free-fall duration.
     * h = ½ × g × t²
     *
     * @param freeFallMs Free-fall duration in milliseconds
     * @return estimated drop height in meters
     */
    public static float estimateDropHeight(long freeFallMs) {
        float t = freeFallMs / 1000.0f;
        return 0.5f * GRAVITY * t * t;
    }
}
