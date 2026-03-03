const dgram = require('dgram');
const crypto = require('crypto');

const SERVER_IP = '127.0.0.1';
const SERVER_PORT = 8883;

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Usage: node android-simulator.js <15-DIGIT-IMEI>");
    process.exit(1);
}

const imei = args[0];
if (imei.length < 15) {
    console.warn("Warning: IMEI is unusually short.");
}

console.log(`[Simulator] Initializing AntiGravityCore Sentinel UDP Client Simulator for IMEI: ${imei}`);

// 1. Generate the exact same SHA-256 hash logic as the Android codebase (32 bytes)
const hashBuf = crypto.createHash('sha256')
    .update('device-unique-salt-pg-2026')
    .update(imei)
    .digest();

// Simulate device starting at random Bangalore location
let lat = 12.9716 + (Math.random() - 0.5) * 0.05;
let lon = 77.5946 + (Math.random() - 0.5) * 0.05;
let battery = 85;

const client = dgram.createSocket('udp4');

let seq = 1;
setInterval(() => {
    // Construct 44-Byte Payload matching SentinelUdpClient.java
    const payload = Buffer.alloc(44);

    // Byte 0: Version
    payload.writeUInt8(1, 0);

    // Bytes 1-32: IMEI Hash (32-bytes)
    hashBuf.copy(payload, 1);

    // Bytes 33-36: Latitude (Float BE)
    lat += (Math.random() - 0.5) * 0.002;
    payload.writeFloatBE(lat, 33);

    // Bytes 37-40: Longitude (Float BE)
    lon += (Math.random() - 0.5) * 0.002;
    payload.writeFloatBE(lon, 37);

    // Byte 41: Battery 
    battery = Math.max(1, battery - (Math.random() > 0.8 ? 1 : 0));
    payload.writeUInt8(battery, 41);

    // Bytes 42-43: CellID
    payload.writeUInt16BE(4092, 42);

    client.send(payload, SERVER_PORT, SERVER_IP, (err) => {
        if (err) {
            console.error(`[Simulator] Failed to send UDP Heartbeat:`, err);
        } else {
            console.log(`[Simulator] UDP Heartbeat Sent | SEQ: ${seq++} | LEN: 44 Bytes | LAT: ${lat.toFixed(5)} | LON: ${lon.toFixed(5)} | BAT: ${battery}%`);
        }
    });

}, 2000); // Pulse every 2 seconds
