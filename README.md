# 🛡️ PhishGuard AI

> **India's most comprehensive cybersecurity platform — detecting scams, tracking stolen phones, protecting UPI transactions, exposing fake jobs, fighting misinformation, and keeping people safe in real time.**

Built for hackathon. Powered by Python + Node.js + real AI. Covers India's top 10 cyber threats of 2026.

![Modules](https://img.shields.io/badge/Modules-10-00ff88?style=flat-square&labelColor=0a0e1a)
![Backend](https://img.shields.io/badge/Backend-Python%20FastAPI-00aaff?style=flat-square&labelColor=0a0e1a)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-ff3366?style=flat-square&labelColor=0a0e1a)
![License](https://img.shields.io/badge/License-MIT-ffaa00?style=flat-square&labelColor=0a0e1a)

---

## 📌 What is PhishGuard AI?

India loses **₹7,000+ crore every year** to cybercrime. PhishGuard AI is a real-time cybersecurity command center that tackles the most dangerous threats Indian users face — from phishing SMS messages and stolen phones to digital arrest scams, fake job offers, and WhatsApp misinformation — all from a single browser tab.

No technical knowledge required. Open the dashboard and it works.

---

## 🚀 10 Modules — Complete Feature List

---

### 🔍 Module 1 — Phishing & Scam Detector

Paste any suspicious SMS, URL, or email and get an instant risk verdict.

- 16-rule scoring engine — cumulative score 0–100, threshold ≥40 = phishing
- Detects urgency tricks, fake bank alerts (SBI, HDFC, ICICI, Paytm, PhonePe)
- Flags KYC scams, OTP theft, shortened URLs, lookalike domains, prize scams
- Bilingual — detects Hindi scam phrases: `ओटीपी बताएं`, `खाता बंद`, `केवाईसी अपडेट`
- Government impersonation detection (RBI, TRAI, SEBI, Income Tax)
- Risk levels: `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`
- Works offline — client-side fallback engine in `analyzer.js`

**Example:** Paste `"Your SBI account frozen. Update KYC: bit.ly/sbi-now या OTP शेयर करें"` → CRITICAL, Score 100

---

### 📍 Module 2 — Stolen Phone Tracker + Auto FIR

Live GPS tracking of stolen devices on an interactive map.

- Enter any 15-digit IMEI to connect to a stolen device instantly
- Map updates every 500ms with smooth LERP animation — no jumping
- OSRM snap-to-road — marker follows actual roads (2s timeout fallback)
- Side panel: battery %, GPS accuracy, speed, last seen time, device IP
- Battery bar with 3 color states: green >50%, orange ≤50%, red ≤20% (pulsing)
- Demo mode — auto-simulates a moving device around Bengaluru (no Android device needed)
- Trail polyline showing last 50 location points

**FIR PDF Generator:**
- Fill owner name, phone, address, device model
- Auto-pulls GPS coordinates, IMEI, IP, timestamp from live tracking
- Downloads formatted PDF with FIR ID, Google Maps link, declaration, official layout
- Works even if backend is offline — pure client-side jsPDF fallback

---

### 🕵️ Module 3 — Sentinel Android Core

Java-based Android tracking core that survives theft attempts.

- Kalman filter — smooths GPS noise mathematically
- Anti-stale filter — rejects coordinates older than 5 seconds or accuracy >10m
- 500ms polling — maximum tracking resolution
- Fake Power-Off — simulates shutdown screen while secretly tracking
- Power Menu Interceptor — blocks thief from accessing real power menu
- Boot persistence — resumes tracking the second the device restarts
- Device Admin API — makes the app near-impossible to uninstall

---

### 💳 Module 4 — Financial Fraud & UPI Protection

Four tools protecting your money from UPI-based fraud.

**UPI ID Trust Checker** — paste any UPI address, get instant verdict
- Known-bad list: `paytm.support@paytm` (847 reports), `refund.sbi@okaxis` (1203 reports)
- Heuristic checks: suspicious keywords, unknown VPA handles, bot-generated digit strings

**UPI SMS Parser** — paste payment SMS, detects malicious collect requests

**Kill Switch** — hold 3 seconds to freeze all linked UPI IDs and bank accounts
- SVG countdown ring animates as you hold
- Permanently disables after activation to prevent accidents

---

### 🔄 Module 5 — SIM-Swap Risk Detector

3-question diagnostic to detect if your SIM has been swapped.

| Yes Count | Risk Level | Action |
|---|---|---|
| 0 | LOW | Monitor for unusual activity |
| 1 | MEDIUM | Contact carrier, check email alerts |
| 2 | HIGH | Call carrier immediately, alert bank |
| 3 | CRITICAL | Call 1930, freeze all accounts NOW |

---

### 🖼️ Module 6 — Deepfake & Image Guard

Upload any image and detect AI manipulation locally — no image leaves your server.

- Drag-and-drop or click-to-upload (JPG, PNG, WEBP, max 10MB)
- DeepFace — facial emotion and gender analysis for AI-generation detection
- NudeNet — NSFW classification
- Three separate scores: Deepfake / Morphing / NSFW (each 0–100)
- Animated score bars with color-coded verdict
- Optional Anthropic Claude API for cloud-based analysis (paste key in UI)
- Everything runs locally on Python backend — zero external data sharing

---

### 🚨 Module 7 — SOS & Women's Safety

Emergency tools that work instantly — no login, no setup.

- Panic Button — hold 3 seconds OR tap 3 times within 2 seconds
- Triggers: screen red flash + Web Audio API SOS beep pattern
- Emergency Contacts — add/remove contacts, persists across page refreshes
- Share My Location — one-tap GPS coordinates with copy button and Google Maps link
- National Helplines — one-tap call buttons:

| Helpline | Number |
|---|---|
| Police | 100 |
| Women Helpline | 1091 |
| Ambulance | 102 |
| Cyber Crime | 1930 |
| Child Helpline | 1098 |
| Senior Citizen | 14567 |

---

### 🚔 Module 8 — Digital Arrest Scam Detector *(NEW)*

India's #1 cyber crime of 2025–26. ₹1,200 crore lost in 2024 alone. PM Modi warned the nation in October 2024.

Scammers impersonate CBI, ED, NCB, or TRAI officers and claim you are under "digital arrest" — forcing you on video call while demanding money to "clear your name."

**12-rule detection engine:**
- Government agency impersonation (CBI, ED, NCB, TRAI, Supreme Court) → +45
- "Digital arrest" keyword and arrest warrant claims → +50
- Identity-crime linkage threat (your Aadhaar/SIM linked to crime) → +40
- "Stay on call / do not disconnect" coercion → +45
- Money transfer demand to clear name → +50
- Family threat patterns → +35
- Secrecy demand (don't tell anyone) → +35
- Fake case/warrant numbers → +30
- Hindi patterns: `आपको गिरफ्तार`, `डिजिटल अरेस्ट`, `सीबीआई` → +45

**Key fact displayed on every scan:**
> *"No Indian agency — CBI, ED, NCB, Police, TRAI — conducts arrests over a phone or video call. Ever."*

Supports: Call Script / WhatsApp Message / Email — with pre-loaded realistic examples that score CRITICAL.

---

### 💼 Module 9 — Fake Job Offer Detector *(NEW)*

45 million unemployed Indians targeted daily. Average victim loss: ₹15,000. 2.1 lakh complaints filed in 2024.

Scammers post fake jobs on WhatsApp and Telegram, collect registration/training/kit fees, then vanish.

**13-rule detection engine:**
- Upfront fee demand (registration/kit/training/security deposit) → +50
- Unrealistic salary (₹50k–1L/month for freshers guaranteed) → +35
- Work-from-home with guaranteed daily earnings → +45
- Interview only on WhatsApp or Telegram → +40
- Offer letter before any interview → +40
- Gmail/Yahoo used as company HR email → +35
- Document theft attempt (Aadhaar/PAN before joining) → +45
- Like/share/watch tasks to earn money → +40
- Fake e-commerce job (Amazon/Flipkart product reviews) → +40
- Suspicious domain extension (.xyz/.tk/.ml) → +35
- Hindi patterns: `नौकरी फीस`, `घर बैठे कमाएं`, `गारंटीड सैलरी` → +40

Company verification links auto-generated for every scan: MCA21, NCS portal, LinkedIn.

---

### 📰 Module 10 — Misinformation & Fake Forward Detector *(NEW)*

500 million WhatsApp users in India. 72% cannot identify fake news. One fake forward reaches 1,000 people in 6 hours.

Paste any WhatsApp forward, news claim, or government scheme message to get a credibility score.

**13-rule detection engine:**
- Chain forward demand ("forward to 10 people") → +40
- Fake government scheme with data collection link → +45
- Fake medical claims (IIT scientists cure cancer/diabetes) → +40
- "Share before it gets deleted" urgency → +35
- Inflammatory military/communal claims → +45/+50
- Fake free scheme (free laptop/phone/gas) → +45
- Health misinformation (home remedy cures) → +35
- No source cited → flagged
- Excessive caps/punctuation → emotional manipulation flagged

**Fact-check links on every result:**
- pib.gov.in/factcheck (PIB Government)
- newschecker.in / boomlive.in / factly.in

---

### 📊 Module 11 — National Cyber Stats Dashboard

Live command center showing India's cybercrime landscape.

- Animated live counters: Scans Today, Threats Blocked, Accuracy Rate
- Real statistics: ₹1,750 Cr UPI fraud (2023), 50,000+ CERT-In incidents, 1 crime every 7 minutes
- Scrolling terminal log — new security event every 3 seconds
- Pure CSS monthly incident bar chart
- Scrolling news ticker with latest Indian cybercrime headlines
- Direct link to report at cybercrime.gov.in

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│              Android Device                      │
│  Sentinel Core (Java)                            │
│  Kalman Filter → Anti-Stale → UDP 500ms          │
└───────────────────┬─────────────────────────────┘
                    │ UDP port 8883
┌───────────────────▼─────────────────────────────┐
│          Python Backend (FastAPI)                │
│                                                  │
│  UDP Thread (8883) + WebSocket (/ws)             │
│                                                  │
│  REST API — port 3000                            │
│  /api/scan/phishing                              │
│  /api/scan/upi                                   │
│  /api/scan/image      (DeepFace + NudeNet)       │
│  /api/scan/digital-arrest          ← NEW         │
│  /api/scan/fake-job                ← NEW         │
│  /api/scan/misinformation          ← NEW         │
│  /api/fir/generate    (ReportLab PDF)            │
│  /api/device/:imei                               │
└───────────────────┬─────────────────────────────┘
                    │ HTTP + WebSocket
┌───────────────────▼─────────────────────────────┐
│         Web Dashboard (Vanilla JS)               │
│  10 modules — single index.html                  │
│  Leaflet.js map — jsPDF — Web Audio API          │
│  Dark glassmorphic UI — Rajdhani + Share Tech    │
└─────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
phishguard/
│
├── phishguard-web/
│   ├── index.html        Full UI — all 10 modules
│   ├── styles.css        Dark cybersecurity theme + animations
│   ├── app.js            All frontend logic, WebSocket, APIs
│   └── analyzer.js       Client-side engines (offline fallback)
│
├── phishguard-backend/
│   ├── server.py         Python FastAPI — all routes + AI engines
│   ├── server.js         Node.js C2 server (alternative)
│   └── requirements.txt  Python dependencies
│
├── android-core/
│   ├── StealthLocationEngine.java
│   ├── MqttBurstClient.java        UDP telemetry sender
│   ├── BootReceiver.java           Boot persistence
│   ├── AntiGravityDeviceAdmin.java
│   ├── FakePowerOffController.java
│   └── PowerMenuInterceptor.java
│
└── pitch_deck/           React/Vite presentation slides
```

---

## ⚙️ How to Run

### Python Backend (Recommended)

```bash
cd phishguard-backend
pip install -r requirements.txt
python server.py
```

Server starts on:
- `http://localhost:3000` — REST API
- `ws://localhost:3000/ws` — WebSocket feed
- `UDP port 8883` — Android telemetry receiver

### Node.js Backend (Alternative)

```bash
cd phishguard-backend
npm install
node server.js
```

### Frontend

Open `phishguard-web/index.html` in any browser. No build step needed.

> 💡 **Instant demo:** Click **"Load Demo Device"** in the tracker to see a simulated stolen phone moving live around Bengaluru — no Android device needed.

> 🔑 **Deepfake AI:** Paste your Anthropic API key in Module 6 to enable cloud analysis. Get free credits at console.anthropic.com. Without the key, local DeepFace + NudeNet still runs.

---

## 🔌 Complete API Reference

| Method | Endpoint | Module | Description |
|---|---|---|---|
| GET | `/api/stats` | Dashboard | Live scan counts and accuracy |
| GET | `/api/device/:imei` | Tracker | Current device state |
| POST | `/api/scan/phishing` | Module 1 | Phishing text analysis |
| POST | `/api/scan/upi` | Module 4 | UPI ID trust check |
| POST | `/api/scan/image` | Module 6 | Deepfake + NSFW analysis |
| POST | `/api/scan/digital-arrest` | Module 8 | Digital arrest scam detection |
| POST | `/api/scan/fake-job` | Module 9 | Fake job offer detection |
| POST | `/api/scan/misinformation` | Module 10 | Misinformation scoring |
| POST | `/api/simulate/location` | Tracker | Inject test GPS packet |
| POST | `/api/fir/generate` | Module 2 | Create FIR record |
| GET | `/api/fir/:id/pdf` | Module 2 | Download FIR as PDF |

**WebSocket Events**

| Event | Direction | Description |
|---|---|---|
| `INIT` | Server → Browser | All devices + stats on connect |
| `LOCATION_UPDATE` | Server → Browser | Live GPS every 500ms |
| `TELEMETRY` | Server → Browser | Full telemetry packet |
| `SUBSCRIBE_IMEI` | Browser → Server | Start tracking a device |
| `DEVICE_STATE` | Server → Browser | Snapshot of subscribed device |

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Web frontend | HTML5, CSS3, Vanilla JavaScript ES6+ |
| Map rendering | Leaflet.js + CartoDB Dark Matter tiles |
| Road snapping | OSRM (open source, no API key) |
| PDF generation (browser) | jsPDF |
| Backend framework | FastAPI + Uvicorn |
| WebSocket | FastAPI native WebSocket |
| UDP receiver | Python built-in socket module |
| Deepfake detection | DeepFace |
| NSFW detection | NudeNet |
| PDF generation (server) | ReportLab |
| Cloud image AI | Anthropic Claude (optional) |
| Android core | Java (Android SDK) |
| All scan engines | Pure regex — runs client + server side |

---

## 🇮🇳 The Problem We're Solving

| Threat | Scale in India | PhishGuard Module |
|---|---|---|
| Phishing SMS / email | ₹1,750 Cr lost (2023) | Module 1 |
| Stolen phones | 10M+ thefts/year | Module 2 + 3 |
| UPI fraud | 50,000+ daily complaints | Module 4 |
| SIM swap attacks | Rising 40% YoY | Module 5 |
| Deepfake sextortion | Thousands/month on NCRP | Module 6 |
| Women's safety emergencies | 1091 gets 2,000+ calls/day | Module 7 |
| Digital arrest scams | ₹1,200 Cr lost in 2024 | **Module 8** ← NEW |
| Fake job scams | 2.1L complaints (2024) | **Module 9** ← NEW |
| WhatsApp misinformation | 500M users, 72% can't detect | **Module 10** ← NEW |

---

## 🔑 API Keys

| Service | Required? | Where to Get | Cost |
|---|---|---|---|
| Anthropic (Deepfake cloud) | Optional | console.anthropic.com | $5 free credit |
| OSRM (road snapping) | Not needed | Built into code | Free |
| Leaflet + CartoDB (map) | Not needed | Built into code | Free |
| All scan engines | Not needed | Run locally | Free |

---

## 📜 License

MIT License — free to use, modify, and distribute.

---

## 🤝 Contributing

Pull requests welcome. For major changes open an issue first to discuss.

---

<p align="center">
  <strong>Built with ❤️ for a safer digital India</strong><br/>
  <sub>Covering India's top 10 cyber threats of 2026</sub>
</p>
