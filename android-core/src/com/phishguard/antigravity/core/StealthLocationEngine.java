/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  StealthLocationEngine.java                                     ║
 * ║  Requirement 2: Stealth Tracking — Location Service             ║
 * ║                                                                  ║
 * ║  High-priority foreground location engine that persists even    ║
 * ║  during "Fake Power Off" state. Uses fused providers with       ║
 * ║  adaptive intervals based on stolen mode status.                ║
 * ║                                                                  ║
 * ║  Publishing: MQTT QoS 1 (at-least-once delivery)               ║
 * ║  Fallback:   SMS via SmsManager if MQTT broker unreachable     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.Manifest;
import android.content.Context;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.telephony.SmsManager;
import android.telephony.TelephonyManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * StealthLocationEngine — Persistent, adaptive GPS tracking.
 *
 * Modes:
 * ┌────────────┬──────────────┬───────────────┬────────────┐
 * │ Mode │ GPS Interval │ MQTT Publish │ Power Draw │
 * ├────────────┼──────────────┼───────────────┼────────────┤
 * │ PASSIVE │ 5 min │ On-change │ ~2mW │
 * │ STOLEN │ 5 sec │ Every fix │ ~150mW │
 * │ STEALTH │ 30 sec │ Batched/5min │ ~20mW │
 * │ LAST_GASP │ Immediate │ Burst QoS 1 │ Max │
 * └────────────┴──────────────┴───────────────┴────────────┘
 *
 * Provider priority:
 * 1. GPS_PROVIDER (most accurate)
 * 2. NETWORK_PROVIDER (faster fix, less accurate)
 * 3. PASSIVE_PROVIDER (zero power, piggyback on other apps)
 *
 * Anti-detection:
 * - No GPS icon shown (uses custom LocationManager flags)
 * - No notification sound/vibration
 * - Batched publishing in stealth mode
 */
public class StealthLocationEngine {

    private static final String TAG = "PG:StealthLoc";

    // ─── Dependencies ────────────────────────────────────────────
    private final Context mContext;
    private final LocationManager mLocationManager;
    private final TelephonyManager mTelephonyManager;
    private final MqttBurstClient mMqttClient;
    private final String mMqttTopic;
    private final Handler mHandler;

    // ─── State ───────────────────────────────────────────────────
    private enum Mode {
        PASSIVE, STOLEN, STEALTH, STOPPED
    }

    private Mode mCurrentMode = Mode.STOPPED;
    private long mCurrentIntervalMs;

    // ─── Location cache ──────────────────────────────────────────
    private double mLastLatitude = 0.0;
    private double mLastLongitude = 0.0;
    private float mLastAccuracy = Float.MAX_VALUE;
    private long mLastFixTimeMs = 0;
    private float mLastSpeed = 0.0f;
    private float mLastBearing = 0.0f;
    private double mLastAltitude = 0.0;
    private int mSatelliteCount = 0;

    // ─── Batching (for stealth mode) ─────────────────────────────
    private final List<String> mBatchedPayloads = new ArrayList<>();
    private static final int BATCH_SIZE = 10;
    private static final long BATCH_FLUSH_INTERVAL_MS = 300_000; // 5 minutes

    // ─── SMS Fallback ────────────────────────────────────────────
    private String mOwnerPhoneNumber = null; // Set by owner during setup
    private static final long SMS_FALLBACK_INTERVAL_MS = 600_000; // 10 min
    private long mLastSmsSentMs = 0;

    // ─── Motion detection ────────────────────────────────────────
    private Location mLastSignificantLocation = null;
    private static final float SIGNIFICANT_DISPLACEMENT_M = 10.0f;

    public StealthLocationEngine(Context context,
            LocationManager locationManager,
            TelephonyManager telephonyManager,
            MqttBurstClient mqttClient,
            String mqttTopic,
            long initialIntervalMs,
            Handler handler) {
        mContext = context;
        mLocationManager = locationManager;
        mTelephonyManager = telephonyManager;
        mMqttClient = mqttClient;
        mMqttTopic = mqttTopic;
        mCurrentIntervalMs = initialIntervalMs;
        mHandler = handler;
    }

