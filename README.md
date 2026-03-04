🛡️ PhishGuard AI

An all-in-one cybersecurity platform built for India — detecting scams, tracking stolen phones, protecting UPI transactions, and keeping people safe in real time.

Built for hackathon. Powered by Python + Node.js + real AI.

📌 What is PhishGuard AI?
India loses crores every day to cyber fraud. PhishGuard AI is a cybersecurity dashboard that tackles the most common threats Indian users face — phishing SMS messages, stolen phones, UPI fraud, deepfake images, and personal safety emergencies — all from a single web interface.
No technical knowledge required to use it. Just open the dashboard and it works.

🚀 Features
🔍 1. Phishing & Scam Detector
Paste any suspicious SMS, URL, or email and PhishGuard will tell you instantly if it's a scam.

Detects urgency tricks like "Your account will be blocked in 24 hours"
Catches bank impersonation (SBI, HDFC, ICICI, Paytm, PhonePe and more)
Flags fake KYC requests, OTP theft attempts, and prize/lottery scams
Works in both English and Hindi — detects scam phrases like "ओटीपी बताएं" and "केवाईसी अपडेट"
Spots shortened URLs (bit.ly, tinyurl) and fake lookalike domains (sbi-kyc.xyz)
Gives a risk score from 0–100 with a clear label: LOW / MEDIUM / HIGH / CRITICAL

Example: Paste "Dear Customer, your SBI account will be blocked. Update KYC: bit.ly/sbi-now" → PhishGuard flags it as CRITICAL with 3 threat indicators.

📍 2. Stolen Phone Tracker
If your phone is stolen, PhishGuard tracks it live on a map using the Sentinel Android core installed on your device.

Enter your phone's IMEI number to connect to it instantly
Watch your phone's location move on a live map updated every 500ms
See battery percentage, GPS accuracy, speed, and last seen time in real time
The map marker moves smoothly — no jumping or teleporting
Location snaps to the nearest road using OSRM (open source, no API key needed)
Includes a built-in demo mode — loads a simulated device moving around Bengaluru so you can see how it works without a real device

The Android core that runs on the stolen phone is designed to be extremely hard to remove. It survives reboots, resists uninstallation, and even fakes a power-off screen while secretly continuing to track.

📄 3. Auto FIR Generator
Once you have the stolen phone's location, you can generate an official-looking police complaint document in one click.

Fill in your name, phone number, address, and device model
PhishGuard auto-fills the IMEI, GPS coordinates, last seen IP, and timestamp from live tracking data
Downloads a formatted PDF titled "First Information Report — Form 54-B"
Includes a Google Maps link to the exact last known location
Ready to submit at your nearest Cyber Crime Cell or upload to cybercrime.gov.in


💳 4. Financial Fraud & UPI Protection
Four tools to protect your money from UPI-based fraud.
UPI ID Trust Check — Paste any UPI ID (like refund.sbi@okaxis) and see instantly if it's a known scam, suspicious, or verified. Checks against a database of reported fraud IDs and runs heuristic analysis on unknown ones.
UPI SMS Parser — Paste an SMS you received about a UPI transaction. PhishGuard detects malicious collect requests, unexpected debits, and phishing payment links.
SIM Swap Detector — Answer 3 yes/no questions about your phone behavior (sudden signal loss, unexpected OTPs, unrecognized SIM change SMS). PhishGuard calculates your SIM swap risk level and tells you exactly what to do.
Account Freeze Kill Switch — A big red button. Hold it for 3 seconds to simulate sending a freeze signal to all linked UPI IDs and bank accounts. Designed for emergencies when you suspect your accounts are being accessed.

🖼️ 5. Deepfake & Image Guard
Upload any image and PhishGuard analyzes it for AI manipulation.

Drag and drop an image or click to upload
Runs real AI analysis using DeepFace (face analysis) and NudeNet (NSFW detection)
Returns three separate scores: Deepfake Score, Morphing Score, NSFW Score — each from 0 to 100
Detects unnatural facial expressions, ambiguous features, and explicit content
Everything runs locally on the Python backend — no image is sent to any external server
Shows a clear verdict: CLEAN / WARNING / CRITICAL


🚨 6. SOS & Women's Safety
Built for emergencies. No login, no setup — works instantly.
Panic Button — A large SOS button on screen. Hold it for 3 seconds or tap it 3 times quickly to trigger an alert. Sets off a beeping alarm using the browser's audio engine and flashes the screen red.
Emergency Contacts — Add trusted contacts (name + phone number). They're saved locally on your device. In an emergency, you can see all your contacts in one place.
Share My Location — One tap to get your current GPS coordinates from the browser. Copy them or open in Google Maps directly.
National Helplines Directory — One-tap call buttons for:
HelplineNumberPolice100Women Helpline1091Ambulance102Cyber Crime1930Child Helpline1098Senior Citizen14567

