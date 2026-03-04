# PhishGuard AI Anti-Theft Architecture

## Solution Overview
We have created a resilient, tracking-robust Anti-Theft Engine on Android, accompanied by a command-and-control back-end and web dashboard real-time integration. The target usage ensures a stolen device retains its tracking functionality across adverse events and effectively updates physical location continually.

## Technical Components & Architecture

### 1. High-Precision Tracking (Level: "Pinpoint Precision")
* **FusedLocationProviderClient:** Uses Google APIs (`Priority.PRIORITY_HIGH_ACCURACY`) replacing legacy location manager dependencies. High frequency (`1000ms`, fastest `500ms`) with immediate update distances allowed (`0.0f`).
* **Anti-Stale Filter:** Before any coordinate is acknowledged, timestamps confirm the fix generation time drops within `5000ms` otherwise it is binned to avoid "snapping" the trajectory.
* **Warm-Up Cycle Strategy:** The tracker deliberately discards the first 3 results given when switching into "STOLEN" mode, followed by waiting until horizontal accuracy climbs below `< 10 meters`.
* **Kalman Filtering Algorithm Layer:** Added mathematically complex onboard interpolation which runs a `KalmanLatLong` check removing generic movement noise resulting from weak GPS/tall buildings using an internal prediction velocity formula (`Q_metres_per_second` factor `3.0f`). 

### 2. Resilience and Persistence ("Fake-Off")
* **PARTIAL_WAKE_LOCK:** Enacted whenever Stolen mode applies. Forces the GPS component to function seamlessly during screen blackouts or spoofed "powered off" visual events since Android tries shutting tracking features to spare battery.

### 3. Dashboard Web Smoothening
* **OSRM Snap-to-Roads Integration:** Intersecting incoming raw location packets and firing asynchronous HTTP pings toward open-source road-mapper OSRM guarantees map icons represent likely road/urban positions and never float into ocean bounds arbitrarily. 
* **L.E.R.P Animation (Linear Interpolation):** Visual elements slowly animate or `panTo/slide` elegantly using mathematical calculation based off `requestAnimationFrame` mitigating marker jumping.

## Diagram Visualization (Architecture Overview)

* The device acquires coordinate arrays -> Anti-Stale + Warm Up -> Kalman Process -> Sent via UDP payload over Node Server -> Socketed to Frontend JS -> Snapped to OSRM -> Screen Rendered.
