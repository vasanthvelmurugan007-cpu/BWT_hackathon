import asyncio
import base64
import io
import json
import math
import os
import re
import socket
import threading
import time
import uuid
from datetime import datetime
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as rl_canvas

app = FastAPI(title="PhishGuard AI C2 Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


devices = {}          # imei -> device state dict
fir_store = {}        # fir_id -> fir data dict
scan_stats = {
    "scansToday": 0,
    "threatsBlocked": 0,
    "accuracyRate": 99.3
}
connected_clients = []   # list of active WebSocket connections

# Known UPI trust database
UPI_DATABASE = {
    "paytm.support@paytm":  {"trusted": False, "reports": 847,  "type": "SCAM",        "label": "Known Scam"},
    "refund.sbi@okaxis":    {"trusted": False, "reports": 1203, "type": "PHISHING",     "label": "Bank Phishing"},
    "pm.kisan@gov":         {"trusted": True,  "reports": 0,    "type": "GOVERNMENT",   "label": "Verified Govt"},
    "merchant@ybl":         {"trusted": True,  "reports": 0,    "type": "MERCHANT",     "label": "Verified Merchant"},
}

PHISHING_RULES = [
    (r'urgent|immediate\s+action|expires?\s+(today|now|soon)|last\s+chance',                              'Urgency Trigger',        20),
    (r'account.{0,20}(suspended|blocked|frozen|deactivated)',                                              'Account Threat',         30),
    (r'\b(sbi|hdfc|icici|axis\s*bank|pnb|kotak|paytm|phonepe|gpay|google\s*pay)\b',                      'Bank Impersonation',     25),
    (r'kyc.{0,30}(update|expir|pending|incomplete|verif)',                                                 'KYC Scam',               35),
    (r'\botp\b.{0,30}(share|send|give|provide|enter)',                                                     'OTP Request',            40),
    (r'\b(bit\.ly|tinyurl\.com|t\.co|rb\.gy|cutt\.ly|goo\.gl)\b',                                        'Shortened URL',          25),
    (r'(won|winner|selected|eligible).{0,40}(prize|reward|cashback|lottery)',                              'Prize Scam',             35),
    (r'upi.{0,30}(collect|request).{0,30}(approve|accept|click)',                                         'UPI Collect Fraud',      40),
    (r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}',                                                     'IP Address URL',         30),
    (r'(sbi|hdfc|icici|paytm|npci|uidai|aadhaar).{0,10}\.(xyz|tk|ml|ga|cf|gq|top|club)',                 'Lookalike Domain',       45),
    (r'खाता.{0,10}(बंद|ब्लॉक|फ्रीज)',                                                                    'Hindi Account Threat',   30),
    (r'ओटीपी.{0,10}(बताएं|शेयर|दें)',                                                                     'Hindi OTP Request',      40),
    (r'केवाईसी.{0,10}(अपडेट|वेरिफिकेशन)',                                                                 'Hindi KYC Scam',         35),
    (r'(income\s*tax|trai|rbi|sebi|npci|govt).{0,50}(notice|penalty|fine|arrest|action)',                 'Govt Impersonation',     35),
    (r'send\s+₹?\d+.{0,30}(get|receive|win|earn)',                                                        'Advance Fee Fraud',      40),
    (r'(verify|confirm|update).{0,30}(account|details|information).{0,30}(immediately|now|urgent)',       'Verification Scam',      25),
]

def analyze_phishing(text: str) -> dict:
    score = 0
    findings = []
    for pattern, label, pts in PHISHING_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            score += pts
            findings.append({"label": label, "score": pts})
    score = min(score, 100)
    if score >= 70:
        risk_level = "CRITICAL"
    elif score >= 40:
        risk_level = "HIGH"
    elif score >= 20:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"
    is_phishing = score >= 40
    if is_phishing:
        summary = f"⚠️ {len(findings)} threat indicator(s) detected. Do NOT click any links or share information."
    elif score >= 20:
        summary = "⚡ Suspicious patterns found. Exercise caution."
    else:
        summary = "✅ No significant phishing indicators found."
    return {
        "isPhishing": is_phishing,
        "riskScore": score,
        "riskLevel": risk_level,
        "findings": findings,
        "summary": summary
    }

def check_upi(upi_id: str) -> dict:
    if upi_id in UPI_DATABASE:
        return {"upiId": upi_id, **UPI_DATABASE[upi_id], "checked": True, "flags": []}

    flags = []
    trusted = True

    if re.search(r'support|help|refund|reward|prize|lottery|winner', upi_id, re.IGNORECASE):
        flags.append("Suspicious keyword in UPI ID")
        trusted = False

    if re.search(r'\d{7,}', upi_id):
        flags.append("Long digit string — possible bot-generated ID")
        trusted = False

    valid_handles = ['@ybl', '@paytm', '@okaxis', '@upi', '@apl', '@icici', '@sbi', '@axl', '@okhdfcbank', '@okicici', '@oksbi']
    if not any(upi_id.endswith(h) for h in valid_handles):
        flags.append("Unknown VPA handle")
        trusted = False

    return {
        "upiId": upi_id,
        "trusted": trusted,
        "reports": 0 if trusted else 12,
        "type": "UNKNOWN" if trusted else "SUSPICIOUS",
        "label": "No reports found" if trusted else "Suspicious Pattern Detected",
        "flags": flags,
        "checked": True
    }

def analyze_image(image_base64: str, media_type: str = "image/jpeg") -> dict:
    result = {
        "deepfakeScore": 0,
        "morphingScore": 0,
        "nsfwScore": 0,
        "verdict": "CLEAN",
        "details": []
    }

    try:
        img_bytes = base64.b64decode(image_base64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        tmp_path = "/tmp/phishguard_upload.jpg"
        img.save(tmp_path)
    except Exception as e:
        return {**result, "verdict": "ERROR", "details": [f"Could not decode image: {str(e)}"]}

    # DeepFace analysis
    try:
        from deepface import DeepFace
        analysis = DeepFace.analyze(tmp_path, actions=["emotion", "age", "gender"], enforce_detection=False)
        if isinstance(analysis, list):
            analysis = analysis[0]
        emotions = analysis.get("emotion", {})
        if emotions:
            top_score = max(emotions.values())
            if top_score < 35:
                result["deepfakeScore"] += 40
                result["details"].append("Unnatural emotion distribution — possible AI face generation")
            elif top_score < 55:
                result["deepfakeScore"] += 20
                result["details"].append("Slightly unnatural facial expression detected")
        dominant_gender_conf = analysis.get("gender", {})
        if isinstance(dominant_gender_conf, dict):
            max_gender_conf = max(dominant_gender_conf.values()) if dominant_gender_conf else 100
            if max_gender_conf < 60:
                result["morphingScore"] += 25
                result["details"].append("Ambiguous facial features — possible morphing")
    except Exception as e:
        result["details"].append(f"Face analysis unavailable: {str(e)}")

    # NSFW analysis
    try:
        from nudenet import NudeClassifier
        classifier = NudeClassifier()
        nude_result = classifier.classify(tmp_path)
        unsafe_score = nude_result.get(tmp_path, {}).get("unsafe", 0) * 100
        result["nsfwScore"] = round(unsafe_score)
        if unsafe_score > 70:
            result["details"].append("Explicit NSFW content detected")
        elif unsafe_score > 40:
            result["details"].append("Potentially inappropriate content detected")
    except Exception as e:
        result["details"].append(f"NSFW check unavailable: {str(e)}")

    # Final verdict
    max_score = max(result["deepfakeScore"], result["morphingScore"], result["nsfwScore"])
    if max_score >= 70:
        result["verdict"] = "CRITICAL — HIGH RISK CONTENT"
    elif max_score >= 40:
        result["verdict"] = "WARNING — SUSPICIOUS CONTENT"
    else:
        result["verdict"] = "CLEAN — NO THREATS DETECTED"

    return result

def generate_fir_pdf(fir_data: dict) -> bytes:
    buffer = io.BytesIO()
    c = rl_canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    # Dark header
    c.setFillColor(colors.HexColor('#0a0e1a'))
    c.rect(0, height - 90, width, 90, fill=1, stroke=0)

    c.setFillColor(colors.HexColor('#00ff88'))
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(width / 2, height - 35, "FIRST INFORMATION REPORT")

    c.setFillColor(colors.HexColor('#aaaaaa'))
    c.setFont("Helvetica", 10)
    c.drawCentredString(width / 2, height - 52, "National Cyber Crime Reporting Portal — Form 54-B")
    c.drawCentredString(width / 2, height - 66, "Generated by PhishGuard AI Sentinel System")

    y = height - 110

    def section_header(title):
        nonlocal y
        c.setFillColor(colors.HexColor('#e0e0e0'))
        c.rect(30, y - 4, width - 60, 18, fill=1, stroke=0)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(35, y + 8, title)
        y -= 22

    def field_row(label, value):
        nonlocal y
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(colors.black)
        c.drawString(35, y, f"{label}:")
        c.setFont("Helvetica", 10)
        c.drawString(180, y, str(value or "N/A"))
        y -= 16

    section_header("FIR Details")
    field_row("FIR ID", fir_data.get("firId"))
    field_row("Date & Time", datetime.now().strftime("%d %B %Y, %I:%M %p"))
    field_row("Report Type", "Cyber Crime — Mobile Theft with Live Tracking")
    y -= 8

    section_header("Complainant Details")
    field_row("Full Name", fir_data.get("ownerName"))
    field_row("Phone Number", fir_data.get("phone"))
    field_row("Address", fir_data.get("address"))
    y -= 8

    section_header("Device Details")
    field_row("IMEI Number", fir_data.get("imei"))
    field_row("Device Model", fir_data.get("deviceModel"))
    field_row("Last Known Latitude", fir_data.get("lat"))
    field_row("Last Known Longitude", fir_data.get("lng"))
    maps_link = f"maps.google.com/?q={fir_data.get('lat')},{fir_data.get('lng')}"
    field_row("Google Maps Link", maps_link)
    y -= 8

    section_header("Network Details")
    field_row("Last Seen IP Address", fir_data.get("ip", "Unavailable"))
    ts = fir_data.get("timestamp")
    field_row("Last Seen Time", datetime.fromtimestamp(ts / 1000).strftime("%d %B %Y, %I:%M:%S %p") if ts else "N/A")
    acc = fir_data.get("accuracy")
    field_row("GPS Accuracy", f"{float(acc):.1f} meters" if acc else "N/A")
    y -= 8

    section_header("Declaration")
    declaration = (
        "I hereby declare that the information furnished above is true and correct "
        "to the best of my knowledge. This FIR has been auto-generated by PhishGuard AI "
        "using live telemetry data from the Sentinel tracking system installed on the reported device. "
        "I request the concerned authorities to take appropriate action."
    )
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.black)
    from reportlab.lib.utils import simpleSplit
    lines = simpleSplit(declaration, "Helvetica", 9, width - 70)
    for line in lines:
        c.drawString(35, y, line)
        y -= 13

    y -= 10
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColor(colors.HexColor('#999999'))
    c.drawCentredString(width / 2, y, "This document is system-generated. Present to the nearest Cyber Crime Cell or upload at cybercrime.gov.in")

    c.save()
    buffer.seek(0)
    return buffer.read()

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        payload = json.dumps(message)
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)

    async def send_to(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_text(json.dumps(message))
        except Exception:
            self.disconnect(websocket)

manager = ConnectionManager()

def start_udp_server():
    udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    udp_sock.bind(('0.0.0.0', 5005))
    print("[UDP] Listening on port 5005")

    loop = asyncio.new_event_loop()

    async def handle_packet(data: bytes, addr):
        try:
            packet = json.loads(data.decode('utf-8'))
            imei = packet.get("imei")
            if not imei:
                return
            prev = devices.get(imei, {})
            history = prev.get("history", [])[-199:]
            history.append({"lat": packet.get("lat"), "lng": packet.get("lng"), "t": int(time.time() * 1000)})
            updated = {
                "imei": imei,
                "lat": packet.get("lat"),
                "lng": packet.get("lng"),
                "accuracy": packet.get("accuracy", 0),
                "battery": packet.get("battery", 0),
                "speed": packet.get("speed", 0),
                "altitude": packet.get("altitude", 0),
                "timestamp": int(time.time() * 1000),
                "ip": addr[0],
                "history": history
            }
            devices[imei] = updated
            await manager.broadcast({"type": "LOCATION_UPDATE", "data": updated})
        except Exception as e:
            print(f"[UDP] Parse error: {e}")

    def run_loop():
        asyncio.set_event_loop(loop)
        while True:
            try:
                data, addr = udp_sock.recvfrom(4096)
                loop.run_until_complete(handle_packet(data, addr))
            except Exception as e:
                print(f"[UDP] Error: {e}")

    thread = threading.Thread(target=run_loop, daemon=True)
    thread.start()


demo_state = {
    "lat": 12.9716,
    "lng": 77.5946,
    "battery": 78,
    "speed": 0.0
}

async def run_demo_simulator():
    import random
    DEMO_IMEI = "351756051523999"
    while True:
        await asyncio.sleep(0.5)
        if not manager.active_connections:
            continue
        demo_state["lat"] += (random.random() - 0.5) * 0.001
        demo_state["lng"] += (random.random() - 0.5) * 0.001
        demo_state["speed"] = round(random.random() * 12, 1)
        if random.random() > 0.97:
            demo_state["battery"] = max(1, demo_state["battery"] - 1)

        prev = devices.get(DEMO_IMEI, {})
        history = prev.get("history", [])[-199:]
        history.append({
            "lat": demo_state["lat"],
            "lng": demo_state["lng"],
            "t": int(time.time() * 1000)
        })

        updated = {
            "imei": DEMO_IMEI,
            "lat": round(demo_state["lat"], 7),
            "lng": round(demo_state["lng"], 7),
            "accuracy": round(8 + random.random() * 5, 1),
            "battery": demo_state["battery"],
            "speed": demo_state["speed"],
            "altitude": round(920 + random.random() * 10, 1),
            "timestamp": int(time.time() * 1000),
            "ip": "103.21.58.144",
            "history": history,
            "isDemo": True
        }
        devices[DEMO_IMEI] = updated
        await manager.broadcast({"type": "LOCATION_UPDATE", "data": updated})
        await manager.broadcast({"type": "TELEMETRY", "imei": DEMO_IMEI, "data": updated})


@app.on_event("startup")
async def startup_event():
    start_udp_server()
    asyncio.create_task(run_demo_simulator())
    print("\n=== PhishGuard AI Python C2 Server ===")
    print("  UDP  :5005  (Android telemetry)")
    print("  HTTP :3000  (REST API)")
    print("  WS   :/ws   (Dashboard WebSocket)")
    print("  Demo : IMEI 351756051523999 auto-simulating Bengaluru\n")


@app.get("/api/stats")
async def get_stats():
    import random
    scan_stats["scansToday"] += random.randint(0, 2)
    return {"success": True, "data": scan_stats}


@app.get("/api/device/{imei}")
async def get_device(imei: str):
    device = devices.get(imei)
    if not device:
        return JSONResponse(status_code=404, content={"success": False, "error": "Device not found"})
    return {"success": True, "data": device}


@app.post("/api/scan/phishing")
async def scan_phishing(body: dict):
    text = body.get("text", "")
    if not text:
        return JSONResponse(status_code=400, content={"success": False, "error": "text field required"})
    result = analyze_phishing(text)
    scan_stats["scansToday"] += 1
    if result["isPhishing"]:
        scan_stats["threatsBlocked"] += 1
    return {"success": True, "data": result}


@app.post("/api/scan/upi")
async def scan_upi(body: dict):
    upi_id = body.get("upiId", "").strip()
    if not upi_id:
        return JSONResponse(status_code=400, content={"success": False, "error": "upiId field required"})
    result = check_upi(upi_id)
    return {"success": True, "data": result}


@app.post("/api/scan/image")
async def scan_image(body: dict):
    image_b64 = body.get("imageBase64", "")
    media_type = body.get("mediaType", "image/jpeg")
    if not image_b64:
        return JSONResponse(status_code=400, content={"success": False, "error": "imageBase64 required"})
    result = analyze_image(image_b64, media_type)
    return {"success": True, "data": result}


@app.post("/api/simulate/location")
async def simulate_location(body: dict):
    imei = body.get("imei", "351756051523999")
    prev = devices.get(imei, {})
    history = prev.get("history", [])[-199:]
    history.append({"lat": body.get("lat"), "lng": body.get("lng"), "t": int(time.time() * 1000)})
    updated = {
        "imei": imei,
        "lat": body.get("lat"),
        "lng": body.get("lng"),
        "accuracy": body.get("accuracy", 15),
        "battery": body.get("battery", 72),
        "speed": body.get("speed", 0),
        "altitude": body.get("altitude", 0),
        "timestamp": int(time.time() * 1000),
        "ip": "192.168.1.100",
        "history": history
    }
    devices[imei] = updated
    await manager.broadcast({"type": "LOCATION_UPDATE", "data": updated})
    return {"success": True, "data": updated}


@app.post("/api/fir/generate")
async def fir_generate(body: dict):
    fir_id = "FIR-" + str(uuid.uuid4())[:8].upper()
    device = devices.get(body.get("imei"), {})
    fir_data = {
        "firId": fir_id,
        "ownerName": body.get("ownerName"),
        "phone": body.get("phone"),
        "address": body.get("address"),
        "deviceModel": body.get("deviceModel"),
        "imei": body.get("imei"),
        "lat": body.get("lat") or device.get("lat"),
        "lng": body.get("lng") or device.get("lng"),
        "ip": device.get("ip"),
        "accuracy": device.get("accuracy"),
        "timestamp": device.get("timestamp"),
        "generatedAt": datetime.now().isoformat()
    }
    fir_store[fir_id] = fir_data
    return {"success": True, "data": {"firId": fir_id, "fir": fir_data}}


@app.get("/api/fir/{fir_id}/pdf")
async def download_fir_pdf(fir_id: str):
    fir_data = fir_store.get(fir_id)
    if not fir_data:
        return JSONResponse(status_code=404, content={"success": False, "error": "FIR not found"})
    pdf_bytes = generate_fir_pdf(fir_data)
    filename = f"FIR_{fir_data.get('imei', 'unknown')}_{fir_id}.pdf"
    from fastapi.responses import Response
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ══════════════════════════════════════════════════════════
#  MODULE 8 — DIGITAL ARREST SCAM DETECTOR
# ══════════════════════════════════════════════════════════

DIGITAL_ARREST_RULES = [
    (r'\b(cbi|central bureau|enforcement directorate|ed officer|ncb|narcotics|cybercrime branch|cyber cell|trai officer|supreme court notice|high court notice|ministry of home)\b', 'Government Agency Impersonation', 45),
    (r'digital arrest|under arrest|you are arrested|arrest warrant', 'Digital Arrest Threat', 50),
    (r'(your|the).{0,40}(aadhaar|sim|mobile|bank account|pan card).{0,40}(linked to|used in|involved in|found in).{0,40}(crime|fraud|drugs|money laundering|illegal|case)', 'Identity-Crime Linkage Threat', 40),
    (r'do not (disconnect|cut|end|hang up).{0,20}(call|phone|video)|stay on (the )?(call|line|video)', 'Stay On Call Coercion', 45),
    (r'(transfer|send|deposit|pay).{0,30}(to clear|to settle|bail|penalty|fine|case).{0,30}(₹|rs\.?|rupees?\s*)\d+', 'Money Transfer Demand', 50),
    (r'(video call|skype|whatsapp video|google meet).{0,40}(arrest|hearing|court|investigation)', 'Video Call Arrest Claim', 45),
    (r'(₹|rs\.?|rupees?\s*)\d[\d,]*.{0,30}(bail|fine|penalty|deposit|guarantee|security)', 'Bail Money Demand', 40),
    (r'(your family|your parents|your children).{0,30}(will be arrested|will face|will suffer)', 'Family Threat', 35),
    (r'national security|anti terrorism|terror (case|charge|link)|hawala|money laundering case', 'Terror/Security Threat', 40),
    (r"(do not|don't).{0,20}(tell|inform|contact|call).{0,20}(anyone|family|friends|lawyer|police)", 'Secrecy Demand', 35),
    (r'(warrant number|case number|fir number|complaint number)\s*[:=]?\s*[A-Z0-9/\-]{4,}', 'Fake Case Number', 30),
    (r'आपको गिरफ्तार|डिजिटल अरेस्ट|सीबीआई|ईडी अधिकारी|कोर्ट नोटिस', 'Hindi Arrest Threat', 45),
]

def analyze_digital_arrest(text: str) -> dict:
    score = 0
    findings = []
    for pattern, label, pts in DIGITAL_ARREST_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            score += pts
            findings.append({"label": label, "score": pts})
    score = min(score, 100)
    if score >= 70:
        risk_level = "CRITICAL"
        verdict = "🚨 DIGITAL ARREST SCAM CONFIRMED. This is 100% fraud. Hang up immediately. No Indian agency conducts arrests via video call."
    elif score >= 40:
        risk_level = "HIGH"
        verdict = "⚠️ HIGH PROBABILITY SCAM. Multiple digital arrest indicators detected. Do NOT comply with any demands."
    elif score >= 20:
        risk_level = "MEDIUM"
        verdict = "⚡ Suspicious patterns detected. Verify by calling the agency directly on their official number."
    else:
        risk_level = "LOW"
        verdict = "✅ No digital arrest scam patterns detected in this text."
    return {
        "isScam": score >= 40,
        "riskScore": score,
        "riskLevel": risk_level,
        "findings": findings,
        "verdict": verdict,
        "immediateAction": "Call 1930 (Cyber Crime Helpline) if you believe you are being targeted." if score >= 40 else "Stay alert and verify any official communications through official channels.",
        "keyFact": "FACT: CBI, ED, NCB, Police — NO agency in India arrests anyone over a phone or video call. Ever."
    }

@app.post("/api/scan/digital-arrest")
async def scan_digital_arrest(body: dict):
    text = body.get("text", "")
    if not text:
        return JSONResponse(status_code=400, content={"success": False, "error": "text field required"})
    result = analyze_digital_arrest(text)
    scan_stats["scansToday"] += 1
    if result["isScam"]:
        scan_stats["threatsBlocked"] += 1
    return {"success": True, "data": result}


# ══════════════════════════════════════════════════════════
#  MODULE 9 — FAKE JOB OFFER DETECTOR
# ══════════════════════════════════════════════════════════

FAKE_JOB_RULES = [
    (r'(registration|joining|training|kit|uniform|security|processing|verification)\s*(fee|fees|charge|deposit|amount|payment)', 'Upfront Fee Demand', 50),
    (r'(earn|income|salary|package).{0,20}(₹|rs\.?|rupees?\s*)\d[\d,]*.{0,10}(per day|\/day|daily|per hour|\/hr)', 'Unrealistic Daily Salary', 40),
    (r'(₹|rs\.?|rupees?\s*)(50,000|60,000|70,000|80,000|90,000|1,00,000|1 lakh|2 lakh).{0,20}(per month|monthly|\/month|guaranteed)', 'Guaranteed Unrealistic Salary', 35),
    (r'(interview|hiring|recruitment|selection).{0,30}(whatsapp|telegram|google chat|hangout)', 'Interview on Messaging App', 40),
    (r'work from home.{0,50}(₹|rs\.?|rupees?\s*)\d[\d,]*.{0,20}(guaranteed|assured|daily|per day)', 'WFH Guaranteed Earning Scam', 45),
    (r'no (experience|qualification|degree|education) (required|needed|necessary)', 'No Qualification Needed', 25),
    (r'(part.?time|parttime).{0,30}(₹|rs\.?)\d[\d,]*.{0,10}(daily|per day|per hour)', 'Fake Part-Time Earning', 35),
    (r'(offer letter|appointment letter|joining letter).{0,40}(before|without|no).{0,20}interview', 'Offer Without Interview', 40),
    (r'(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com).{0,10}(hr|recruitment|jobs|hiring|career)', 'Fake HR Email Domain', 35),
    (r'(aadhaar|pan card|passport|bank account|account number).{0,40}(send|submit|upload|share|provide).{0,20}(joining|registration|verification)', 'Document Theft Attempt', 45),
    (r'(like|share|subscribe|watch|click).{0,30}(earn|income|money|payment|credited)', 'Like/Share to Earn Scam', 40),
    (r'(amazon|flipkart|myntra|meesho).{0,30}(work|job|earn|task|product review).{0,30}(per (day|hour|task)|daily)', 'Fake E-commerce Job', 40),
    (r'नौकरी.{0,20}(फीस|रजिस्ट्रेशन|जमा)|घर बैठे.{0,20}कमाएं|गारंटीड सैलरी', 'Hindi Job Scam Pattern', 40),
]

def analyze_fake_job(text: str, company_name: str = "", website: str = "") -> dict:
    score = 0
    findings = []
    for pattern, label, pts in FAKE_JOB_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            score += pts
            findings.append({"label": label, "score": pts})

    company_flags = []
    if company_name:
        if not re.search(r'(pvt\.?\s*ltd\.?|private limited|llp|inc\.?|corp\.?)', company_name, re.IGNORECASE):
            company_flags.append("Company name has no legal entity suffix (Pvt Ltd / LLP)")
        if len(company_name.split()) == 1:
            company_flags.append("Single-word company name — harder to verify")

    if website:
        if re.search(r'\.(xyz|tk|ml|ga|cf|gq|top|club|buzz|site|online)$', website, re.IGNORECASE):
            score += 35
            findings.append({"label": "Suspicious domain extension", "score": 35})
        if re.search(r'jobs?|career|hire|recruit', website, re.IGNORECASE) and re.search(r'(gmail|yahoo|outlook)', website, re.IGNORECASE):
            score += 30
            findings.append({"label": "Free domain masquerading as job portal", "score": 30})

    score = min(score, 100)
    if score >= 70:
        risk_level = "CRITICAL"
        verdict = "🚨 FAKE JOB SCAM CONFIRMED. Do NOT pay any fee. Do NOT share documents. Block and report."
    elif score >= 40:
        risk_level = "HIGH"
        verdict = "⚠️ HIGH RISK. Multiple fake job indicators found. Verify company on MCA21 before proceeding."
    elif score >= 20:
        risk_level = "MEDIUM"
        verdict = "⚡ Some suspicious patterns. Research the company independently before responding."
    else:
        risk_level = "LOW"
        verdict = "✅ No obvious scam patterns detected. Still verify the company before sharing any documents."

    return {
        "isScam": score >= 40,
        "riskScore": score,
        "riskLevel": risk_level,
        "findings": findings,
        "companyFlags": company_flags,
        "verdict": verdict,
        "verifyLinks": [
            "https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do",
            "https://www.ncs.gov.in",
            "https://www.linkedin.com/company/" + (company_name.replace(" ", "-").lower() if company_name else "search"),
        ],
        "immediateAction": "NEVER pay any fee for a job. Legitimate companies never charge candidates." if score >= 40 else "Research company on MCA21 portal before proceeding."
    }

@app.post("/api/scan/fake-job")
async def scan_fake_job(body: dict):
    text = body.get("text", "")
    company = body.get("companyName", "")
    website = body.get("website", "")
    if not text:
        return JSONResponse(status_code=400, content={"success": False, "error": "text field required"})
    result = analyze_fake_job(text, company, website)
    scan_stats["scansToday"] += 1
    if result["isScam"]:
        scan_stats["threatsBlocked"] += 1
    return {"success": True, "data": result}


# ══════════════════════════════════════════════════════════
#  MODULE 10 — MISINFORMATION & FAKE FORWARD DETECTOR
# ══════════════════════════════════════════════════════════

MISINFO_RULES = [
    (r'forward (this|it) to (at least|minimum|atleast)?\s*\d+\s*(people|friends|contacts|groups)', 'Chain Forward Demand', 40),
    (r'(share|forward).{0,30}(bad luck|good luck|blessings|curse|god will|भगवान|किस्मत)', 'Superstition Chain Forward', 35),
    (r'(breaking|urgent|alert|warning).{0,20}(news|update|message|forward|information).{0,30}(share|forward|spread|viral)', 'Fake Breaking News Pattern', 35),
    (r'(government|modi|pm|bjp|congress|supreme court).{0,40}(announced|declared|confirmed|approved).{0,40}(free|₹\d+|scheme|yojana).{0,40}(apply|register|link|click)', 'Fake Govt Scheme', 45),
    (r'(doctors|scientists|experts|who|icmr|iit).{0,30}(discovered|found|confirmed|proved|revealed).{0,30}(cure|treat|prevent|kill).{0,30}(cancer|covid|diabetes|virus)', 'Fake Medical Claim', 40),
    (r'(this message|this video|this image|this news).{0,30}(deleted|removing|banning|blocking).{0,20}(share before|forward fast|quickly forward)', 'Share Before Deleted Urgency', 35),
    (r'(army|military|jawans|soldiers|police).{0,40}(attacked|killed|martyred|protest|revolt).{0,40}(share|forward|viral|spread)', 'Inflammatory Military Claim', 45),
    (r'(communal|religious|temple|mosque|mandir|masjid).{0,50}(attacked|destroyed|demolished|burnt|fire).{0,30}(share|forward|viral)', 'Communal Misinformation', 50),
    (r'(apply|register|click|link).{0,30}(free (laptop|phone|gas|ration|money|scholarship|cycle)).{0,30}(yojana|scheme|government)', 'Fake Free Scheme Link', 45),
    (r'(your number|your account|you have been selected|lucky draw|congratulations).{0,40}(won|selected|chosen|eligible).{0,40}(₹|rs\.?)\d[\d,]+', 'Fake Lucky Draw', 40),
    (r'(पीएम मोदी|सरकार|सुप्रीम कोर्ट).{0,40}(मुफ्त|योजना|लाभ|रजिस्टर|क्लिक)', 'Hindi Fake Scheme', 40),
    (r'(corona|covid).{0,30}(cure|treatment|vaccine).{0,30}(home remedy|gharelu|nuskha|turmeric|ginger|giloy).{0,30}(100%|guaranteed|proven)', 'Health Misinformation', 35),
    (r'no source|source unknown|source: whatsapp|forwarded as received|received from someone', 'No Source Indicator', 25),
]

def analyze_misinformation(text: str) -> dict:
    score = 0
    findings = []
    for pattern, label, pts in MISINFO_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            score += pts
            findings.append({"label": label, "score": pts})

    credibility_flags = []
    if not re.search(r'(according to|source:|published|reported by|as per|cited|reference)', text, re.IGNORECASE):
        credibility_flags.append("No credible source cited")
    if not re.search(r'\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b', text, re.IGNORECASE):
        credibility_flags.append("No date mentioned")
    if len(text) < 50:
        credibility_flags.append("Very short claim — lacks context")
    if re.search(r'[!]{2,}|[?]{2,}|[A-Z]{10,}', text):
        credibility_flags.append("Excessive caps/punctuation — emotional manipulation tactic")

    score = min(score, 100)
    if score >= 70:
        risk_level = "CRITICAL"
        verdict = "🚨 HIGH PROBABILITY MISINFORMATION. Do NOT share this. Verify at pib.gov.in/factcheck before forwarding."
    elif score >= 40:
        risk_level = "HIGH"
        verdict = "⚠️ LIKELY FALSE or MISLEADING. Multiple misinformation patterns detected. Do not forward without verification."
    elif score >= 20:
        risk_level = "MEDIUM"
        verdict = "⚡ Suspicious content. Verify with official sources before sharing."
    else:
        risk_level = "LOW"
        verdict = "✅ No obvious misinformation patterns. Still verify with primary sources before sharing."

    return {
        "isMisinformation": score >= 40,
        "riskScore": score,
        "riskLevel": risk_level,
        "findings": findings,
        "credibilityFlags": credibility_flags,
        "verdict": verdict,
        "factCheckLinks": [
            "https://pib.gov.in/factcheck",
            "https://www.newschecker.in",
            "https://www.boomlive.in",
            "https://factly.in",
        ],
        "immediateAction": "DO NOT FORWARD. Report to WhatsApp as misinformation." if score >= 40 else "Verify with the sources below before sharing."
    }

@app.post("/api/scan/misinformation")
async def scan_misinformation(body: dict):
    text = body.get("text", "")
    if not text:
        return JSONResponse(status_code=400, content={"success": False, "error": "text field required"})
    result = analyze_misinformation(text)
    scan_stats["scansToday"] += 1
    if result["isMisinformation"]:
        scan_stats["threatsBlocked"] += 1
    return {"success": True, "data": result}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    await manager.send_to(websocket, {
        "type": "INIT",
        "data": {
            "devices": list(devices.values()),
            "stats": scan_stats
        }
    })
    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type") or msg.get("action")

            if msg_type in ("SUBSCRIBE_IMEI", "subscribe"):
                imei = msg.get("imei")
                device = devices.get(imei)
                if device:
                    await manager.send_to(websocket, {"type": "DEVICE_STATE", "data": device})
                else:
                    await manager.send_to(websocket, {"type": "DEVICE_NOT_FOUND", "imei": imei})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"[WS] Error: {e}")
        manager.disconnect(websocket)

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=3000,
        reload=False,
        log_level="info"
    )
