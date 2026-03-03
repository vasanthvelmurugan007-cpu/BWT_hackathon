/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  LocalFlashDumper.java                                          ║
 * ║  NVRAM / Persistent Storage Backup for Last Gasp                ║
 * ║                                                                  ║
 * ║  Dumps critical data to flash storage that survives:            ║
 * ║    - Battery pull                                                ║
 * ║    - Force reboot                                                ║
 * ║    - Factory reset (if written to protected partition)          ║
 * ║                                                                  ║
 * ║  Uses Android's SharedPreferences (MODE_PRIVATE, committed     ║
 * ║  synchronously) as the portable fallback. On AOSP builds,      ║
 * ║  can write directly to /persist/ or /mnt/vendor/ partition.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * LocalFlashDumper — Last resort data persistence.
 *
 * Write locations (in order of resilience):
 *
 * ┌─────────────────────────┬──────────────────┬───────────────────┐
 * │ Location │ Survives? │ Access Level │
 * ├─────────────────────────┼──────────────────┼───────────────────┤
 * │ /persist/phishguard/ │ Factory reset │ AOSP system only │
 * │ /data/system/phishguard │ Reboot, bat pull │ System service │
 * │ SharedPreferences │ Reboot, bat pull │ App-level │
 * │ /sdcard/Android/.pg/ │ Reboot │ App with storage │
 * └─────────────────────────┴──────────────────┴───────────────────┘
 *
 * Data format: JSON (same as DeviceHealthSnapshot.toJson())
 * Max entries: 100 (ring buffer — oldest entries overwritten)
 */
public class LocalFlashDumper {

    private static final String TAG = "PG:FlashDump";
    private static final String PREFS_NAME = "phishguard_lastgasp";
    private static final String KEY_PREFIX = "gasp_";
    private static final String KEY_INDEX = "gasp_index";
    private static final int MAX_ENTRIES = 100;

    // AOSP system partition paths
    private static final String PERSIST_PATH = "/persist/phishguard/lastgasp.json";
    private static final String SYSTEM_DATA_PATH = "/data/system/phishguard/lastgasp.json";

    /**
     * Dump a health snapshot to all available persistent storage.
     * Writes to multiple locations for maximum resilience.
     *
     * This method is designed to complete in < 50ms.
     * SharedPreferences.commit() is used (not apply()) because
     * we need synchronous write — the device might die any moment.
     *
     * @param context  Application context
     * @param snapshot The health snapshot to persist
     */
    public static void dumpToNVRAM(Context context, DeviceHealthSnapshot snapshot) {
        if (snapshot == null)
            return;

        long startMs = System.currentTimeMillis();
        String json = snapshot.toCompactJson(); // Use compact for speed

        int successCount = 0;

        // ── Strategy 1: SharedPreferences (most reliable) ─────────
        try {
            SharedPreferences prefs = context.getSharedPreferences(
                    PREFS_NAME, Context.MODE_PRIVATE);
            int index = prefs.getInt(KEY_INDEX, 0);
            int nextIndex = (index + 1) % MAX_ENTRIES;

            boolean committed = prefs.edit()
                    .putString(KEY_PREFIX + index, json)
                    .putInt(KEY_INDEX, nextIndex)
                    .putLong("last_dump_ts", snapshot.timestampMs)
                    .putString("last_trigger", snapshot.trigger)
                    .commit(); // COMMIT, not apply() — synchronous!

            if (committed) {
                successCount++;
                Log.d(TAG, "SharedPrefs dump OK (slot " + index + ")");
            }
        } catch (Exception e) {
            Log.e(TAG, "SharedPrefs dump failed: " + e.getMessage());
        }

        // ── Strategy 2: System data partition ─────────────────────
        try {
            writeToFile(SYSTEM_DATA_PATH, json);
            successCount++;
            Log.d(TAG, "System data dump OK");
        } catch (Exception e) {
            // Expected to fail on non-rooted devices
            Log.d(TAG, "System data dump skipped (no access)");
        }

        // ── Strategy 3: Persist partition (AOSP only) ─────────────
        try {
            writeToFile(PERSIST_PATH, json);
            successCount++;
            Log.d(TAG, "Persist partition dump OK");
        } catch (Exception e) {
            Log.d(TAG, "Persist partition dump skipped (no access)");
        }

        // ── Strategy 4: App-private storage ───────────────────────
        try {
            File appDir = new File(context.getFilesDir(), "lastgasp");
            if (!appDir.exists())
                appDir.mkdirs();

            String filename = "gasp_" + snapshot.timestampMs + ".json";
            File gaspFile = new File(appDir, filename);
            writeToFile(gaspFile.getAbsolutePath(), json);
            successCount++;

            // Clean up old files (keep last 50)
            cleanupOldFiles(appDir, 50);

            Log.d(TAG, "App storage dump OK: " + filename);
        } catch (Exception e) {
            Log.e(TAG, "App storage dump failed: " + e.getMessage());
        }

        long elapsed = System.currentTimeMillis() - startMs;
        Log.w(TAG, "Flash dump complete: " + successCount + " locations"
                + " (" + elapsed + "ms) payload=" + json.length() + "B");
    }

    /**
     * Retrieve all stored Last Gasp entries.
     *
     * @param context Application context
     * @return Array of JSON strings (newest first)
     */
    public static String[] retrieveAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(
                PREFS_NAME, Context.MODE_PRIVATE);
        int currentIndex = prefs.getInt(KEY_INDEX, 0);

        java.util.List<String> entries = new java.util.ArrayList<>();

        // Read backwards from current index
        for (int i = 0; i < MAX_ENTRIES; i++) {
            int idx = (currentIndex - 1 - i + MAX_ENTRIES) % MAX_ENTRIES;
            String entry = prefs.getString(KEY_PREFIX + idx, null);
            if (entry != null) {
                entries.add(entry);
            }
        }

        return entries.toArray(new String[0]);
    }

    /**
     * Clear all stored entries (after successful upload to server).
     */
    public static void clearAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(
                PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().clear().commit();
        Log.d(TAG, "All flash dump entries cleared");
    }

    // ═════════════════════════════════════════════════════════════
    // FILE I/O
    // ═════════════════════════════════════════════════════════════

    private static void writeToFile(String path, String content) throws IOException {
        File file = new File(path);
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }

        // Append mode — each entry on a new line (JSONL format)
        FileOutputStream fos = new FileOutputStream(file, /* append */ true);
        fos.write(content.getBytes(StandardCharsets.UTF_8));
        fos.write('\n');
        fos.flush();
        fos.getFD().sync(); // Force flush to physical storage
        fos.close();
    }

    private static void cleanupOldFiles(File dir, int keepCount) {
        File[] files = dir.listFiles();
        if (files == null || files.length <= keepCount)
            return;

        // Sort by last modified (oldest first)
        java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));

        int deleteCount = files.length - keepCount;
        for (int i = 0; i < deleteCount; i++) {
            files[i].delete();
        }
    }
}