📊 7. National Cyber Stats Dashboard
The home screen of PhishGuard shows you the real scale of cybercrime in India.

Live counters for scans run today, threats blocked, and detection accuracy
Real statistics: ₹1,750 Cr lost to UPI fraud in 2023, 50,000+ CERT-In incidents, 1 cybercrime every 7 minutes
Animated bar chart showing monthly cyber incident trends
Scrolling news ticker with recent Indian cybercrime headlines
Scrolling terminal log showing live system activity
Direct link to report crimes at cybercrime.gov.in


🏗️ Architecture
┌─────────────────────────────────────────┐
│           Android Device                │
│  Sentinel Core (Java)                   │
│  └─ Location → UDP packet every 500ms   │
└────────────────┬────────────────────────┘
                 │ UDP port 5005
┌────────────────▼────────────────────────┐
│        Python Backend (FastAPI)         │
│  ├─ UDP receiver thread                 │
│  ├─ Phishing analysis engine            │
│  ├─ DeepFace + NudeNet image analysis   │
│  ├─ UPI trust checker                   │
│  ├─ FIR PDF generator (ReportLab)       │
│  └─ WebSocket broadcaster               │
└────────────────┬────────────────────────┘
                 │ WebSocket ws://localhost:3000/ws
                 │ REST API http://localhost:3000
┌────────────────▼────────────────────────┐
│      Web Dashboard (Vanilla JS)         │
│  ├─ Leaflet.js live map                 │
│  ├─ 7 feature modules                   │
│  └─ Dark glassmorphic UI                │
└─────────────────────────────────────────┘

📁 Project Structure
phishguard/
├── phishguard-web/          # Frontend dashboard
│   ├── index.html           # Full UI — all 7 modules
│   ├── styles.css           # Dark cybersecurity theme
│   ├── app.js               # All frontend logic + WebSocket
│   └── analyzer.js          # Client-side phishing engine (offline fallback)
│
├── phishguard-backend/      # Python C2 server
│   ├── server.py            # FastAPI app — all routes + engines
│   └── requirements.txt     # Python dependencies
│
├── android-core/            # Java Android Sentinel
│   ├── StealthLocationEngine.java
│   ├── MqttBurstClient.java
│   ├── BootReceiver.java
│   ├── AntiGravityDeviceAdmin.java
│   ├── FakePowerOffController.java
│   └── PowerMenuInterceptor.java
│
└── pitch_deck/              # React/Vite presentation slides

⚙️ How to Run
Backend (Python)
bashcd phishguard-backend
pip install -r requirements.txt
python server.py
Server starts on:

http://localhost:3000 — REST API
ws://localhost:3000/ws — WebSocket feed
UDP port 5005 — Android telemetry receiver

Frontend
Just open phishguard-web/index.html in any browser. No build step needed.

💡 The tracker module has a "Load Demo Device" button — click it to see a simulated stolen phone moving around Bengaluru without needing a real Android device.


🔌 API Reference
MethodEndpointWhat it doesGET/api/statsReturns scan counts and accuracy rateGET/api/device/:imeiReturns current state of a tracked devicePOST/api/scan/phishingAnalyzes text for phishing patternsPOST/api/scan/upiChecks a UPI ID for fraud indicatorsPOST/api/scan/imageRuns deepfake + NSFW analysis on an imagePOST/api/simulate/locationInjects a fake GPS packet for testingPOST/api/fir/generateCreates an FIR record from device + owner dataGET/api/fir/:id/pdfDownloads the FIR as a formatted PDF
WebSocket messages:

INIT — sent on connect with all current device states
LOCATION_UPDATE — sent every 500ms per active device
SUBSCRIBE_IMEI — send this to start tracking a specific device


🧰 Tech Stack
LayerTechnologyWeb frontendHTML5, CSS3, Vanilla JavaScriptMap renderingLeaflet.js + CartoDB Dark Matter tilesRoad snappingOSRM (open source, no API key)PDF (browser)jsPDFBackend frameworkFastAPI + UvicornWebSocketFastAPI native WebSocketUDP receiverPython built-in socket moduleDeepfake detectionDeepFaceNSFW detectionNudeNetPDF generationReportLabAndroid coreJava (Android SDK)

🇮🇳 Why We Built This
India had over 13.9 lakh cybercrime complaints on the National Cyber Crime Reporting Portal in 2023. UPI fraud alone cost Indians ₹1,750 crore. Most victims don't know what hit them until it's too late.
PhishGuard AI is our answer — a tool that gives every Indian user the ability to detect, track, report, and respond to cyber threats, all in one place, in their own language.

📜 License
MIT License. Free to use, modify, and distribute.

🤝 Contributing
Pull requests are welcome. For major changes, open an issue first to discuss what you'd like to change.
