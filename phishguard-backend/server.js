const dgram = require('dgram');
const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

const UDP_PORT = 8883;
const WS_PORT = 8080;
const HTTP_PORT = 3000;

// Internal Map State
const stats = {
    scansToday: 0,
    threatsBlocked: 0,
    accuracyRate: 98
};

const devices = new Map(); // imei -> state { imei, lat, lng, battery, accuracy, ... }
const firs = new Map(); // firId -> firData

// --- PHISHING ANALYSIS ENGINE ---
function analyzePhishing(text) {
    let score = 0;
    const findings = [];
    const lowerText = text.toLowerCase();

    // English patterns
    if (/(urgent|expires today|immediate action)/i.test(lowerText)) { score += 20; findings.push({ label: "Urgency words", score: 20 }); }
    if (/(suspended|blocked|frozen|deactivated)/i.test(lowerText)) { score += 30; findings.push({ label: "Account suspended/blocked/frozen/deactivated", score: 30 }); }
    if (/(sbi|hdfc|icici|axis|pnb|kotak|paytm|phonepe|gpay)/i.test(lowerText)) { score += 25; findings.push({ label: "Bank name present", score: 25 }); }
    if (/(kyc update|kyc expire|kyc pending|kyc incomplete)/i.test(lowerText)) { score += 35; findings.push({ label: "KYC scam", score: 35 }); }
    if (/otp (near|share|send|give|provide|enter)/i.test(lowerText)) { score += 40; findings.push({ label: "OTP request", score: 40 }); }
    if (/(bit\.ly|tinyurl|t\.co|rb\.gy|cutt\.ly|goo\.gl)/i.test(lowerText)) { score += 25; findings.push({ label: "Shortened URL", score: 25 }); }
    if (/(prize|lottery|winner|cashback)/i.test(lowerText)) { score += 35; findings.push({ label: "Prize/lottery/winner scam", score: 35 }); }
    if (/(receive.*request|collect request|pay.*request)/i.test(lowerText)) { score += 40; findings.push({ label: "UPI collect request pattern", score: 40 }); }

    // IP in URL regex:
    if (/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/.test(lowerText)) { score += 30; findings.push({ label: "IP address found in URL", score: 30 }); }

    // Lookalike domain regex (bank names + suspicious tld)
    if (/(sbi|hdfc|icici|axis|pnb|kotak|paytm|phonepe|gpay)\.(xyz|tk|ml|ga|cf)/i.test(lowerText)) { score += 45; findings.push({ label: "Lookalike domain", score: 45 }); }

    // Hindi patterns
    if (/(खाता बंद|ब्लॉक|फ्रीज)/.test(text)) { score += 30; findings.push({ label: "Hindi: Account blocked/frozen", score: 30 }); }
    if (/(ओटीपी बताएं|शेयर|दें)/.test(text)) { score += 40; findings.push({ label: "Hindi: share OTP", score: 40 }); }
    if (/(केवाईसी अपडेट|वेरिफिकेशन)/.test(text)) { score += 35; findings.push({ label: "Hindi: KYC update/verification", score: 35 }); }

    // Gov impersonation
    if (/(income tax|trai|rbi|sebi).*(notice|penalty|fine)/i.test(lowerText)) { score += 35; findings.push({ label: "Government impersonation", score: 35 }); }

    score = Math.min(score, 100);
    const isPhishing = score >= 40;

    let riskLevel = "LOW";
    if (score >= 20 && score <= 39) riskLevel = "MEDIUM";
    else if (score >= 40 && score <= 69) riskLevel = "HIGH";
    else if (score >= 70) riskLevel = "CRITICAL";

    let summary = isPhishing
        ? "High risk of phishing detected. Do not click any links or share information."
        : "No strong phishing indicators found, but stay cautious.";

    return {
        isPhishing,
        riskScore: score,
        riskLevel,
        findings,
        summary
    };
}

