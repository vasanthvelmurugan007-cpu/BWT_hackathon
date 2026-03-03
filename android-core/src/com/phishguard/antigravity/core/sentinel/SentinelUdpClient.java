/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SentinelUdpClient.java (Module 2 & 3 Support)                  ║
 * ║  Raw UDP Socket Client for Sentinel Telemetry                   ║
 * ║                                                                  ║
 * ║  Why UDP?                                                        ║
 * ║  - Zero connection overhead (no SYN/ACK handshake)               ║
 * ║  - Bypasses deep-packet stateful inspection                      ║
 * ║  - Minimum battery drain (fire-and-forget datagrams)             ║
 * ║  - Critical for <30ms Last Gasp payload transmission             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core.sentinel;

import android.util.Log;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public class SentinelUdpClient {

    private static final String TAG = "Sentinel:UDP";
    private final String mC2Address;
    private final int mC2Port;
    private DatagramSocket mSocket;
    private InetAddress mServerAddr;
    private final byte[] mImeiHash;

    /**
     * @param c2Address IP or hostname of Command & Control server
     * @param c2Port    UDP port
     * @param imei      Raw IMEI to be hashed inside the client
     */
    public SentinelUdpClient(String c2Address, int c2Port, String imei) {
        mC2Address = c2Address;
        mC2Port = c2Port;
        mImeiHash = computeImeiHash(imei);

        try {
            mSocket = new DatagramSocket();
            // Pre-resolve DNS to avoid blocking later during a Last Gasp
            new Thread(() -> {
                try {
                    mServerAddr = InetAddress.getByName(mC2Address);
                    Log.d(TAG, "DNS Resolved: " + mServerAddr.getHostAddress());
                } catch (Exception e) {
                    Log.e(TAG, "DNS Resolution Failed: " + e.getMessage());
                }
            }).start();
        } catch (Exception e) {
            Log.e(TAG, "Socket Initialization Failed: " + e.getMessage());
        }
    }

    /**
     * Bypasses TCP API limits and sends a fast UDP packet.
     * 28-Byte Frame: [1B Version | 16B Hash | 4B Lat | 4B Lon | 1B Bat | 2B CellID]
     */
    public void sendHeartbeat(float lat, float lon, int batteryPercent, int cellId) {
        if (mServerAddr == null)
            return;

        try {
            // Allocate exact 28 bytes
            ByteBuffer buffer = ByteBuffer.allocate(28);

            // 1B Version
            buffer.put((byte) 0x01);

            // 16B IMEI Hash (Primary Key for Backend)
            buffer.put(mImeiHash);

            // 4B Lat & 4B Lon (Converting standard float is sufficient for ~1m precision)
            buffer.putFloat(lat);
            buffer.putFloat(lon);

            // 1B Battery
            buffer.put((byte) (batteryPercent & 0xFF));

            // 2B Cell ID (Truncated to 16 bits for basic cell fallback)
            buffer.putShort((short) (cellId & 0xFFFF));

            byte[] payload = buffer.array();
            DatagramPacket packet = new DatagramPacket(payload, payload.length, mServerAddr, mC2Port);

            // Fire and forget - executes in under 2ms!
            mSocket.send(packet);
            Log.d(TAG, "UDP Heartbeat Fired -> " + payload.length + " bytes");

        } catch (Exception e) {
            Log.e(TAG, "UDP Send Failed: " + e.getMessage());
        }
    }

    /**
     * Specifically designed for Module 3 (Impact-Triggered Last Gasp).
     * Sends 3 duplicate packets to combat UDP packet loss right before hardware
     * failure.
     */
    public void sendLastGaspBurst(float lat, float lon, int batteryPercent, int cellId) {
        if (mServerAddr == null)
            return;

        Log.e(TAG, "💥 EXECUTING UDP LAST GASP BURST 💥");
        // We hammer the network interface 3 times rapidly
        for (int i = 0; i < 3; i++) {
            sendHeartbeat(lat, lon, batteryPercent, cellId);
        }
    }

    /**
     * Compute MD5 Hash of IMEI (16 bytes)
     * For privacy/security, we don't send raw IMEI over unencrypted UDP.
     */
    private byte[] computeImeiHash(String imei) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            return md.digest((imei != null ? imei : "UNKNOWN").getBytes());
        } catch (NoSuchAlgorithmException e) {
            return new byte[16]; // Fallback empty hash
        }
    }

    public void close() {
        if (mSocket != null && !mSocket.isClosed()) {
            mSocket.close();
        }
    }
}
