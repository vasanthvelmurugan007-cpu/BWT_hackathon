/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CellularTelemetryEngine.java (Module 2 Support)                ║
 * ║  IMEI Harvester & Cell-Tower Triangulation Fallback             ║
 * ║                                                                  ║
 * ║  - Extracts IMEI (Requires READ_PRIVILEGED_PHONE_STATE)        ║
 * ║  - Pulls MCC, MNC, LAC, and CID for OpenCelliD fallback        ║
 * ║  - Integrates directly with SentinelUdpClient                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

package com.phishguard.antigravity.core.sentinel;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.CellInfo;
import android.telephony.CellInfoGsm;
import android.telephony.CellInfoLte;
import android.telephony.CellInfoWcdma;
import android.telephony.TelephonyManager;
import android.util.Log;

import java.util.List;

public class CellularTelemetryEngine {

    private static final String TAG = "Sentinel:CellTelemetry";

    private final TelephonyManager mTelephonyManager;
    private final Context mContext;
    private String mCachedImei = null;

    public CellularTelemetryEngine(Context context) {
        mContext = context;
        mTelephonyManager = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
    }

    /**
     * Extracts the hardware IMEI.
     * On Android 10+ (API 29), this requires the system app permission
     * `READ_PRIVILEGED_PHONE_STATE`.
     * Since Sentinel is a system app deployed to AOSP, this is natively supported.
     */
    public String getDeviceImei() {
        if (mCachedImei != null)
            return mCachedImei;

        if (mContext.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Telephony permission missing! Cannot retrieve IMEI.");
            return "UNKNOWN_IMEI";
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                mCachedImei = mTelephonyManager.getImei();
            } else {
                // Legacy fallback
                @SuppressWarnings("deprecation")
                String deviceId = mTelephonyManager.getDeviceId();
                mCachedImei = deviceId;
            }
            Log.i(TAG, "IMEI Harvested Successfully. (Masked for logs: " + mCachedImei.substring(0, 4) + "****)");
        } catch (SecurityException e) {
            // This happens if the ROM does not grant READ_PRIVILEGED_PHONE_STATE
            Log.e(TAG, "SecurityException: OS rejected IMEI extraction! " + e.getMessage());
            mCachedImei = "UNKNOWN_IMEI";
        }

        return mCachedImei != null ? mCachedImei : "UNKNOWN_IMEI";
    }

    /**
     * Harvests the active Cell Tower ID.
     * In the event GPS goes blind (e.g. thief enters underground parking),
     * we utilize the raw CID (Cell Identity) for Triangulation via Google API /
     * OpenCelliD.
     */
    public int getActiveCellId() {
        if (mContext
                .checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return -1;
        }

        try {
            List<CellInfo> cellInfoList = mTelephonyManager.getAllCellInfo();
            if (cellInfoList == null || cellInfoList.isEmpty())
                return -1;

            // Iterate through available cells looking for the registered (active) one
            for (CellInfo info : cellInfoList) {
                if (!info.isRegistered())
                    continue;

                if (info instanceof CellInfoLte) {
                    return ((CellInfoLte) info).getCellIdentity().getCi();
                } else if (info instanceof CellInfoWcdma) {
                    return ((CellInfoWcdma) info).getCellIdentity().getCid();
                } else if (info instanceof CellInfoGsm) {
                    return ((CellInfoGsm) info).getCellIdentity().getCid();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Cell ID extraction failed: " + e.getMessage());
        }

        return -1; // Unknown or unsupported network type
    }
}
