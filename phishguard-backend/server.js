const dgram = require('dgram');
const WebSocket = require('ws');
const crypto = require('crypto');

const UDP_PORT = 8883;
const WS_PORT = 8080;

// Set up WebSocket server
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Map(); // ws -> subscribedIMEIHashHex

console.log(`[C2 Backend] WebSocket Server starting on ws://localhost:${WS_PORT}`);

wss.on('connection', (ws) => {
    console.log('[WS] Web Dashboard Connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.action === 'subscribe' && data.imei) {
                // Compute the exact 32-byte SHA-256 hash expected from SentinelUdpClient
                const hashBuf = crypto.createHash('sha256')
                    .update('device-unique-salt-pg-2026')
                    .update(data.imei)
                    .digest();
                const hashHex = hashBuf.toString('hex'); // 32 bytes = 64 hex chars

                clients.set(ws, hashHex);
                console.log(`[WS] Subscribed to IMEI: ${data.imei.slice(0, 4)}*** (Hash: ${hashHex.slice(0, 16)}...)`);
                ws.send(JSON.stringify({ status: 'subscribed', hashHex: hashHex }));
            } else if (data.action === 'unsubscribe') {
                clients.delete(ws);
            }
        } catch (e) {
            console.error('[WS] Erroneous message:', e.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('[WS] Dashboard Disconnected');
    });
});


// Set up UDP server
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
    console.error(`[UDP] Server error:\n${err.stack}`);
    udpServer.close();
});

udpServer.on('message', (msg, rinfo) => {
    // 44-Byte Frame requirement mandated by SentinelUdpClient
    if (msg.length !== 44) {
        console.log(`[UDP] Dropped packet of length ${msg.length} from ${rinfo.address}:${rinfo.port}`);
        return;
    }

    try {
        const version = msg.readUInt8(0);
        if (version !== 1) return;

        const imeiHashBuf = msg.slice(1, 33);
        const imeiHashHex = imeiHashBuf.toString('hex');

        // Java ByteBuffer defaults to BIG_ENDIAN
        const lat = msg.readFloatBE(33);
        const lon = msg.readFloatBE(37);
        const batteryPercent = msg.readUInt8(41);
        const cellId = msg.readUInt16BE(42);

        // Forward this real telemetry to anyone subscribed on the WebSocket
        const payloadJSON = JSON.stringify({
            type: 'telemetry',
            lat: lat,
            lng: lon,
            battery: batteryPercent,
            cellId: cellId,
            timestamp: Date.now()
        });

        for (const [ws, subHash] of clients.entries()) {
            if (subHash === imeiHashHex && ws.readyState === WebSocket.OPEN) {
                ws.send(payloadJSON);
            }
        }
    } catch (e) {
        // Drop bad packets silently
    }
});

udpServer.on('listening', () => {
    const address = udpServer.address();
    console.log(`[C2 Backend] AntiGravity UDP Server listening on port ${address.port}`);
});

udpServer.bind(UDP_PORT);
