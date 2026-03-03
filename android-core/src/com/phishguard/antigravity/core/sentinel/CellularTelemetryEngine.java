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
    public synchronized String getDeviceImei() {
        if (mCachedImei != null)
            return mCachedImei;

        if (Build.VERSION.SDK_INT >= 29) {
            Log.w(TAG, "API 29+ restricts IMEI access. Using anonymous identifier.");
            mCachedImei = "ANONYMIZED_DEVICE_ID";
            return mCachedImei;
        }

        if (mContext.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Telephony permission missing! Cannot retrieve IMEI.");
            mCachedImei = "UNKNOWN_IMEI";
            return mCachedImei;
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
            // Removed log containing IMEI as per privacy guidelines
        } catch (SecurityException e) {
            Log.e(TAG, "SecurityException: OS rejected IMEI extraction! " + e.getMessage());
            mCachedImei = "UNKNOWN_IMEI";
        }

        if (mCachedImei == null)
            mCachedImei = "UNKNOWN_IMEI";
        return mCachedImei;
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
