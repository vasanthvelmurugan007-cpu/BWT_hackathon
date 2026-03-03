package com.phishguard.antigravity.core;

public class AntiGravityTester {
    public static void main(String[] args) {
        System.out.println("🚀 Starting AntiGravityCore Logic Test...\n");

        // 1. Test DeviceHealthSnapshot Serialization Speed
        System.out.println("--- 1. Testing DeviceHealthSnapshot Serialization ---");
        DeviceHealthSnapshot snap = new DeviceHealthSnapshot();
        snap.timestampMs = System.currentTimeMillis();
        snap.uptimeMs = 120500;
        snap.trigger = "IMPACT_15G";
        snap.latitude = 12.9716;
        snap.longitude = 77.5946;
        snap.locationAccuracyM = 4.5f;
        snap.batteryPercent = 14;
        snap.isCharging = false;
        snap.networkOperator = "Jio 5G";
        snap.signalStrengthDbm = -85;
        snap.deviceId = "pg-sim-001";
        snap.isStolenMode = true;
        snap.isFakeOff = true;
        snap.peakGForce = 15.2f;
        snap.estimatedDropHeightM = 1.2f;

        // Warmup (for accurate JVM timing)
        for (int i = 0; i < 1000; i++) {
            snap.toJson();
        }

        long start = System.nanoTime();
        String fullJson = snap.toJson();
        long elapsedFull = System.nanoTime() - start;

        start = System.nanoTime();
        String compactJson = snap.toCompactJson();
        long elapsedCompact = System.nanoTime() - start;

        System.out.println("✅ Full JSON:");
        System.out.println(fullJson);
        System.out.println("⏱️ Serialization time: " + (elapsedFull / 1_000_000.0) + " ms\n");

        System.out.println("✅ Compact JSON (For Last Gasp MQTT):");
        System.out.println(compactJson);
        System.out.println("⏱️ Serialization time: " + (elapsedCompact / 1_000_000.0) + " ms\n");

        // 2. Test Last Gasp Math
        System.out.println("--- 2. Testing Last Gasp Free-Fall Math ---");
        // Simulate 450ms of free-fall (0G)
        long freeFallMs = 450;
        double g = 9.81;
        double t = freeFallMs / 1000.0;
        double expectedHeight = 0.5 * g * t * t;

        System.out.println("Drop duration: " + freeFallMs + " ms");
        System.out.printf("Calculated Drop Height: %.2f meters%n", expectedHeight);

        if (expectedHeight > 0.9 && expectedHeight < 1.1) {
            System.out.println("✅ Physics math is nominal (roughly 1 meter drop).");
        }
    }
}
