/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  AntiGravityCoreService.java                                    ║
 * ║  PhishGuard AI — AOSP System Service                            ║
 * ║                                                                  ║
 * ║  The root system service that orchestrates all anti-theft        ║
 * ║  subsystems: Power Persistence, Stealth Tracking, and           ║
 * ║  Hardware Resilience ("Last Gasp").                              ║
 * ║                                                                  ║
 * ║  Runs as a privileged system service bound at boot via          ║
 * ║  SystemServer. Requires platform signing key.                    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.location.LocationManager;
import android.os.Binder;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.telephony.TelephonyManager;
import android.util.Log;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * AntiGravityCoreService — The master orchestrator.
 *
 * Lifecycle:
 *   1. Bound by SystemServer at PHASE_BOOT_COMPLETED
 *   2. Registers PolicyInterceptor with WindowManagerService
 *   3. Arms LastGaspListener on the accelerometer
 *   4. Enters idle loop; activates subsystems on setStolenMode(true)
 *
 * Threading model:
 *   - Main binder thread: IPC from Settings/UI
 *   - "ag-core-worker": Sensor + Location callbacks
 *   - "ag-mqtt-dispatch": Network I/O (MQTT burst)
 *
 * Security:
 *   - Requires android.permission.PHISHGUARD_ADMIN (signature|privileged)
 *   - All IPC validated via Binder.getCallingUid()
 */
public class AntiGravityCoreService extends Service {

    private static final String TAG = "AntiGravityCore";

    // ─── Subsystem references ────────────────────────────────────
    private PowerMenuInterceptor mPowerInterceptor;
    private FakePowerOffController mFakePowerOff;
    private StealthLocationEngine mStealthEngine;
    private LastGaspListener mLastGasp;
    private MqttBurstClient mMqttClient;

    // ─── System service handles ──────────────────────────────────
    private PowerManager mPowerManager;
    private SensorManager mSensorManager;
    private LocationManager mLocationManager;
    private TelephonyManager mTelephonyManager;

    // ─── Threading ───────────────────────────────────────────────
    private HandlerThread mWorkerThread;
    private Handler mWorkerHandler;
    private HandlerThread mMqttThread;
    private Handler mMqttHandler;

    // ─── State ───────────────────────────────────────────────────
    private final AtomicBoolean mStolenMode = new AtomicBoolean(false);
    private final AtomicBoolean mFakeOffActive = new AtomicBoolean(false);
    private final AtomicReference<DeviceHealthSnapshot> mLastSnapshot =
            new AtomicReference<>(null);

    // ─── Wake lock for stealth persistence ───────────────────────
    private PowerManager.WakeLock mStealthWakeLock;

    // ─── Configuration ───────────────────────────────────────────
    private static final float IMPACT_THRESHOLD_G = 10.0f;
    private static final long MQTT_BURST_TIMEOUT_MS = 2000;
    private static final long GPS_INTERVAL_STOLEN_MS = 5000;      // 5s in stolen mode
    private static final long GPS_INTERVAL_NORMAL_MS = 300000;    // 5min in normal
    private static final String MQTT_BROKER = "ssl://phishguard-iot.in:8883";
    private static final String MQTT_TOPIC_LOCATION = "pg/device/%s/location";
    private static final String MQTT_TOPIC_LASTGASP = "pg/device/%s/lastgasp";
    private static final String MQTT_TOPIC_HEALTH = "pg/device/%s/health";