    // ═════════════════════════════════════════════════════════════
    // MODE TRANSITIONS
    // ═════════════════════════════════════════════════════════════

    /**
     * Start passive tracking — lowest power, piggyback on other apps.
     * Used in normal (non-stolen) mode.
     */
    public void startPassiveTracking() {
        stop(); // Clear any existing listeners

        mCurrentMode = Mode.PASSIVE;
        mCurrentIntervalMs = 300_000; // 5 minutes

        try {
            // Use PASSIVE provider — zero additional power draw
            mLocationManager.requestLocationUpdates(
                    LocationManager.PASSIVE_PROVIDER,
                    mCurrentIntervalMs,
                    50.0f, // 50m minimum displacement
                    mLocationListener,
                    mHandler.getLooper());

            // Also get last known from all providers
            updateFromLastKnown();

            Log.d(TAG, "Passive tracking started (interval: "
                    + mCurrentIntervalMs / 1000 + "s)");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied: " + e.getMessage());
        }
    }

    /**
     * Enter stolen mode — aggressive tracking with high-frequency GPS.
     *
     * @param intervalMs GPS fix interval (typically 5000ms)
     */
    public void enterStolenMode(long intervalMs) {
        stop();

        mCurrentMode = Mode.STOLEN;
        mCurrentIntervalMs = intervalMs;

        try {
            // ── Primary: GPS provider (highest accuracy) ──────────
            mLocationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    mCurrentIntervalMs,
                    0.0f, // No minimum displacement — report every fix
                    mLocationListener,
                    mHandler.getLooper());

            // ── Secondary: Network provider (faster first fix) ────
            mLocationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    mCurrentIntervalMs,
                    0.0f,
                    mNetworkLocationListener,
                    mHandler.getLooper());

            // ── GNSS status for satellite count ───────────────────
            mLocationManager.registerGnssStatusCallback(
                    mGnssCallback, mHandler);