// --- UPI TRUST ENGINE ---
function analyzeUPI(upiId) {
    const hardcodedBad = {
        "paytm.support@paytm": { type: "SCAM", reports: 847 },
        "refund.sbi@okaxis": { type: "PHISHING", reports: 1203 }
    };
    const hardcodedGood = {
        "pm.kisan@gov": { type: "GOVERNMENT" },
        "merchant@ybl": { type: "VERIFIED MERCHANT" }
    };

    const flags = [];
    let trusted = true;
    let label = "SAFE";
    let reports = 0;
    let type = "UNKNOWN";

    const lowerId = upiId.toLowerCase();

    if (hardcodedBad[lowerId]) {
        trusted = false;
        label = "DANGEROUS";
        reports = hardcodedBad[lowerId].reports;
        type = hardcodedBad[lowerId].type;
        flags.push("Matched hardcoded known-bad list");
    } else if (hardcodedGood[lowerId]) {
        trusted = true;
        label = "VERIFIED";
        type = hardcodedGood[lowerId].type;
    } else {
        if (/(support|refund|prize|lottery)/i.test(lowerId)) {
            trusted = false;
            label = "SUSPICIOUS";
            type = "POTENTIAL SCAM";
            flags.push("Keyword support/refund/prize/lottery in ID");
        }

        const handleMatch = lowerId.match(/@(.+)$/);
        if (handleMatch) {
            const handle = handleMatch[1];
            if (!["ybl", "paytm", "okaxis", "upi", "apl", "icici", "sbi"].includes(handle)) {
                trusted = false;
                label = "SUSPICIOUS";
                type = "UNKNOWN HANDLE";
                flags.push("Unknown VPA handle");
            }
        } else {
            trusted = false;
            label = "INVALID";
            type = "MALFORMED";
            flags.push("No VPA handle found");
        }

        if (/\d{7,}/.test(lowerId)) {
            trusted = false;
            label = "SUSPICIOUS";
            type = "LONG DIGIT STRING";
            flags.push("Long digit string (7+ digits)");
        }

        if (trusted) {
            label = "NEUTRAL";
            type = "UNVERIFIED USER";
        }
    }

    return { trusted, reports, type, label, flags };
}

// --- HTTP REST SERVER ---
const httpServer = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const setJSON = () => res.setHeader('Content-Type', 'application/json');

    let bodyData = '';
    req.on('data', chunk => bodyData += chunk.toString());
    req.on('end', () => {
        let body = {};
        if (bodyData) {
            try { body = JSON.parse(bodyData); } catch (e) { }
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;

        try {
            if (req.method === 'GET' && path === '/api/stats') {
                setJSON();
                res.end(JSON.stringify(stats));
            }
            else if (req.method === 'GET' && path.startsWith('/api/device/')) {
                const imei = path.split('/')[3];
                const device = devices.get(imei) || null;
                setJSON();
                if (device) {
                    res.end(JSON.stringify(device));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: "Device not found" }));
                }
            }
            else if (req.method === 'POST' && path === '/api/scan/phishing') {
                stats.scansToday++;
                const { text } = body;
                if (!text) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: "Missing text" }));
                    return;
                }
                const result = analyzePhishing(text);
                if (result.isPhishing) stats.threatsBlocked++;
                setJSON();
                res.end(JSON.stringify(result));
            }
            else if (req.method === 'POST' && path === '/api/scan/upi') {
                stats.scansToday++;
                const { upiId } = body;
                if (!upiId) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: "Missing upiId" }));
                    return;
                }
                const result = analyzeUPI(upiId);
                if (!result.trusted) stats.threatsBlocked++;
                setJSON();
                res.end(JSON.stringify(result));
            }
            else if (req.method === 'POST' && path === '/api/simulate/location') {
                const { imei, lat, lng, battery, accuracy } = body;
                const state = { imei, lat, lng, battery, accuracy, lastUpdate: Date.now() };
                devices.set(imei, state);

                const broadcastPayload = JSON.stringify({
                    type: "TELEMETRY",
                    data: state
                });

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastPayload);
                    }
                });

                setJSON();
                res.end(JSON.stringify(state));
            }
            else if (req.method === 'POST' && path === '/api/fir/generate') {
                const firId = 'FIR-' + Math.floor(Math.random() * 1000000);
                const fir = { firId, ...body, timestamp: Date.now() };
                firs.set(firId, fir);
                setJSON();
                res.end(JSON.stringify({ firId, fir }));
            }
            else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not Found' }));
            }
        } catch (err) {
            console.error(err);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
    });
});