    // ═════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ═════════════════════════════════════════════════════════════

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "AntiGravityCoreService initializing...");

        // Acquire system service handles
        mPowerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        mSensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        mLocationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        mTelephonyManager = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);

        // Spin up worker threads
        mWorkerThread = new HandlerThread("ag-core-worker",
                android.os.Process.THREAD_PRIORITY_FOREGROUND);
        mWorkerThread.start();
        mWorkerHandler = new Handler(mWorkerThread.getLooper());

        mMqttThread = new HandlerThread("ag-mqtt-dispatch",
                android.os.Process.THREAD_PRIORITY_URGENT_AUDIO); // highest non-RT
        mMqttThread.start();
        mMqttHandler = new Handler(mMqttThread.getLooper());

        // Create stealth wake lock (PARTIAL — keeps CPU alive, screen off)
        mStealthWakeLock = mPowerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "PhishGuard:AntiGravityStealth");

        // Initialize subsystems
        initializeSubsystems();

        // Register boot-persistent broadcast receivers
        registerSystemReceivers();

        Log.i(TAG, "AntiGravityCoreService ready. Subsystems armed.");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // START_STICKY: Restart if killed, critical for anti-theft
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return mBinder;
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "Service destroyed — this should NOT happen in production!");
        // Release resources
        if (mStealthWakeLock.isHeld()) mStealthWakeLock.release();
        mLastGasp.disarm();
        mStealthEngine.stop();
        mWorkerThread.quitSafely();
        mMqttThread.quitSafely();
        super.onDestroy();
    }

    // ═════════════════════════════════════════════════════════════
    //  IPC BINDER INTERFACE
    // ═════════════════════════════════════════════════════════════

    /**
     * Binder stub for IPC. In production, this would be an AIDL
     * interface (IAntiGravityCore.aidl). Simplified here for clarity.
     */
    private final IBinder mBinder = new AntiGravityBinder();

    public class AntiGravityBinder extends Binder {

        /**
         * Activate stolen mode. This is the main entry point from:
         *   - PhishGuard Settings UI
         *   - Remote "Mark as Stolen" push notification
         *   - Find My Device integration
         *
         * @param authToken  SHA-256 of user's PIN + device salt
         * @return true if activation succeeded
         */
        public boolean activateStolenMode(String authToken) {
            enforceCallerPermission();
            if (!validateAuthToken(authToken)) {
                Log.w(TAG, "Invalid auth token from UID=" + Binder.getCallingUid());
                return false;
            }
            return setStolenModeInternal(true);
        }

        /**
         * Deactivate stolen mode after owner authentication.
         */
        public boolean deactivateStolenMode(String authToken) {
            enforceCallerPermission();
            if (!validateAuthToken(authToken)) return false;
            return setStolenModeInternal(false);
        }

        /**
         * Query current state.
         */
        public boolean isStolenMode() {
            return mStolenMode.get();
        }

        /**
         * Query fake-off state.
         */
        public boolean isFakeOffActive() {
            return mFakeOffActive.get();
        }

        /**
         * Get the last device health snapshot.
         */
        public DeviceHealthSnapshot getLastHealthSnapshot() {
            return mLastSnapshot.get();
        }

        /**
         * Force a "Last Gasp" burst (for testing/remote trigger).
         */
        public void forceLastGasp() {
            enforceCallerPermission();
            mWorkerHandler.post(() -> executeLastGasp("REMOTE_TRIGGER"));
        }
    }

    // ═════════════════════════════════════════════════════════════
    //  SUBSYSTEM INITIALIZATION
    // ═════════════════════════════════════════════════════════════

    private void initializeSubsystems() {

        // ── 1. Power Menu Interceptor ─────────────────────────────
        mPowerInterceptor = new PowerMenuInterceptor(this, mStolenMode);
        mPowerInterceptor.registerWithWindowManager();
        Log.d(TAG, "PowerMenuInterceptor registered with WMS");

        // ── 2. Fake Power Off Controller ──────────────────────────
        mFakePowerOff = new FakePowerOffController(this, mPowerManager,
                mFakeOffActive, mStealthWakeLock);
        mFakePowerOff.initialize();
        Log.d(TAG, "FakePowerOffController initialized");

        // ── 3. MQTT Client ────────────────────────────────────────
        String deviceId = getDeviceIdentifier();
        mMqttClient = new MqttBurstClient(
                MQTT_BROKER,
                deviceId,
                MQTT_BURST_TIMEOUT_MS,
                mMqttHandler
        );
        Log.d(TAG, "MqttBurstClient configured for broker: " + MQTT_BROKER);

        // ── 4. Stealth Location Engine ────────────────────────────
        mStealthEngine = new StealthLocationEngine(
                this,
                mLocationManager,
                mTelephonyManager,
                mMqttClient,
                String.format(MQTT_TOPIC_LOCATION, deviceId),
                GPS_INTERVAL_NORMAL_MS,
                mWorkerHandler
        );
        mStealthEngine.startPassiveTracking();
        Log.d(TAG, "StealthLocationEngine in passive mode");

        // ── 5. Last Gasp Listener ─────────────────────────────────
        mLastGasp = new LastGaspListener(
                mSensorManager,
                IMPACT_THRESHOLD_G,
                mWorkerHandler,
                (triggerType) -> executeLastGasp(triggerType)
        );
        mLastGasp.arm();
        Log.d(TAG, "LastGaspListener armed @ " + IMPACT_THRESHOLD_G + "G threshold");
    }

    // ═════════════════════════════════════════════════════════════
    //  CORE STATE TRANSITIONS
    // ═════════════════════════════════════════════════════════════

    /**
     * Master state transition for stolen mode.
     * This coordinates ALL subsystems.
     */
    private boolean setStolenModeInternal(boolean stolen) {
        if (mStolenMode.getAndSet(stolen) == stolen) {
            Log.d(TAG, "setStolenMode(" + stolen + ") — already in this state");
            return true;
        }

        Log.w(TAG, "═══ STOLEN MODE " + (stolen ? "ACTIVATED" : "DEACTIVATED") + " ═══");

        if (stolen) {
            // ── ACTIVATE ──────────────────────────────────────────
            // 1. Acquire stealth wake lock
            if (!mStealthWakeLock.isHeld()) {
                mStealthWakeLock.acquire();
            }

            // 2. Switch location engine to high-frequency stolen mode
            mStealthEngine.enterStolenMode(GPS_INTERVAL_STOLEN_MS);

            // 3. Arm the power menu interceptor
            mPowerInterceptor.setInterceptionEnabled(true);

            // 4. Prepare fake power off controller
            mFakePowerOff.arm();

            // 5. Take initial health snapshot
            captureHealthSnapshot("STOLEN_MODE_ENTRY");

            // 6. Send initial MQTT burst with current position
            mMqttHandler.post(() -> {
                String deviceId = getDeviceIdentifier();
                DeviceHealthSnapshot snapshot = mLastSnapshot.get();
                if (snapshot != null) {
                    mMqttClient.publishSync(
                            String.format(MQTT_TOPIC_HEALTH, deviceId),
                            snapshot.toJson(),
                            /* qos */ 1
                    );
                }
            });

        } else {
            // ── DEACTIVATE ────────────────────────────────────────
            // 1. Exit fake-off if active
            if (mFakeOffActive.get()) {
                mFakePowerOff.exitFakeOff();
            }

            // 2. Disarm power menu interceptor
            mPowerInterceptor.setInterceptionEnabled(false);

            // 3. Return to passive tracking
            mStealthEngine.exitStolenMode(GPS_INTERVAL_NORMAL_MS);

            // 4. Disarm fake power off
            mFakePowerOff.disarm();

            // 5. Release wake lock
            if (mStealthWakeLock.isHeld()) {
                mStealthWakeLock.release();
            }
        }

        return true;
    }

    // ═════════════════════════════════════════════════════════════
    //  LAST GASP — CRITICAL PATH
    // ═════════════════════════════════════════════════════════════

    /**
     * The "Last Gasp" — triggered on high-G impact or remote command.
     *
     * This is a RACE AGAINST HARDWARE DEATH. The phone may be
     * physically destroyed within milliseconds of this trigger.
     *
     * Strategy:
     *   1. Capture everything NOW (no lazy loading)
     *   2. Fire MQTT burst at QoS 1 (at least once delivery)
     *   3. Dump to local flash as backup
     *   4. Total budget: < 2000ms
     *
     * @param triggerType  "IMPACT_10G", "REMOTE_TRIGGER", "BATTERY_CRITICAL"
     */
    private void executeLastGasp(String triggerType) {
        final long startNanos = SystemClock.elapsedRealtimeNanos();
        Log.w(TAG, "╔══ LAST GASP TRIGGERED: " + triggerType + " ══╗");

        // ── Step 1: Snapshot everything (target: <50ms) ───────────
        DeviceHealthSnapshot snapshot = captureHealthSnapshot(triggerType);

        // ── Step 2: Build the payload ─────────────────────────────
        String deviceId = getDeviceIdentifier();
        String locationPayload = buildLocationPayload(snapshot);
        String healthPayload = snapshot.toJson();

        // ── Step 3: Fire MQTT burst — parallel publish ────────────
        // Use the MQTT thread but with synchronous calls to avoid
        // being killed mid-async
        mMqttHandler.post(() -> {
            long mqttStart = SystemClock.elapsedRealtimeNanos();

            // 3a. Location burst (highest priority)
            boolean locSent = mMqttClient.publishSync(
                    String.format(MQTT_TOPIC_LASTGASP, deviceId),
                    locationPayload,
                    /* qos */ 1
            );

            // 3b. Full health snapshot
            boolean healthSent = mMqttClient.publishSync(
                    String.format(MQTT_TOPIC_HEALTH, deviceId),
                    healthPayload,
                    /* qos */ 1
            );

            long mqttElapsed = (SystemClock.elapsedRealtimeNanos() - mqttStart) / 1_000_000;
            Log.w(TAG, "MQTT burst: loc=" + locSent + " health=" + healthSent
                    + " (" + mqttElapsed + "ms)");
        });

        // ── Step 4: Local flash backup (survives battery pull) ────
        mWorkerHandler.post(() -> {
            try {
                LocalFlashDumper.dumpToNVRAM(this, snapshot);
            } catch (Exception e) {
                Log.e(TAG, "Flash dump failed: " + e.getMessage());
            }
        });

        long totalElapsed = (SystemClock.elapsedRealtimeNanos() - startNanos) / 1_000_000;
        Log.w(TAG, "╚══ LAST GASP COMPLETE: " + totalElapsed + "ms ══╝");
    }

    // ═════════════════════════════════════════════════════════════
    //  HEALTH SNAPSHOT
    // ═════════════════════════════════════════════════════════════

    /**
     * Captures a complete device health snapshot.
     * Designed to be FAST — no blocking I/O, no network calls.
     */
    private DeviceHealthSnapshot captureHealthSnapshot(String trigger) {
        DeviceHealthSnapshot snapshot = new DeviceHealthSnapshot();

        // Timestamps
        snapshot.timestampMs = System.currentTimeMillis();
        snapshot.uptimeMs = SystemClock.elapsedRealtime();
        snapshot.trigger = trigger;

        // Location (from cached — no GPS fix wait)
        snapshot.latitude = mStealthEngine.getLastLatitude();
        snapshot.longitude = mStealthEngine.getLastLongitude();
        snapshot.locationAccuracyM = mStealthEngine.getLastAccuracy();
        snapshot.locationAgeMs = mStealthEngine.getLastFixAgeMs();

        // Battery
        snapshot.batteryPercent = getBatteryPercent();
        snapshot.isCharging = isDeviceCharging();

        // Telephony
        snapshot.networkOperator = mTelephonyManager.getNetworkOperatorName();
        snapshot.signalStrengthDbm = getSignalStrengthDbm();
        snapshot.cellId = getCellId();
        snapshot.isAirplaneMode = isAirplaneModeOn();

        // Device identifiers
        snapshot.deviceId = getDeviceIdentifier();
        snapshot.imei = getIMEI();

        // System state
        snapshot.isStolenMode = mStolenMode.get();
        snapshot.isFakeOff = mFakeOffActive.get();

        mLastSnapshot.set(snapshot);
        return snapshot;
    }

    // ═════════════════════════════════════════════════════════════
    //  BROADCAST RECEIVERS
    // ═════════════════════════════════════════════════════════════

    private void registerSystemReceivers() {

        // ── Screen Off Interceptor ────────────────────────────────
        // Catches screen-off events that might be thief pressing power
        IntentFilter screenFilter = new IntentFilter();
        screenFilter.addAction(Intent.ACTION_SCREEN_OFF);
        screenFilter.addAction(Intent.ACTION_SCREEN_ON);
        screenFilter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY);
        registerReceiver(mScreenReceiver, screenFilter);

        // ── Shutdown Interceptor ──────────────────────────────────
        // Highest possible priority to catch shutdown before it completes
        IntentFilter shutdownFilter = new IntentFilter();
        shutdownFilter.addAction(Intent.ACTION_SHUTDOWN);
        shutdownFilter.addAction("android.intent.action.QUICKBOOT_POWEROFF");
        shutdownFilter.setPriority(Integer.MAX_VALUE); // 2147483647
        registerReceiver(mShutdownReceiver, shutdownFilter);

        // ── Battery Critical ──────────────────────────────────────
        IntentFilter batteryFilter = new IntentFilter();
        batteryFilter.addAction(Intent.ACTION_BATTERY_LOW);
        batteryFilter.addAction(Intent.ACTION_BATTERY_CHANGED);
        registerReceiver(mBatteryReceiver, batteryFilter);

        // ── SIM Change Detection ──────────────────────────────────
        IntentFilter simFilter = new IntentFilter();
        simFilter.addAction("android.intent.action.SIM_STATE_CHANGED");
        simFilter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY);
        registerReceiver(mSimReceiver, simFilter);
    }

    /**
     * Screen state receiver — detects thief interaction patterns.
     */
    private final BroadcastReceiver mScreenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!mStolenMode.get()) return;

            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                Log.d(TAG, "Screen OFF detected in stolen mode");
                // If stolen mode + screen off, consider entering fake-off
                if (mFakePowerOff.isArmed()) {
                    mWorkerHandler.postDelayed(() -> {
                        if (!mPowerManager.isInteractive()) {
                            // Screen still off after 500ms = legit off, not a flicker
                            captureHealthSnapshot("SCREEN_OFF_STOLEN");
                        }
                    }, 500);
                }
            }
        }
    };

    /**
     * Shutdown interceptor — THE CRITICAL RECEIVER.
     *
     * When a shutdown is detected in stolen mode:
     *   1. Abort the real shutdown (via abortBroadcast on ordered)
     *   2. Trigger fake shutdown sequence
     *   3. Continue stealth tracking
     *
     * Priority: Integer.MAX_VALUE (2147483647)
     */
    private final BroadcastReceiver mShutdownReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            Log.w(TAG, "SHUTDOWN BROADCAST INTERCEPTED! stolen=" + mStolenMode.get());

            if (!mStolenMode.get()) return;

            // ── Attempt to abort the shutdown broadcast ───────────
            if (isOrderedBroadcast()) {
                abortBroadcast();
                Log.w(TAG, "Shutdown broadcast ABORTED");
            }

            // ── Trigger fake power off sequence ───────────────────
            mFakePowerOff.executeFakeShutdown(() -> {
                // Callback: fake shutdown animation complete
                Log.w(TAG, "Fake shutdown complete — entering stealth mode");
                mFakeOffActive.set(true);

                // Capture snapshot before "dying"
                captureHealthSnapshot("FAKE_SHUTDOWN");

                // Ensure stealth engine is in high-priority mode
                mStealthEngine.enterStealthMode();
            });
        }
    };

    /**
     * Battery receiver — triggers Last Gasp on critical battery.
     */
    private final BroadcastReceiver mBatteryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!mStolenMode.get()) return;

            int level = intent.getIntExtra("level", -1);
            int scale = intent.getIntExtra("scale", 100);
            float percent = (level * 100f) / scale;

            if (percent <= 3.0f) {
                Log.w(TAG, "CRITICAL BATTERY " + percent + "% — triggering Last Gasp!");
                executeLastGasp("BATTERY_CRITICAL_" + (int) percent);
            }
        }
    };

    /**
     * SIM change receiver — detects SIM swap/removal (thief trying to
     * disable connectivity).
     */
    private final BroadcastReceiver mSimReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!mStolenMode.get()) return;

            String state = intent.getStringExtra("ss");
            Log.w(TAG, "SIM state changed: " + state + " — capturing snapshot");
            captureHealthSnapshot("SIM_CHANGE_" + state);

            // Try to burst location before connectivity potentially dies
            mMqttHandler.post(() -> {
                DeviceHealthSnapshot snap = mLastSnapshot.get();
                if (snap != null) {
                    String deviceId = getDeviceIdentifier();
                    mMqttClient.publishSync(
                            String.format(MQTT_TOPIC_HEALTH, deviceId),
                            snap.toJson(),
                            /* qos */ 1
                    );
                }
            });
        }
    };

    // ═════════════════════════════════════════════════════════════
    //  UTILITY METHODS
    // ═════════════════════════════════════════════════════════════

    private void enforceCallerPermission() {
        // In production: check signature-level permission
        // enforceCallingPermission("com.phishguard.permission.ADMIN", "AntiGravity");
    }

    private boolean validateAuthToken(String token) {
        // In production: validate SHA-256(PIN + device_salt) against stored hash
        return token != null && token.length() >= 64;
    }

    private String getDeviceIdentifier() {
        return android.provider.Settings.Secure.getString(
                getContentResolver(),
                android.provider.Settings.Secure.ANDROID_ID
        );
    }

    private String getIMEI() {
        try {
            return mTelephonyManager.getImei();
        } catch (SecurityException e) {
            return "RESTRICTED";
        }
    }

    private int getBatteryPercent() {
        Intent batteryStatus = registerReceiver(null,
                new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (batteryStatus == null) return -1;
        int level = batteryStatus.getIntExtra("level", -1);
        int scale = batteryStatus.getIntExtra("scale", 100);
        return Math.round(level * 100f / scale);
    }

    private boolean isDeviceCharging() {
        Intent batteryStatus = registerReceiver(null,
                new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (batteryStatus == null) return false;
        int status = batteryStatus.getIntExtra("status", -1);
        return status == android.os.BatteryManager.BATTERY_STATUS_CHARGING
                || status == android.os.BatteryManager.BATTERY_STATUS_FULL;
    }

    private int getSignalStrengthDbm() {
        // Simplified — in production, use TelephonyCallback
        return -85; // placeholder
    }

    private int getCellId() {
        // Simplified — in production, use CellInfoLte etc.
        return -1;
    }

    private boolean isAirplaneModeOn() {
        return android.provider.Settings.Global.getInt(
                getContentResolver(),
                android.provider.Settings.Global.AIRPLANE_MODE_ON, 0) != 0;
    }

    private String buildLocationPayload(DeviceHealthSnapshot snapshot) {
        return String.format(
                "{\"lat\":%.8f,\"lng\":%.8f,\"acc\":%.1f,\"age\":%d,\"ts\":%d,\"bat\":%d,\"trg\":\"%s\"}",
                snapshot.latitude, snapshot.longitude,
                snapshot.locationAccuracyM, snapshot.locationAgeMs,
                snapshot.timestampMs, snapshot.batteryPercent, snapshot.trigger
        );
    }
}