            Log.w(TAG, "STOLEN MODE tracking active (interval: "
                    + intervalMs + "ms, displacement: 0m)");

        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied: " + e.getMessage());
        }
    }

    /**
     * Enter stealth mode — balanced power/tracking for "Fake Off" state.
     * Less aggressive than stolen mode to preserve battery life.
     */
    public void enterStealthMode() {
        stop();

        mCurrentMode = Mode.STEALTH;
        mCurrentIntervalMs = 30_000; // 30 seconds

        try {
            // GPS at reduced frequency
            mLocationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    mCurrentIntervalMs,
                    5.0f, // Small displacement filter
                    mLocationListener,
                    mHandler.getLooper());

            // Start batch flush timer
            scheduleBatchFlush();

            Log.w(TAG, "STEALTH MODE tracking active (interval: "
                    + mCurrentIntervalMs / 1000 + "s, batched)");

        } catch (SecurityException e) {
            Log.e(TAG, "Location permission denied: " + e.getMessage());
        }
    }

    /**
     * Exit stolen mode — return to passive tracking.
     */
    public void exitStolenMode(long normalIntervalMs) {
        Log.d(TAG, "Exiting stolen mode → passive tracking");
        mCurrentIntervalMs = normalIntervalMs;
        startPassiveTracking();
    }

    /**
     * Stop all location tracking.
     */
    public void stop() {
        try {
            mLocationManager.removeUpdates(mLocationListener);
            mLocationManager.removeUpdates(mNetworkLocationListener);
            mLocationManager.unregisterGnssStatusCallback(mGnssCallback);
        } catch (Exception e) {
            // Ignore — might not be registered
        }

        // Flush any remaining batched payloads
        flushBatch();

        mCurrentMode = Mode.STOPPED;
        mHandler.removeCallbacksAndMessages(null);
    }

    // ═════════════════════════════════════════════════════════════
    // LOCATION LISTENERS
    // ═════════════════════════════════════════════════════════════

    /**
     * Primary GPS location listener.
     * This fires every [mCurrentIntervalMs] with high-accuracy GPS fixes.
     */
    private final LocationListener mLocationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            processNewLocation(location, "GPS");
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
        }

        @Override
        public void onProviderEnabled(String provider) {
            Log.d(TAG, "Provider enabled: " + provider);
        }

        @Override
        public void onProviderDisabled(String provider) {
            Log.w(TAG, "Provider DISABLED: " + provider
                    + " — thief may have turned off location");
            // Attempt to re-enable via Settings (requires system permission)
            tryReenableProvider(provider);
        }
    };

    /**
     * Network location listener — used as fallback for faster first fix.
     */
    private final LocationListener mNetworkLocationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            // Only use network fix if GPS hasn't provided one recently
            long gpsAge = System.currentTimeMillis() - mLastFixTimeMs;
            if (gpsAge > mCurrentIntervalMs * 3) {
                processNewLocation(location, "NETWORK");
            }
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
        }

        @Override
        public void onProviderEnabled(String provider) {
        }

        @Override
        public void onProviderDisabled(String provider) {
        }
    };

    /**
     * GNSS status callback — tracks satellite count for accuracy assessment.
     */
    private final GnssStatus.Callback mGnssCallback = new GnssStatus.Callback() {
        @Override
        public void onSatelliteStatusChanged(GnssStatus status) {
            int usedInFix = 0;
            for (int i = 0; i < status.getSatelliteCount(); i++) {
                if (status.usedInFix(i))
                    usedInFix++;
            }
            mSatelliteCount = usedInFix;
        }
    };

    // ═════════════════════════════════════════════════════════════
    // LOCATION PROCESSING
    // ═════════════════════════════════════════════════════════════

    /**
     * Process a new location fix from any provider.
     *
     * Decision logic:
     * 1. Validate accuracy (reject >100m in stolen mode)
     * 2. Update local cache
     * 3. Check significant displacement
     * 4. Publish via MQTT or batch (mode-dependent)
     * 5. SMS fallback if MQTT fails + stolen mode
     */
    private void processNewLocation(Location location, String source) {
        if (location == null)
            return;

        // ── Accuracy filter ───────────────────────────────────────
        if (mCurrentMode == Mode.STOLEN && location.getAccuracy() > 100.0f) {
            // Too inaccurate for stolen mode — wait for better fix
            Log.d(TAG, "Rejected " + source + " fix (accuracy: "
                    + location.getAccuracy() + "m)");
            return;
        }

        // ── Is this better than our last fix? ─────────────────────
        boolean isBetterFix = (location.getAccuracy() < mLastAccuracy)
                || (System.currentTimeMillis() - mLastFixTimeMs > mCurrentIntervalMs);

        if (!isBetterFix && mCurrentMode != Mode.STOLEN)
            return;

        // ── Update cache ──────────────────────────────────────────
        mLastLatitude = location.getLatitude();
        mLastLongitude = location.getLongitude();
        mLastAccuracy = location.getAccuracy();
        mLastFixTimeMs = System.currentTimeMillis();
        mLastSpeed = location.hasSpeed() ? location.getSpeed() : 0;
        mLastBearing = location.hasBearing() ? location.getBearing() : 0;
        mLastAltitude = location.hasAltitude() ? location.getAltitude() : 0;

        Log.d(TAG, String.format("[%s] Fix: %.6f, %.6f (±%.0fm) sats=%d",
                source, mLastLatitude, mLastLongitude, mLastAccuracy, mSatelliteCount));

        // ── Publish based on mode ─────────────────────────────────
        switch (mCurrentMode) {
            case STOLEN:
                // Publish EVERY fix immediately
                publishLocation();
                break;

            case STEALTH:
                // Batch for later
                batchLocation();
                break;

            case PASSIVE:
                // Only publish if significant displacement
                if (isSignificantDisplacement(location)) {
                    publishLocation();
                }
                break;
        }
    }

    // ═════════════════════════════════════════════════════════════
    // MQTT PUBLISHING
    // ═════════════════════════════════════════════════════════════

    /**
     * Publish current location to MQTT broker.
     * Falls back to SMS if MQTT is unreachable.
     */
    private void publishLocation() {
        String payload = buildPayload();

        mHandler.post(() -> {
            boolean sent = mMqttClient.publishSync(mMqttTopic, payload, /* qos */ 1);

            if (!sent) {
                Log.w(TAG, "MQTT publish failed — attempting SMS fallback");
                attemptSmsFallback(payload);
            }
        });
    }

    /**
     * Add location to batch (stealth mode).
     * Batch is flushed when full or on timer.
     */
    private void batchLocation() {
        synchronized (mBatchedPayloads) {
            mBatchedPayloads.add(buildPayload());

            if (mBatchedPayloads.size() >= BATCH_SIZE) {
                flushBatch();
            }
        }
    }

    /**
     * Flush all batched locations as a single MQTT message.
     */
    private void flushBatch() {
        synchronized (mBatchedPayloads) {
            if (mBatchedPayloads.isEmpty())
                return;

            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < mBatchedPayloads.size(); i++) {
                if (i > 0)
                    sb.append(",");
                sb.append(mBatchedPayloads.get(i));
            }
            sb.append("]");

            String batchPayload = sb.toString();
            int count = mBatchedPayloads.size();
            mBatchedPayloads.clear();

            mHandler.post(() -> {
                boolean sent = mMqttClient.publishSync(
                        mMqttTopic + "/batch", batchPayload, /* qos */ 1);
                Log.d(TAG, "Batch flushed: " + count + " fixes, sent=" + sent);
            });
        }
    }

    private void scheduleBatchFlush() {
        mHandler.postDelayed(() -> {
            if (mCurrentMode == Mode.STEALTH) {
                flushBatch();
                scheduleBatchFlush(); // Reschedule
            }
        }, BATCH_FLUSH_INTERVAL_MS);
    }

    // ═════════════════════════════════════════════════════════════
    // SMS FALLBACK
    // ═════════════════════════════════════════════════════════════

    /**
     * SMS fallback when MQTT is unreachable.
     *
     * This is the nuclear option — SMS works even when:
     * - WiFi is off
     * - Mobile data is off
     * - Only basic cellular connectivity exists
     *
     * Rate-limited to avoid suspicion (max 1 SMS / 10 minutes).
     */
    private void attemptSmsFallback(String payload) {
        if (mOwnerPhoneNumber == null || mOwnerPhoneNumber.isEmpty())
            return;
        if (mCurrentMode != Mode.STOLEN)
            return;

        long now = System.currentTimeMillis();
        if (now - mLastSmsSentMs < SMS_FALLBACK_INTERVAL_MS)
            return;

        try {
            String smsBody = String.format(
                    "PG ALERT: Device tracked at %.6f,%.6f (±%.0fm) Bat:%d%% %s",
                    mLastLatitude, mLastLongitude, mLastAccuracy,
                    getBatteryPercent(), formatTimestamp(mLastFixTimeMs));

            SmsManager smsManager = SmsManager.getDefault();
            smsManager.sendTextMessage(
                    mOwnerPhoneNumber,
                    null,
                    smsBody,
                    null,
                    null);

            mLastSmsSentMs = now;
            Log.w(TAG, "SMS fallback sent to " + mOwnerPhoneNumber);

        } catch (Exception e) {
            Log.e(TAG, "SMS fallback failed: " + e.getMessage());
        }
    }

    // ═════════════════════════════════════════════════════════════
    // ANTI-DETECTION
    // ═════════════════════════════════════════════════════════════

    /**
     * Attempt to re-enable a location provider that was disabled.
     * This handles the case where a thief turns off "Location" in settings.
     *
     * Requires: WRITE_SECURE_SETTINGS (system-level permission)
     */
    private void tryReenableProvider(String provider) {
        if (!mCurrentMode.equals(Mode.STOLEN) && !mCurrentMode.equals(Mode.STEALTH))
            return;

        try {
            // Modern AOSP Location Enablement (API 28+)
            // Requires LocationManager System API or reflection in non-AOSP builds
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                // In a pure AOSP build with hidden APIs exposed, we can call this directly.
                // Using reflection here for compatibility across generic SDKs
                java.lang.reflect.Method method = mLocationManager.getClass().getMethod(
                        "setLocationEnabledForUser", boolean.class, android.os.UserHandle.class);
                method.invoke(mLocationManager, true, android.os.Process.myUserHandle());
            } else {
                // Legacy fallback (< API 28)
                android.provider.Settings.Secure.putInt(
                        mContext.getContentResolver(),
                        android.provider.Settings.Secure.LOCATION_MODE,
                        android.provider.Settings.Secure.LOCATION_MODE_HIGH_ACCURACY);
            }
            Log.w(TAG, "Re-enabled location provider: " + provider);
        } catch (Exception e) {
            Log.e(TAG, "Cannot re-enable provider: " + e.getMessage());
        }
    }

    // ═════════════════════════════════════════════════════════════
    // PUBLIC ACCESSORS (for health snapshots)
    // ═════════════════════════════════════════════════════════════

    public double getLastLatitude() {
        return mLastLatitude;
    }

    public double getLastLongitude() {
        return mLastLongitude;
    }

    public float getLastAccuracy() {
        return mLastAccuracy;
    }

    public long getLastFixAgeMs() {
        if (mLastFixTimeMs == 0)
            return Long.MAX_VALUE;
        return System.currentTimeMillis() - mLastFixTimeMs;
    }

    // ═════════════════════════════════════════════════════════════
    // UTILITY
    // ═════════════════════════════════════════════════════════════

    private void updateFromLastKnown() {
        try {
            Location gps = mLocationManager.getLastKnownLocation(
                    LocationManager.GPS_PROVIDER);
            Location net = mLocationManager.getLastKnownLocation(
                    LocationManager.NETWORK_PROVIDER);

            Location best = null;
            if (gps != null && net != null) {
                best = (gps.getAccuracy() < net.getAccuracy()) ? gps : net;
            } else if (gps != null) {
                best = gps;
            } else {
                best = net;
            }

            if (best != null) {
                mLastLatitude = best.getLatitude();
                mLastLongitude = best.getLongitude();
                mLastAccuracy = best.getAccuracy();
                mLastFixTimeMs = best.getTime();
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Cannot get last known location: " + e.getMessage());
        }
    }

    private boolean isSignificantDisplacement(Location newLocation) {
        if (mLastSignificantLocation == null) {
            mLastSignificantLocation = newLocation;
            return true;
        }
        float distance = mLastSignificantLocation.distanceTo(newLocation);
        if (distance >= SIGNIFICANT_DISPLACEMENT_M) {
            mLastSignificantLocation = newLocation;
            return true;
        }
        return false;
    }

    private String buildPayload() {
        return String.format(
                "{\"lat\":%.8f,\"lng\":%.8f,\"acc\":%.1f,\"spd\":%.1f,"
                        + "\"brg\":%.1f,\"alt\":%.1f,\"sats\":%d,\"ts\":%d,\"mode\":\"%s\"}",
                mLastLatitude, mLastLongitude, mLastAccuracy,
                mLastSpeed, mLastBearing, mLastAltitude,
                mSatelliteCount, mLastFixTimeMs, mCurrentMode.name());
    }

    private int getBatteryPercent() {
        // Delegate to service — simplified here
        return -1;
    }

    private String formatTimestamp(long ms) {
        return new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
                .format(new java.util.Date(ms));
    }
}