httpServer.listen(HTTP_PORT, () => {
    console.log(`[HTTP] REST server listening on port ${HTTP_PORT}`);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    // On WebSocket connect: send INIT
    ws.send(JSON.stringify({
        type: "INIT",
        data: {
            devices: Array.from(devices.values()),
            stats: stats
        }
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Support arbitrary UI message formats, handle SUBSCRIBE_IMEI specifically as requested
            if (data.type === 'SUBSCRIBE_IMEI') {
                const imei = data.imei;
                if (devices.has(imei)) {
                    ws.send(JSON.stringify({
                        type: 'TELEMETRY',
                        data: devices.get(imei)
                    }));
                }
            }
            // Legacy backwards-compatibility for dashboard subscribe actions 
            else if (data.action === 'subscribe' && data.imei) {
                if (devices.has(data.imei)) {
                    ws.send(JSON.stringify({
                        type: 'telemetry',
                        ...devices.get(data.imei),
                        timestamp: Date.now()
                    }));
                }
            }
        } catch (e) { }
    });

    ws.on('close', () => {
        console.log('[WS] Client disconnected');
    });
});

console.log(`[C2 Backend] WebSocket Server starting on ws://localhost:${WS_PORT}`);

// --- AUTO-SIMULATOR ---
const DEMO_IMEI = "351756051523999";
let demoLat = 12.9716;
let demoLng = 77.5946;
let demoBattery = 85.0;

setInterval(() => {
    if (wss.clients.size > 0) {
        // drift demo device around Bangalore
        demoLat += (Math.random() - 0.5) * 0.0005;
        demoLng += (Math.random() - 0.5) * 0.0005;
        demoBattery = Math.max(1, demoBattery - Math.random() * 0.1);

        const state = {
            imei: DEMO_IMEI,
            lat: demoLat,
            lng: demoLng,
            battery: Math.round(demoBattery),
            accuracy: 10 + Math.random() * 20,
            lastUpdate: Date.now()
        };

        devices.set(DEMO_IMEI, state);

        const wsMsg = JSON.stringify({ type: 'TELEMETRY', data: state });
        const legacyMsg = JSON.stringify({ type: 'telemetry', ...state, timestamp: state.lastUpdate });

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                // broadcast via WebSocket exactly like a real device
                client.send(wsMsg);
                client.send(legacyMsg);
            }
        });
    }
}, 500);

// --- UDP SERVER (Legacy Support) ---
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
    console.error(`[UDP] Server error:\n${err.stack}`);
    udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
    if (msg.length !== 44) return;
    try {
        const version = msg.readUInt8(0);
        if (version !== 1) return;

        // Legacy payload didn't transmit exact IMEI but rather hash
        const lat = msg.readFloatBE(33);
        const lon = msg.readFloatBE(37);
        const batteryPercent = msg.readUInt8(41);

        // Pass to WS if needed or ignore and rely entirely on REST/WS endpoints for hackathon
    } catch (e) { }
});

udpServer.on('listening', () => {
    const address = udpServer.address();
    console.log(`[C2 Backend] AntiGravity UDP Server listening on port ${address.port}`);
});

udpServer.bind(UDP_PORT);
