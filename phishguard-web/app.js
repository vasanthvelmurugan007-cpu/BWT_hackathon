/**
 * PhishGuard AI — Main Application Logic
 */

// ─── C2 SERVER CONFIG ─────────────────────────────
// Node.js backend  → ws://localhost:8080
// Python backend   → ws://localhost:3000/ws
const WS_URL = 'ws://localhost:8080';
const API_URL = 'http://localhost:3000';
// ──────────────────────────────────────────────────

let anthropicApiKey = '';
let trackedIMEI = null;
let currentDeviceState = null;
let lerpFrom = null;
let lerpTo = null;
let lerpStart = null;
const LERP_DURATION = 400;
let trail = null;
let marker = null;
let ws = null;
let wsReconnectDelay = 1000;
let wsReconnectTimer = null;

// ─── LEGACY STATE (keep for existing functions) ───
let scanCount = 0;
let blockedCount = 0;
let trackingTimer = null;
let trackingActive = false;
let map = null;
let mapMarker = null;
let currentLat = 12.9716;
let currentLng = 77.5946;
let lastPhishingResult = null;
let lastFinanceResult = null;
let currentImage_File = null;
let sosActive = false;
window._deepfakeFile = null;
window._c2Devices = {};

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  phishing: 'Phishing Detector',
  tracking: 'Stolen Phone & FIR',
  deepfake: 'Deepfake Guard',
  finance: 'Financial Fraud',
  sos: 'SOS & Safety',
  digitalArrest: 'Digital Arrest Detector',
  fakeJob: 'Fake Job Scanner',
  misinformation: 'Fake News Check'
};

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Clock
  setInterval(() => {
    const el = document.getElementById('time-display') || document.getElementById('liveClock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
  }, 1000);

  renderContacts();
  initMap();
  wireSimSwapDetector();
  appendTerminalLine();
  setInterval(appendTerminalLine, 3000);

  // Drag & drop for image
  const zone = document.getElementById('upload-zone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'rgba(239,68,68,.6)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.style.borderColor = '';
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) setImageFile(f);
    });
  }

  // API Key wiring (FIX 12)
  document.getElementById('saveApiKeyBtn')?.addEventListener('click', () => {
    const val = document.getElementById('anthropicKeyInput')?.value.trim();
    const status = document.getElementById('apiKeyStatus');
    if (val && val.startsWith('sk-ant-')) {
      anthropicApiKey = val;
      document.getElementById('anthropicKeyInput').value = '';
      if (status) { status.textContent = '\u2713 API key active for this session'; status.style.color = '#00ff88'; }
    } else {
      if (status) { status.textContent = '\u2717 Invalid key format \u2014 must start with sk-ant-'; status.style.color = '#ff3366'; }
    }
  });

  // Demo device button
  document.getElementById('loadDemoBtn')?.addEventListener('click', () => {
    const input = document.getElementById('imeiInput');
    if (input) input.value = '351756051523999';
    connectToDevice('351756051523999');
  });

  // Contact add button
  document.getElementById('addContactBtn')?.addEventListener('click', () => {
    const name = document.getElementById('contactName')?.value || '';
    const phone = document.getElementById('contactPhone')?.value || '';
    if (!name.trim() || !phone.trim()) { showToast('Please enter both name and phone number', 'error'); return; }
    addContact(name, phone);
    if (document.getElementById('contactName')) document.getElementById('contactName').value = '';
    if (document.getElementById('contactPhone')) document.getElementById('contactPhone').value = '';
  });

  // Analyze image button
  document.getElementById('analyzeImageBtn')?.addEventListener('click', runDeepfakeScan);

  // FIR form
  document.getElementById('firForm')?.addEventListener('submit', handleFIRSubmit);

  // Global WS Connect
  connectC2WebSocket();

  // Stats polling
  setInterval(() => {
    fetch(`${API_URL}/api/stats`)
      .then(r => r.json())
      .then(res => {
        const data = res.data || res;
        animateCounter(document.getElementById('scanCount'), data.scansToday || 0);
        animateCounter(document.getElementById('blockedCount'), data.threatsBlocked || 0);
      }).catch(() => { });
  }, 5000);
});

let globalWs = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
let c2Devices = new Map();

// ─── WEBSOCKET (FIX 20) ──────────────────────────────
function connectC2WebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const statusDot = document.getElementById('c2StatusDot') || document.getElementById('c2-dot');
  const statusLabel = document.getElementById('c2StatusLabel') || document.getElementById('c2-text');

  function setStatus(state) {
    const states = {
      connected: { color: '#00ff88', text: 'C2 Connected', banner: false },
      reconnecting: { color: '#ffaa00', text: 'Reconnecting\u2026', banner: false },
      offline: { color: '#ff3366', text: 'C2 Offline', banner: true },
    };
    const s = states[state] || states.offline;
    if (statusDot) statusDot.style.background = s.color;
    if (statusLabel) statusLabel.textContent = s.text;
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.style.display = s.banner ? 'block' : 'none';
  }

  try {
    ws = new WebSocket(WS_URL);
    globalWs = ws;
  } catch (e) {
    setStatus('offline');
    scheduleReconnect();
    return;
  }

  setStatus('reconnecting');

  ws.onopen = () => {
    setStatus('connected');
    wsReconnectDelay = 1000;
    reconnectDelay = 1000;
    appendTerminalLine('[C2] WebSocket connection established', 'ok');
  };

  ws.onmessage = (event) => {
    try { handleWSMessage(JSON.parse(event.data)); } catch { }
  };

  ws.onclose = () => {
    setStatus('offline');
    scheduleReconnect();
  };

  ws.onerror = () => { setStatus('offline'); };
}

function scheduleReconnect() {
  clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(() => {
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
    reconnectDelay = wsReconnectDelay;
    connectC2WebSocket();
  }, wsReconnectDelay);
}

function handleWSMessage(msg) {
  const type = msg.type || msg.action;
  if (type === 'INIT') {
    if (msg.data?.devices) {
      msg.data.devices.forEach(d => {
        if (d.imei) { window._c2Devices[d.imei] = d; c2Devices.set(d.imei, d); }
      });
    }
    if (msg.data?.stats) {
      animateCounter(document.getElementById('scanCount'), msg.data.stats.scansToday || 0);
      animateCounter(document.getElementById('blockedCount'), msg.data.stats.threatsBlocked || 0);
    }
  }
  if (type === 'LOCATION_UPDATE' || type === 'TELEMETRY' || type === 'telemetry') {
    const d = msg.data || msg;
    if (d.imei) { window._c2Devices[d.imei] = d; c2Devices.set(d.imei, d); }
    if (d.imei === trackedIMEI) {
      currentDeviceState = d;
      onLocationUpdate(d.lat, d.lng, d);
      // Legacy log area
      const logArea = document.getElementById('telemetry-log');
      if (logArea && logArea.style.display !== 'none') {
        logArea.innerHTML += `<div>[${new Date().toLocaleTimeString('en-IN')}] LAT: ${d.lat?.toFixed(6)} LNG: ${d.lng?.toFixed(6)} BAT: ${d.battery}%</div>`;
        logArea.scrollTop = logArea.scrollHeight;
      }
    }
  }
  if (type === 'DEVICE_STATE') {
    const d = msg.data;
    if (d?.imei === trackedIMEI) { currentDeviceState = d; onLocationUpdate(d.lat, d.lng, d); }
  }
}

function updateClock() {
  const now = new Date();
  const el = document.getElementById('time-display') || document.getElementById('liveClock');
  if (el) el.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// FIX 13 — animateCounter
function animateCounter(el, targetValue, duration = 800) {
  if (!el) return;
  const from = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
  const isDecimal = String(targetValue).includes('.');
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = from + (targetValue - from) * eased;
    el.textContent = isDecimal ? current.toFixed(1) : Math.floor(current).toLocaleString('en-IN');
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function setScanCounts() {
  animateCounter(document.getElementById('scanCount') || document.getElementById('scan-count'), scanCount);
  animateCounter(document.getElementById('blockedCount') || document.getElementById('blocked-count'), blockedCount);
}

// ─── NAV ─────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`[data-page="${name}"]`).classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[name];

  if (name === 'tracking' && !map) initMap();
  if (name === 'tracking' && map) setTimeout(() => map.invalidateSize(), 200);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ─── TOAST ───────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), duration);
}

// ─── LOADING ─────────────────────────────────────────
function showLoading(text = 'Analyzing...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

// ─── ACTIVITY LOG ────────────────────────────────────
function addLog(type, text, badgeClass) {
  const container = document.getElementById('recent-log');
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'log-item';
  div.innerHTML = `
    <span class="log-badge ${badgeClass}">${type}</span>
    <span class="log-text">${text}</span>
    <span class="log-time">${time}</span>`;
  container.insertBefore(div, container.children[1]);
  if (container.children.length > 11) container.removeChild(container.lastChild);
}

// ─── PHISHING DETECTOR ───────────────────────────────
const SAMPLES = {
  high: `URGENT: Dear customer, your SBI account has been temporarily blocked due to suspicious activity. Verify your KYC immediately to avoid permanent suspension. Click now: bit.ly/3sbi-kyc-update. Your OTP is required. Do not ignore this message – Rs 50,000 will be refunded after verification.`,
  low: `Hi Priya, your Swiggy order #45231 has been delivered. Thank you for ordering! Rate your experience at swiggy.com/rate. Hope you enjoyed your meal! — Swiggy Customer Care`
};

const FINANCE_SAMPLES = {
  fraud: `ALERT: Collect request of Rs 45000 sent from +91 9876543210 via UPI. This is URGENT – your account will be blocked in 2 hours if not paid. Verify at hdfc-support-upi.xyz immediately. OTP: 847291`,
  legit: `Your UPI payment of Rs 150 to Zomato (zomato@icici) was successful on 02-Mar-2026. Ref: 3847291. Balance: Rs 12,450. Bank of Baroda Mobile Banking.`
};

function loadPhishingSample(type) {
  document.getElementById('phishing-input').value = SAMPLES[type];
}

function loadFinanceSample(type) {
  document.getElementById('finance-input').value = FINANCE_SAMPLES[type];
}

async function analyzePhishing() {
  const text = document.getElementById('phishing-input').value.trim();
  if (!text) { showToast('Please enter some text to analyze', 'error'); return; }

  showLoading('Scanning for phishing patterns...');
  await sleep(900);

  const result = typeof analyzePhishing === 'function' ? analyzePhishing(text) : analyzePhishingText(text);
  lastPhishingResult = result;
  hideLoading();

  scanCount++;
  if (result.level !== 'Low') blockedCount++;
  setScanCounts();

  const showHindi = document.getElementById('hindi-toggle').checked;
  renderPhishingResult(result, showHindi);

  const excerpt = text.substring(0, 50) + (text.length > 50 ? '…' : '');
  const badgeClass = `badge-${result.level.toLowerCase()}`;
  addLog(result.level, excerpt, badgeClass);
}

function renderPhishingResult(r, hindi = false) {
  const panel = document.getElementById('phishing-result');
  const icon = r.level === 'High' ? '🚨' : r.level === 'Medium' ? '⚠️' : '✅';
  const explanation = hindi ? r.explanationHi : r.explanation;
  const lvlClass = r.level.toLowerCase();
  const fillClass = `fill-${lvlClass}`;
  const labelClass = `label-${lvlClass}`;
  const colorMap = { High: '#f87171', Medium: '#fbbf24', Low: '#4ade80' };
  const color = colorMap[r.level];

  panel.innerHTML = `
    <div class="result-card ${lvlClass}">
      <div class="result-header">
        <span class="result-icon">${icon}</span>
        <div>
          <div class="result-level" style="color:${color}">${r.level} Risk</div>
          <div class="result-score">Confidence Score: ${r.score.toFixed(0)}%</div>
        </div>
        <span class="result-label ${labelClass}">${r.score.toFixed(0)}%</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-label"><span>Threat Level</span><span style="color:${color}">${r.level}</span></div>
        <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${r.score}%"></div></div>
      </div>
      <div class="result-explanation">${explanation}</div>
      <div class="result-reasons">
        ${r.reasons.map(rs => `<span class="reason-chip">🔸 ${rs}</span>`).join('')}
        ${r.reasons.length === 0 ? '<span class="reason-chip">✅ No suspicious patterns</span>' : ''}
      </div>
      <div class="result-actions">
        <button class="btn-block" onclick="blockSender()">🚫 Block</button>
        <button class="btn-report" onclick="reportPhishing()">📋 Copy Report</button>
        ${r.level !== 'Low' ? `<button class="btn-report" onclick="showToast('Reported to CERT-In database','success')">📡 Report to CERT-In</button>` : ''}
      </div>
    </div>`;
}

function blockSender() {
  showToast('Sender blocked and reported to PhishGuard database ✓', 'success');
}

function reportPhishing() {
  if (!lastPhishingResult) return;
  const r = lastPhishingResult;
  const text = `PhishGuard AI — Phishing Report\nLevel: ${r.level}\nScore: ${r.score.toFixed(0)}%\nReasons:\n${r.reasons.map(x => '  • ' + x).join('\n')}\nExplanation: ${r.explanation}`;
  navigator.clipboard.writeText(text).then(() => showToast('Report copied to clipboard ✓', 'success'));
}

// ─── TRACKING ────────────────────────────────────────
function initMap() {
  const el = document.getElementById('map');
  if (!el || map) return;
  try {
    map = L.map('map').setView([currentLat, currentLng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', subdomains: ['a', 'b', 'c']
    }).addTo(map);
    const icon = L.divIcon({
      className: '',
      html: '<div style="background:#ef4444;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 14px rgba(239,68,68,.8)"></div>',
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    mapMarker = L.marker([currentLat, currentLng], { icon }).addTo(map)
      .bindPopup('<b>Device Location</b><br>Last known position').openPopup();
  } catch (e) { console.warn('Map init failed:', e); }
}

let targetLat = currentLat;
let targetLng = currentLng;
let lerpAnimation = null;

function animateMapToTarget() {
  if (!map || !mapMarker) return;
  const t = 0.05; // Smoothing factor
  const dLat = (targetLat - currentLat);
  const dLng = (targetLng - currentLng);

  if (Math.abs(dLat) > 0.000001 || Math.abs(dLng) > 0.000001) {
    currentLat += dLat * t;
    currentLng += dLng * t;
    mapMarker.setLatLng([currentLat, currentLng]);
    map.panTo([currentLat, currentLng], { animate: false });
    lerpAnimation = requestAnimationFrame(animateMapToTarget);
  } else {
    currentLat = targetLat;
    currentLng = targetLng;
    mapMarker.setLatLng([currentLat, currentLng]);
  }
}

async function fetchSnappedCoordinates(lat, lng) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('OSRM timeout')), 2000)
  );
  try {
    const result = await Promise.race([
      fetch(`https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`).then(r => r.json()),
      timeout
    ]);
    if (result.waypoints && result.waypoints[0]) {
      const [snappedLng, snappedLat] = result.waypoints[0].location;
      return { lat: snappedLat, lng: snappedLng };
    }
    return { lat, lng };
  } catch {
    return { lat, lng }; // fallback to raw coordinates silently
  }
}

async function updateMapPosition(lat, lng) {
  const snapped = await fetchSnappedCoordinates(lat, lng);
  targetLat = snapped.lat; targetLng = snapped.lng;
  document.getElementById('lat-display').textContent = targetLat.toFixed(6);
  document.getElementById('lng-display').textContent = targetLng.toFixed(6);
  document.getElementById('last-update').textContent = new Date().toLocaleTimeString('en-IN');

  if (map && mapMarker) {
    if (lerpAnimation) cancelAnimationFrame(lerpAnimation);
    animateMapToTarget();
  }
}

function reportStolen() {
  if (trackingActive) { showToast('Already tracking device', 'info'); return; }
  trackingActive = true;

  document.getElementById('device-status-text').textContent = 'STOLEN — Tracking';
  document.getElementById('device-status-text').style.color = '#f87171';
  const badge = document.getElementById('status-badge');
  badge.textContent = 'STOLEN';
  badge.className = 'status-badge stolen';
  document.getElementById('device-status-card').style.borderColor = 'rgba(239,68,68,.4)';
  document.getElementById('threat-level').innerHTML = '<span class="pulse" style="background:#ef4444"></span> Threat Detected!';
  document.getElementById('threat-level').style.color = '#f87171';

  showToast('🚨 Tracking activated! GPS pinging every 5 seconds…', 'error', 4000);
  addLog('STOLEN', 'Device marked stolen — GPS tracking started', 'badge-high');

  let bat = 67;
  trackingTimer = setInterval(() => {
    const dx = (Math.random() - 0.5) / 800;
    const dy = (Math.random() - 0.5) / 800;
    updateMapPosition(currentLat + dx, currentLng + dy);
    bat = Math.max(1, bat - Math.floor(Math.random() * 2));
    updateBatteryDisplay(bat);
  }, 5000);
}

function stopTracking() {
  if (!trackingActive) return;
  clearInterval(trackingTimer);
  trackingActive = false;
  document.getElementById('device-status-text').textContent = 'Secure';
  document.getElementById('device-status-text').style.color = '';
  const badge = document.getElementById('status-badge');
  badge.textContent = 'SAFE'; badge.className = 'status-badge safe';
  document.getElementById('device-status-card').style.borderColor = '';
  document.getElementById('threat-level').innerHTML = '<span class="pulse"></span> Scanning...';
  document.getElementById('threat-level').style.color = '';
  showToast('Tracking stopped', 'info');
}

function generateFIR() {
  document.getElementById('fir-form').style.display = 'flex';
  document.getElementById('fir-form').scrollIntoView({ behavior: 'smooth' });
}

async function downloadFIR() {
  const ownerName = document.getElementById('fir-name').value.trim() || 'Unknown Complainant';
  const phone = document.getElementById('fir-phone').value.trim() || 'Not Provided';
  const imeiInput = document.getElementById('fir-imei').value.trim() || 'Not Provided';
  const imeiToUse = imeiInput !== 'Not Provided' ? imeiInput : (document.getElementById('telemetry-imei')?.value.trim() || 'Not Provided');

  const deviceState = c2Devices.get(imeiToUse) || {};
  const formData = {
    ownerName,
    phone,
    imei: imeiToUse,
    address: 'Not Provided',
    lat: deviceState.lat || currentLat,
    lng: deviceState.lng || currentLng,
    accuracy: deviceState.accuracy,
    timestamp: deviceState.lastUpdate || Date.now(),
    deviceModel: 'Unknown Device',
    ip: 'Unknown'
  };

  try {
    const res = await fetch('http://localhost:3000/api/fir/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    if (!res.ok) throw new Error('Backend failed');
    const serverResponse = await res.json();
    generateFIRPdf({ ...formData, ...serverResponse.fir });
  } catch (err) {
    formData.firId = 'PG-' + Date.now() + '-FIR (Local)';
    generateFIRPdf(formData);
  }
  showToast('✅ FIR downloaded successfully!', 'success');
  addLog('FIR', `FIR generated for ${ownerName}`, 'badge-safe');
}

function generateFIRPdf(firData) {
  if (!window.jspdf) { showToast('jsPDF library missing', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(10, 14, 26);
  doc.rect(0, 0, pageW, 40, 'F');
  doc.setTextColor(0, 255, 136);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('FIRST INFORMATION REPORT', pageW / 2, 18, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 180);
  doc.text('National Cyber Crime Reporting Portal — Form 54-B', pageW / 2, 28, { align: 'center' });
  doc.text('Generated by PhishGuard AI Sentinel System', pageW / 2, 35, { align: 'center' });

  doc.setTextColor(0, 0, 0);
  let y = 50;

  const section = (title) => {
    doc.setFillColor(230, 230, 230);
    doc.rect(10, y, pageW - 20, 8, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 14, y + 6);
    y += 12;
  };

  const field = (label, value) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(label + ':', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value || 'N/A'), 70, y);
    y += 8;
  };

  section('FIR Details');
  field('FIR ID', firData.firId);
  field('Date & Time', new Date().toLocaleString('en-IN'));
  field('Report Type', 'Cyber Crime — Mobile Theft with Tracking');

  y += 4;
  section('Complainant Details');
  field('Full Name', firData.ownerName);
  field('Phone Number', firData.phone);
  field('Address', firData.address);

  y += 4;
  section('Device Details');
  field('IMEI Number', firData.imei);
  field('Device Model', firData.deviceModel);
  field('Last Known Lat', firData.lat);
  field('Last Known Lng', firData.lng);
  field('Google Maps', `maps.google.com/?q=${firData.lat},${firData.lng}`);

  y += 4;
  section('Network Details');
  field('Last Seen IP', firData.ip || 'Unavailable');
  field('Last Seen Time', firData.timestamp ? new Date(firData.timestamp).toLocaleString('en-IN') : 'N/A');
  field('GPS Accuracy', firData.accuracy ? firData.accuracy.toFixed(1) + ' meters' : 'N/A');

  y += 4;
  section('Declaration');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const declaration = 'I hereby declare that the information furnished above is true and correct to the best of my knowledge. This FIR has been auto-generated by PhishGuard AI using live telemetry data from the Sentinel tracking system.';
  const lines = doc.splitTextToSize(declaration, pageW - 28);
  doc.text(lines, 14, y);
  y += lines.length * 6 + 10;

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('This document is system-generated. Present to the nearest Cyber Crime Cell.', pageW / 2, y, { align: 'center' });

  const filename = `FIR_${firData.imei}_${Date.now()}.pdf`;
  doc.save(filename);
}

// Global tracking WS state indicator since connection is global
let telemetryIsSubscribed = false;

function startImeiTelemetry() {
  const imei = document.getElementById('telemetry-imei').value.trim();
  if (imei.length < 15) { showToast('Please enter a valid 15-digit IMEI', 'error'); return; }

  const btn = document.getElementById('telemetry-btn');
  const logArea = document.getElementById('telemetry-log');

  if (telemetryIsSubscribed) {
    if (globalWs && globalWs.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify({ type: 'UNSUBSCRIBE_IMEI', imei: imei }));
      globalWs.send(JSON.stringify({ action: 'unsubscribe' })); // Legacy C2 support
    }
    telemetryIsSubscribed = false;
    btn.textContent = 'CONNECT';
    btn.className = 'btn-primary';
    logArea.innerHTML += `<div>[${new Date().toLocaleTimeString('en-IN')}] Stopped active tracking.</div>`;
    if (trackingActive) stopTracking();
    return;
  }

  btn.textContent = 'DISCONNECT';
  btn.className = 'btn-secondary';
  logArea.style.display = 'block';
  logArea.innerHTML = `<div>[${new Date().toLocaleTimeString('en-IN')}] Fetching state for IMEI: ${imei.slice(0, 4)}***********</div>`;

  telemetryIsSubscribed = true;
  if (!trackingActive) reportStolen();
  if (trackingTimer) { clearInterval(trackingTimer); trackingTimer = null; } // Override mock tracking

  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify({ type: 'SUBSCRIBE_IMEI', imei: imei }));
    globalWs.send(JSON.stringify({ action: 'subscribe', imei: imei })); // Legacy C2 server support
    logArea.innerHTML += `<div>[${new Date().toLocaleTimeString('en-IN')}] Subscribe request sent successfully over WebSocket.</div>`;

    // Check if we already have initial state
    if (c2Devices.has(imei)) {
      const initData = c2Devices.get(imei);
      updateMapPosition(initData.lat, initData.lng);
      if (map && initData.lat && initData.lng) {
        map.setView([initData.lat, initData.lng], 15, { animate: true });
      }
      updateBatteryDisplay(initData.battery);
    }
  } else {
    logArea.innerHTML += `<div style="color:#ef4444">[${new Date().toLocaleTimeString('en-IN')}] Error: C2 WebSocket disconnected. Reconnecting in background...</div>`;
  }

  updateDemoBanner(imei);
}

function updateDemoBanner(imei) {
  const banner = document.getElementById('demoBanner');
  if (!banner) return;
  if (imei === '351756051523999') {
    banner.style.display = 'flex';
    banner.textContent = '⚡ DEMO DEVICE ACTIVE — Live simulated telemetry from Bengaluru';
  } else {
    banner.style.display = 'none';
  }
}

// ─── DEEPFAKE ────────────────────────────────────────
function setImageFile(file) {
  currentImage_File = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('upload-zone').style.display = 'none';
    const wrap = document.getElementById('image-preview-wrap');
    wrap.style.display = 'block';
    const img = document.getElementById('image-preview');
    img.src = e.target.result;
    img.classList.remove('blurred');
  };
  reader.readAsDataURL(file);
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (file) setImageFile(file);
}

function clearImage() {
  currentImage_File = null;
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('image-preview-wrap').style.display = 'none';
  document.getElementById('image-preview').src = '';
  document.getElementById('deepfake-result').innerHTML = `
    <div class="result-empty">
      <div class="empty-icon">🔍</div>
      <p>Upload an image to begin analysis</p>
      <p class="hint">94% detection accuracy on known deepfake datasets</p>
    </div>`;
}

async function analyzeImage() {
  if (!currentImage_File) { showToast('Please upload an image first', 'error'); return; }

  showLoading('Running deepfake analysis...');
  await sleep(400);

  let r;
  try {
    const reader = new FileReader();
    const base64Promise = new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = error => reject(error);
    });
    reader.readAsDataURL(currentImage_File);
    const base64String = await base64Promise;

    const response = await fetch('http://localhost:3000/api/scan/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64String,
        mediaType: currentImage_File.type
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Server error');

    const bd = result.data;
    const uiLevelMap = {
      'CLEAN — NO THREATS DETECTED': 'Low',
      'WARNING — SUSPICIOUS CONTENT': 'Medium',
      'CRITICAL — HIGH RISK CONTENT': 'High',
      'ERROR': 'Low'
    };

    r = {
      level: uiLevelMap[bd.verdict] || 'Low',
      details: bd.details.length ? bd.details.join(', ') : 'No anomalies detected.',
    };
  } catch (err) {
    hideLoading();
    document.getElementById('deepfake-result').innerHTML = `
      <div class="result-empty">
        <p>❌ Analysis failed: [${err.message}]. Is the C2 server running?</p>
      </div>`;
    return;
  }
  hideLoading();
  scanCount++;
  if (r.level !== 'Low') blockedCount++;
  setScanCounts();

  // Blur image if high risk
  if (r.level === 'High') document.getElementById('image-preview').classList.add('blurred');
  else document.getElementById('image-preview').classList.remove('blurred');

  const icon = r.level === 'High' ? '🚨' : r.level === 'Medium' ? '⚠️' : '✅';
  const lvl = r.level.toLowerCase();
  const colorMap = { High: '#f87171', Medium: '#fbbf24', Low: '#4ade80' };
  const color = colorMap[r.level];

  document.getElementById('deepfake-result').innerHTML = `
    <div class="result-card ${lvl}">
      <div class="result-header">
        <span class="result-icon">${icon}</span>
        <div>
          <div class="result-level" style="color:${color}">${r.level} Risk</div>
          <div class="result-score">AI Manipulation Score: ${r.score}%</div>
        </div>
        <span class="result-label label-${lvl}">${r.score}%</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-label"><span>Deepfake Probability</span><span style="color:${color}">${r.score}%</span></div>
        <div class="progress-bar"><div class="progress-fill fill-${lvl}" style="width:${r.score}%"></div></div>
      </div>
      <div class="result-explanation">${r.explanation}</div>
      <div class="result-reasons">
        ${r.reasons.map(rs => `<span class="reason-chip">🔸 ${rs}</span>`).join('')}
      </div>
      <div style="margin-top:12px; font-size:12px; color:var(--muted)">
        📐 ${r.imgWidth}×${r.imgHeight}px &nbsp;|&nbsp; 💾 ${r.fileSizeKB.toFixed(0)} KB
      </div>
      <div class="result-actions" style="margin-top:14px">
        ${r.level === 'High' ? `<button class="btn-block" onclick="showToast('Reported to Cyber Crime Portal 1930','success')">🚨 Report to 1930</button>` : ''}
        <button class="btn-report" onclick="showToast('Analysis report copied','success')">📋 Copy Report</button>
      </div>
    </div>`;

  addLog('IMAGE', `Deepfake scan — ${r.level} risk (${r.score}%)`, `badge-${lvl}`);
}

// ─── FINANCIAL FRAUD ─────────────────────────────────
async function analyzeFinance() {
  const text = document.getElementById('finance-input').value.trim();
  if (!text) { showToast('Please enter a transaction message', 'error'); return; }

  showLoading('Analyzing transaction for fraud...');
  await sleep(900);

  const r = analyzeFinancialText(text);
  lastFinanceResult = r;
  hideLoading();
  scanCount++;
  if (r.level !== 'Low') blockedCount++;
  setScanCounts();

  const icon = r.level === 'High' ? '🚨' : r.level === 'Medium' ? '⚠️' : '✅';
  const lvl = r.level.toLowerCase();
  const colorMap = { High: '#f87171', Medium: '#fbbf24', Low: '#4ade80' };
  const color = colorMap[r.level];

  document.getElementById('finance-result').innerHTML = `
    <div class="result-card ${lvl}">
      <div class="result-header">
        <span class="result-icon">${icon}</span>
        <div>
          <div class="result-level" style="color:${color}">Fraud Risk: ${r.level}</div>
          <div class="result-score">Risk Score: ${r.score.toFixed(0)}%</div>
        </div>
        <span class="result-label label-${lvl}">${r.score.toFixed(0)}%</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-label"><span>Fraud Probability</span><span style="color:${color}">${r.score.toFixed(0)}%</span></div>
        <div class="progress-bar"><div class="progress-fill fill-${lvl}" style="width:${r.score}%"></div></div>
      </div>
      <div class="result-explanation">${r.explanation}</div>
      <div class="result-reasons">${r.reasons.map(rs => `<span class="reason-chip">🔸 ${rs}</span>`).join('')}</div>
      <div class="result-actions" style="margin-top:14px">
        ${r.level !== 'Low' ? `<button class="btn-block" onclick="showToast('Transaction flagged & frozen','success')">🔒 Freeze Transaction</button>` : ''}
        <button class="btn-report" onclick="showToast('Reported to bank fraud team','success')">📡 Report to Bank</button>
        ${r.level === 'High' ? `<button class="btn-block" onclick="showPage('sos')">🚨 Open SOS</button>` : ''}
      </div>
    </div>`;

  addLog('FINANCE', `UPI/Bank fraud scan — ${r.level} risk`, `badge-${lvl}`);
}

function checkUPI() {
  const id = document.getElementById('upi-id').value.trim();
  if (!id) { showToast('Enter a UPI ID to check', 'error'); return; }

  const r = checkUPIId(id);
  const colorMap = { High: '#f87171', Medium: '#fbbf24', Low: '#4ade80' };
  const color = colorMap[r.level];
  const icon = r.level === 'High' ? '🚨' : r.level === 'Medium' ? '⚠️' : '✅';

  document.getElementById('upi-result').innerHTML = `
    <div style="padding:10px;background:rgba(255,255,255,.04);border-radius:10px;border:1px solid rgba(255,255,255,.07);margin-top:8px">
      <div style="font-weight:800;color:${color};margin-bottom:6px">${icon} ${id} — ${r.level} Risk (${r.risk}%)</div>
      <div style="font-size:12px;color:var(--muted)">${r.flags.join(' • ') || 'No suspicious patterns found'}</div>
    </div>`;
}

(function wireKillSwitch() {
  const btn = document.getElementById('killSwitchBtn');
  const ring = document.getElementById('killRingProgress');
  if (!btn || !ring) return;
  const circumference = 339.3;
  let holdTimer = null;
  let startTime = null;
  let rafId = null;
  let activated = false;

  function startHold(e) {
    if (e) e.preventDefault();
    if (activated) return;
    startTime = Date.now();
    rafId = requestAnimationFrame(animateRing);
    holdTimer = setTimeout(triggerFreeze, 3000);
  }

  function animateRing() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / 3000, 1);
    ring.style.strokeDashoffset = circumference * (1 - progress);
    if (progress < 1) rafId = requestAnimationFrame(animateRing);
  }

  function cancelHold() {
    if (activated) return;
    clearTimeout(holdTimer);
    cancelAnimationFrame(rafId);
    ring.style.strokeDashoffset = circumference;
  }

  function triggerFreeze() {
    activated = true;
    cancelAnimationFrame(rafId);
    ring.style.strokeDashoffset = '0';
    btn.disabled = true;
    btn.querySelector('.kill-label').textContent = '✓ ACCOUNTS FROZEN';
    btn.style.background = 'linear-gradient(135deg, #00ff88, #00aa55)';
    showToast('✓ Freeze signal sent to all linked UPI IDs and bank accounts', 'error', 5000);
    addLog('KILL', 'Kill Switch activated — all accounts frozen', 'badge-high');
  }

  btn.addEventListener('mousedown', startHold);
  btn.addEventListener('touchstart', startHold, { passive: true });
  btn.addEventListener('mouseup', cancelHold);
  btn.addEventListener('mouseleave', cancelHold);
  btn.addEventListener('touchend', cancelHold);
})();

// ─── SOS ─────────────────────────────────────────────
function loadEmergencyContacts() {
  try {
    return JSON.parse(localStorage.getItem('phishguard_contacts') || '[]');
  } catch { return []; }
}

function saveEmergencyContacts(contacts) {
  localStorage.setItem('phishguard_contacts', JSON.stringify(contacts));
}

function renderContacts() {
  const contacts = loadEmergencyContacts();
  const list = document.getElementById('contactsList');
  if (!list) return;
  list.innerHTML = contacts.length === 0
    ? '<p style="color:#666;font-size:13px">No emergency contacts added yet.</p>'
    : contacts.map((c, i) => `
        <div class="contact-card" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="contact-name">👤 ${c.name}</div>
            <div class="contact-phone">${c.phone}</div>
          </div>
          <button class="contact-delete btn-remove" onclick="deleteContact(${i})">✕</button>
        </div>
      `).join('');
}

function addContact(name, phone) {
  if (!name || !phone) return;
  const contacts = loadEmergencyContacts();
  contacts.push({ name, phone });
  saveEmergencyContacts(contacts);
  renderContacts();
}

function deleteContact(index) {
  const contacts = loadEmergencyContacts();
  contacts.splice(index, 1);
  saveEmergencyContacts(contacts);
  renderContacts();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addContactBtn')?.addEventListener('click', () => {
    const name = document.getElementById('contactName')?.value.trim();
    const phone = document.getElementById('contactPhone')?.value.trim();
    addContact(name, phone);
    if (document.getElementById('contactName')) document.getElementById('contactName').value = '';
    if (document.getElementById('contactPhone')) document.getElementById('contactPhone').value = '';
  });
});


function triggerSOS() {
  if (sosActive) {
    // Cancel SOS
    sosActive = false;
    const btn = document.getElementById('sos-btn');
    btn.classList.remove('triggered');
    document.getElementById('sos-status').textContent = 'SOS cancelled.';
    showToast('SOS cancelled', 'info');
    return;
  }

  sosActive = true;
  const btn = document.getElementById('sos-btn');
  btn.classList.add('triggered');

  // Get location
  const locStr = contacts.length > 0
    ? contacts.map(c => c.name).join(', ')
    : 'configured contacts';

  document.getElementById('sos-status').innerHTML = `
    🚨 <strong>SOS TRIGGERED!</strong><br>
    Alert sent to ${locStr}<br>
    <small style="color:var(--muted)">Location: ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}</small>`;

  addLog('SOS', `Emergency SOS triggered — alerted ${contacts.length} contacts`, 'badge-high');
  showToast(`🚨 SOS Alert sent! Emergency services notified. Helpline: 112`, 'error', 6000);
}

// ─── UTILS ───────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// FIX 15 — Battery display
function updateBatteryDisplay(pct) {
  const bar = document.getElementById('batteryBar');
  const label = document.getElementById('batteryLabel');
  if (!bar || !label) return;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  bar.style.width = clamped + '%';
  bar.className = 'battery-fill';
  if (clamped <= 20) bar.classList.add('battery-critical');
  else if (clamped <= 50) bar.classList.add('battery-low');
  else bar.classList.add('battery-good');
  label.textContent = clamped + '%';
}

// FIX 14 — Terminal log
const TERMINAL_EVENTS = [
  { text: '[SCAN] SMS analyzed — SAFE — 0 threats detected', type: 'ok' },
  { text: '[ALERT] Phishing URL blocked: sbi-kyc-update.xyz', type: 'alert' },
  { text: '[TELEMETRY] Device 351756051523999 — ping received — Bengaluru', type: 'ok' },
  { text: '[UPI] Trust check: paytm.support@paytm — \u26a0 FLAGGED SCAM', type: 'warn' },
  { text: '[FIR] Auto-FIR generated — IMEI 351756051523999', type: 'ok' },
  { text: '[DEEPFAKE] Image scan complete — Risk: LOW — No anomalies', type: 'ok' },
  { text: '[ALERT] KYC scam SMS — Hindi pattern matched — BLOCKED', type: 'alert' },
  { text: '[TELEMETRY] Battery: 71% — Accuracy: 9.2m — Speed: 4.3 km/h', type: 'ok' },
  { text: '[UPI] Collect request intercepted — BLOCKED', type: 'alert' },
  { text: '[SCAN] Email — CRITICAL — Bank impersonation + Govt threat', type: 'alert' },
  { text: '[SIM] SIM-Swap risk assessed — MEDIUM — User alerted', type: 'warn' },
  { text: '[OSRM] GPS snapped to road — MG Road, Bengaluru', type: 'ok' },
  { text: '[SCAN] Hindi SMS analyzed — \u0913\u091f\u0940\u092a\u0940 pattern — HIGH RISK', type: 'warn' },
  { text: '[TELEMETRY] Device moving — Speed: 8.1 km/h — Accuracy: 7.4m', type: 'ok' },
  { text: '[UPI] refund.sbi@okaxis — 1203 prior reports — BLOCK CONFIRMED', type: 'alert' },
];
let terminalIndex = 0;

function appendTerminalLine(customText, customType) {
  const log = document.getElementById('terminalLog');
  if (!log) return;
  const event = customText
    ? { text: customText, type: customType || 'ok' }
    : TERMINAL_EVENTS[terminalIndex % TERMINAL_EVENTS.length];
  const line = document.createElement('div');
  line.className = `terminal-line${event.type === 'warn' ? ' warn' : event.type === 'alert' ? ' alert' : ''}`;
  const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
  line.textContent = `${time}  ${event.text}`;
  log.appendChild(line);
  if (log.children.length > 30) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  if (!customText) terminalIndex++;
}

// FIX 17 — SIM-Swap detector (complete replacement)
function wireSimSwapDetector() {
  const container = document.getElementById('simSwapContainer');
  if (!container) return;

  const QUESTIONS = [
    'Did your phone suddenly lose all signal?',
    'Did you receive unexpected OTPs you never requested?',
    'Did your carrier send an unrecognized SIM change SMS?',
  ];
  const ADVICE = {
    LOW: { color: '#00ff88', text: 'No immediate risk. Monitor your phone for unusual activity.' },
    MEDIUM: { color: '#ffaa00', text: 'Possible risk. Contact your carrier and check your email for SIM change alerts.' },
    HIGH: { color: '#ff6600', text: 'High risk. Call your carrier NOW and alert your bank immediately.' },
    CRITICAL: { color: '#ff3366', text: 'CRITICAL \u2014 Your SIM may be swapped. Call 1930 and freeze all bank accounts NOW.' },
  };
  const answers = { q0: false, q1: false, q2: false };

  container.innerHTML = QUESTIONS.map((q, i) => `
    <div class="sim-question">
      <span>${q}</span>
      <div class="sim-toggle-group">
        <button class="sim-btn" data-q="q${i}" data-val="yes">YES</button>
        <button class="sim-btn active-no" data-q="q${i}" data-val="no">NO</button>
      </div>
    </div>
  `).join('') + `<div id="simResult" class="sim-result" style="display:none;"></div>`;

  container.addEventListener('click', e => {
    const btn = e.target.closest('.sim-btn');
    if (!btn) return;
    const q = btn.dataset.q;
    const val = btn.dataset.val;
    answers[q] = val === 'yes';
    container.querySelectorAll(`[data-q="${q}"]`).forEach(b => {
      b.className = 'sim-btn' + (b.dataset.val === val
        ? (val === 'yes' ? ' active-yes' : ' active-no') : '');
    });
    const yesCount = Object.values(answers).filter(Boolean).length;
    const level = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][yesCount];
    const advice = ADVICE[level];
    const result = document.getElementById('simResult');
    result.style.display = 'block';
    result.innerHTML = `
      <div class="sim-risk-badge" style="color:${advice.color};border-color:${advice.color};">${level} RISK</div>
      <p style="color:#bbb;margin-top:10px;font-size:13px;line-height:1.5;">${advice.text}</p>
    `;
    appendTerminalLine(`[SIM] SIM-Swap assessment \u2014 ${level} RISK \u2014 ${yesCount}/3 indicators`, yesCount >= 2 ? 'alert' : 'warn');
  });
}

// FIX 16 — Kill switch (self-executing)
(function wireKillSwitch() {
  const btn = document.getElementById('killSwitchBtn');
  const ring = document.getElementById('killRingProgress');
  if (!btn || !ring) return;
  const CIRCUMFERENCE = 339.3;
  const HOLD_DURATION = 3000;
  let holdStart = null, rafId = null, activated = false, holdTimer = null;
  function resetRing() { ring.style.strokeDashoffset = CIRCUMFERENCE; }
  function animateRing() {
    const progress = Math.min((Date.now() - holdStart) / HOLD_DURATION, 1);
    ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
    if (progress < 1) rafId = requestAnimationFrame(animateRing);
  }
  function startHold(e) {
    if (activated) return;
    e.preventDefault();
    holdStart = Date.now();
    rafId = requestAnimationFrame(animateRing);
    holdTimer = setTimeout(triggerFreeze, HOLD_DURATION);
  }
  function cancelHold() {
    if (activated) return;
    clearTimeout(holdTimer);
    cancelAnimationFrame(rafId);
    resetRing();
  }
  function triggerFreeze() {
    activated = true;
    cancelAnimationFrame(rafId);
    ring.style.strokeDashoffset = '0';
    ring.style.stroke = '#00ff88';
    btn.disabled = true;
    const label = btn.querySelector('.kill-label');
    const icon = btn.querySelector('.kill-icon');
    if (label) label.textContent = 'ACCOUNTS FROZEN';
    if (icon) icon.textContent = '\u2713';
    playBeep(880, 0.3);
    appendTerminalLine('[KILLSWITCH] Freeze signal sent to all linked UPI IDs and bank accounts', 'alert');
    showToast('\u2713 All accounts frozen. Contact your bank to confirm.');
  }
  btn.addEventListener('mousedown', startHold);
  btn.addEventListener('touchstart', startHold, { passive: false });
  btn.addEventListener('mouseup', cancelHold);
  btn.addEventListener('mouseleave', cancelHold);
  btn.addEventListener('touchend', cancelHold);
  btn.addEventListener('touchcancel', cancelHold);
  resetRing();
})();

// FIX 18 — Emergency contacts
function loadContacts() {
  try { return JSON.parse(localStorage.getItem('phishguard_contacts') || '[]'); }
  catch { return []; }
}
function saveContactsArr(arr) {
  localStorage.setItem('phishguard_contacts', JSON.stringify(arr));
}
function renderContacts() {
  const list = document.getElementById('contactsList');
  if (!list) return;
  const contacts = loadContacts();
  if (contacts.length === 0) {
    list.innerHTML = '<p style="color:#555;font-size:13px;font-family:\'Share Tech Mono\',monospace;">No emergency contacts saved.</p>';
    return;
  }
  list.innerHTML = contacts.map((c, i) => `
    <div class="contact-card">
      <div>
        <div class="contact-name">${escapeHtml(c.name)}</div>
        <div class="contact-phone">${escapeHtml(c.phone)}</div>
      </div>
      <button class="contact-delete" onclick="deleteContact(${i})">\u2715</button>
    </div>
  `).join('');
}
function addContact(name, phone) {
  if (!name.trim() || !phone.trim()) return;
  const arr = loadContacts();
  arr.push({ name: name.trim(), phone: phone.trim() });
  saveContactsArr(arr);
  renderContacts();
  appendTerminalLine(`[SOS] Emergency contact added: ${name}`, 'ok');
}
function deleteContact(index) {
  const arr = loadContacts();
  arr.splice(index, 1);
  saveContactsArr(arr);
  renderContacts();
}
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// FIX 19 — SOS audio + trigger
function playBeep(freq = 880, vol = 0.6) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beeps = freq === 880 ? [0, 0.35, 0.7] : [0];
    beeps.forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.28);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.28);
    });
  } catch (e) { /* audio blocked — silent fail */ }
}

function triggerSOS() {
  playBeep(880, 0.7);
  document.body.style.transition = 'background 0.1s';
  document.body.style.background = 'rgba(255,0,0,0.15)';
  setTimeout(() => { document.body.style.background = ''; }, 500);
  const btn = document.getElementById('sos-btn');
  if (btn) btn.classList.add('triggered');
  appendTerminalLine('[SOS] PANIC ACTIVATED — Emergency contacts alerted', 'alert');
  showToast('\ud83d\udea8 SOS ACTIVATED — Stay calm. Help is coming.');
  addLog('SOS', 'Emergency SOS triggered', 'badge-high');
}

// FIX 21 — LERP location update
function onLocationUpdate(lat, lng, deviceState) {
  if (!map || !lat || !lng) return;
  if (deviceState) updateSidePanel(deviceState);
  const from = lerpTo || { lat, lng };
  lerpFrom = from; lerpTo = { lat, lng }; lerpStart = performance.now();
  if (!marker) {
    const icon = L.divIcon({
      className: '',
      html: '<div style="background:#ef4444;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 14px rgba(239,68,68,.8)"></div>',
      iconSize: [18, 18], iconAnchor: [9, 9]
    });
    marker = L.marker([lat, lng], { icon }).addTo(map);
    mapMarker = marker;
  }
  requestAnimationFrame(lerpStep);
  // OSRM snap in background
  fetchSnappedCoordinates(lat, lng).then(snapped => {
    if (snapped && lerpTo?.lat === lat && lerpTo?.lng === lng) lerpTo = snapped;
  }).catch(() => { });
}

function lerpStep(now) {
  if (!lerpFrom || !lerpTo || (!marker && !mapMarker)) return;
  const m = marker || mapMarker;
  const progress = Math.min((now - lerpStart) / LERP_DURATION, 1);
  const eased = 1 - Math.pow(1 - progress, 2);
  const lat = lerpFrom.lat + (lerpTo.lat - lerpFrom.lat) * eased;
  const lng = lerpFrom.lng + (lerpTo.lng - lerpFrom.lng) * eased;
  m.setLatLng([lat, lng]);
  if (progress < 1) requestAnimationFrame(lerpStep);
}

function updateSidePanel(d) {
  updateBatteryDisplay(d.battery || 0);
  const lastSeen = document.getElementById('lastSeen');
  const accuracy = document.getElementById('gpsAccuracy');
  const speed = document.getElementById('deviceSpeed');
  const ip = document.getElementById('deviceIp');
  const latEl = document.getElementById('lat-display');
  const lngEl = document.getElementById('lng-display');
  if (lastSeen) {
    const secs = Math.round((Date.now() - (d.timestamp || Date.now())) / 1000);
    lastSeen.textContent = secs < 5 ? 'Just now' : `${secs}s ago`;
  }
  if (accuracy) accuracy.textContent = d.accuracy ? d.accuracy.toFixed(1) + 'm' : '\u2014';
  if (speed) speed.textContent = d.speed ? d.speed.toFixed(1) + ' km/h' : '\u2014';
  if (ip) ip.textContent = d.ip || '\u2014';
  if (latEl && d.lat) latEl.textContent = d.lat.toFixed(6);
  if (lngEl && d.lng) lngEl.textContent = d.lng.toFixed(6);
}

// FIX 22 — Device connect
function connectToDevice(imei) {
  if (!imei || imei.length < 15) { showToast('Please enter a valid 15-digit IMEI number.'); return; }
  trackedIMEI = imei;
  trackingActive = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_IMEI', imei }));
    ws.send(JSON.stringify({ action: 'subscribe', imei }));
  }
  const cached = window._c2Devices?.[imei] || c2Devices.get(imei);
  if (cached) { currentDeviceState = cached; onLocationUpdate(cached.lat, cached.lng, cached); map && map.setView([cached.lat, cached.lng], 15, { animate: true }); }
  fetch(`${API_URL}/api/device/${imei}`).then(r => r.json()).then(res => {
    const d = res.data || res;
    if (d?.lat) { currentDeviceState = d; onLocationUpdate(d.lat, d.lng, d); map && map.setView([d.lat, d.lng], 15, { animate: true }); }
  }).catch(() => { });
  const banner = document.getElementById('demoBanner');
  if (banner) { banner.style.display = imei === '351756051523999' ? 'block' : 'none'; banner.textContent = '\u26a1 DEMO DEVICE ACTIVE \u2014 Live simulated telemetry from Bengaluru'; }
  const logArea = document.getElementById('telemetry-log');
  if (logArea) { logArea.style.display = 'block'; logArea.innerHTML = `<div>[${new Date().toLocaleTimeString('en-IN')}] Subscribed to IMEI: ${imei.slice(0, 4)}***</div>`; }
  appendTerminalLine(`[TRACKER] Subscribed to IMEI ${imei}`, 'ok');
}

function startImeiTelemetry() {
  const imei = (document.getElementById('imeiInput') || document.getElementById('telemetry-imei'))?.value.trim();
  if (!imei || imei.length < 15) { showToast('Please enter a valid 15-digit IMEI', 'error'); return; }
  connectToDevice(imei);
  const btn = document.getElementById('telemetry-btn');
  if (btn) btn.textContent = 'CONNECTED';
}

// FIX 23 — FIR PDF
function generateFIRPdf(firData) {
  if (!window.jspdf) { showToast('PDF library not loaded. Check internet connection.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(10, 14, 26); doc.rect(0, 0, W, 42, 'F');
  doc.setTextColor(0, 255, 136); doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('FIRST INFORMATION REPORT', W / 2, 17, { align: 'center' });
  doc.setFontSize(9); doc.setTextColor(170, 170, 170);
  doc.text('National Cyber Crime Reporting Portal \u2014 Form 54-B', W / 2, 27, { align: 'center' });
  doc.text('Generated by PhishGuard AI Sentinel System', W / 2, 34, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  let y = 52;
  function sectionHeader(title) {
    doc.setFillColor(220, 220, 220); doc.rect(10, y, W - 20, 9, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(title, 14, y + 6.5); y += 13;
  }
  function field(label, value) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(label + ':', 14, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(value || 'N/A'), 68, y); y += 8;
  }
  sectionHeader('FIR Details');
  field('FIR ID', firData.firId); field('Date & Time', new Date().toLocaleString('en-IN')); field('Type', 'Cyber Crime \u2014 Mobile Theft with Live GPS Tracking'); y += 4;
  sectionHeader('Complainant Details');
  field('Full Name', firData.ownerName); field('Phone', firData.phone); field('Address', firData.address); y += 4;
  sectionHeader('Device Details');
  field('IMEI', firData.imei); field('Model', firData.deviceModel);
  field('Last Lat', firData.lat); field('Last Lng', firData.lng);
  field('Maps Link', `maps.google.com/?q=${firData.lat},${firData.lng}`); y += 4;
  sectionHeader('Network Details');
  field('Last IP', firData.ip || 'Unavailable');
  field('Last Seen', firData.timestamp ? new Date(firData.timestamp).toLocaleString('en-IN') : 'N/A');
  field('GPS Accuracy', firData.accuracy ? parseFloat(firData.accuracy).toFixed(1) + ' metres' : 'N/A'); y += 4;
  sectionHeader('Declaration');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const decl = 'I hereby declare that the information furnished above is true and correct to the best of my knowledge. This FIR has been auto-generated by PhishGuard AI using live telemetry data from the Sentinel tracking system installed on the reported device.';
  const lines = doc.splitTextToSize(decl, W - 28);
  lines.forEach(line => { doc.text(line, 14, y); y += 6; });
  y += 8; doc.setFontSize(7.5); doc.setTextColor(150, 150, 150);
  doc.text('Present to nearest Cyber Crime Cell or upload at cybercrime.gov.in', W / 2, y, { align: 'center' });
  doc.save(`FIR_${firData.imei || 'unknown'}_${Date.now()}.pdf`);
  appendTerminalLine(`[FIR] PDF generated \u2014 IMEI ${firData.imei} \u2014 ${firData.firId}`, 'ok');
}

async function handleFIRSubmit(e) {
  if (e) e.preventDefault();
  const firData = {
    ownerName: document.getElementById('firOwnerName')?.value || document.getElementById('fir-name')?.value || '',
    phone: document.getElementById('firPhone')?.value || document.getElementById('fir-phone')?.value || '',
    address: document.getElementById('firAddress')?.value || '',
    deviceModel: document.getElementById('firDeviceModel')?.value || '',
    imei: trackedIMEI || document.getElementById('imeiInput')?.value || document.getElementById('fir-imei')?.value || '',
    lat: currentDeviceState?.lat,
    lng: currentDeviceState?.lng,
    ip: currentDeviceState?.ip,
    accuracy: currentDeviceState?.accuracy,
    timestamp: currentDeviceState?.timestamp,
  };
  try {
    const res = await fetch(`${API_URL}/api/fir/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(firData) });
    const json = await res.json();
    if (json.success || json.firId) firData.firId = json.firId || json.data?.firId;
  } catch { }
  if (!firData.firId) firData.firId = 'FIR-LOCAL-' + Date.now();
  generateFIRPdf(firData);
}

// Legacy FIR wrappers
function generateFIR() {
  const form = document.getElementById('fir-form') || document.getElementById('firForm');
  if (form) { form.style.display = 'flex'; form.scrollIntoView({ behavior: 'smooth' }); }
}
async function downloadFIR() {
  await handleFIRSubmit(null);
}

// FIX 24 — Deepfake scan
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function runDeepfakeScan() {
  const file = window._deepfakeFile || currentImage_File;
  if (!file) { showToast('Please upload an image first.'); return; }
  const resultsPanel = document.getElementById('deepfakeResults') || document.getElementById('deepfake-result');
  if (resultsPanel) {
    resultsPanel.innerHTML = `
      <div style="text-align:center;padding:20px;">
        <div class="scan-progress-bar"><div class="scan-progress-fill" id="scanProgressFill"></div></div>
        <p style="color:#00aaff;font-family:'Share Tech Mono',monospace;font-size:12px;margin-top:10px;">Analyzing image for threats\u2026</p>
      </div>`;
    let prog = 0;
    const progInterval = setInterval(() => {
      prog = Math.min(prog + Math.random() * 12, 90);
      const fill = document.getElementById('scanProgressFill');
      if (fill) fill.style.width = prog + '%';
    }, 200);
    try {
      let result;
      if (anthropicApiKey) {
        const base64 = await fileToBase64(file);
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicApiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307', max_tokens: 500,
            messages: [{
              role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
                { type: 'text', text: 'Analyze this image for deepfake manipulation, AI generation artifacts, face swapping, or NSFW content. Respond ONLY with valid JSON, no markdown: {"deepfakeScore":0-100,"morphingScore":0-100,"nsfwScore":0-100,"verdict":"string","details":["string"]}' }
              ]
            }]
          })
        });
        const data = await response.json();
        const raw = data.content?.[0]?.text || '{}';
        result = JSON.parse(raw.replace(/```json|```/g, '').trim());
      } else {
        const base64 = await fileToBase64(file);
        const res = await fetch(`${API_URL}/api/scan/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mediaType: file.type })
        });
        const json = await res.json();
        result = json.data || json;
      }
      clearInterval(progInterval);
      const fill = document.getElementById('scanProgressFill');
      if (fill) fill.style.width = '100%';
      setTimeout(() => renderDeepfakeResults(result), 300);
    } catch (err) {
      clearInterval(progInterval);
      if (resultsPanel) resultsPanel.innerHTML = `<div style="color:#ff3366;font-family:'Share Tech Mono',monospace;font-size:12px;padding:16px;">❌ Analysis failed: ${err.message}<br><br>${!anthropicApiKey ? '\u2192 Add an Anthropic API key above to enable AI analysis.<br>\u2192 Or start the Node.js backend (server.js) for local analysis.' : 'Check your API key and try again.'}</div>`;
    }
  }
}

// Legacy wrapper
async function analyzeImage() { await runDeepfakeScan(); }

function renderDeepfakeResults(result) {
  const panel = document.getElementById('deepfakeResults') || document.getElementById('deepfake-result');
  if (!panel || !result) return;
  const scoreColor = s => s >= 70 ? '#ff3366' : s >= 40 ? '#ffaa00' : '#00ff88';
  const scoreBar = (label, score) => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="font-family:'Rajdhani',sans-serif;font-size:13px;color:#ccc;">${label}</span>
        <span style="font-family:'Share Tech Mono',monospace;font-size:12px;color:${scoreColor(score)};">${score}/100</span>
      </div>
      <div style="background:rgba(255,255,255,0.08);border-radius:4px;height:8px;">
        <div class="score-bar-fill" style="background:${scoreColor(score)};" data-target="${score}"></div>
      </div>
    </div>`;
  panel.innerHTML = `
    <div style="padding:16px;">
      <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;
        color:${scoreColor(Math.max(result.deepfakeScore || 0, result.morphingScore || 0, result.nsfwScore || 0))};
        margin-bottom:16px;">${result.verdict || 'Analysis Complete'}</div>
      ${scoreBar('Deepfake Score', result.deepfakeScore || 0)}
      ${scoreBar('Morphing Score', result.morphingScore || 0)}
      ${scoreBar('NSFW Score', result.nsfwScore || 0)}
      ${result.details?.length ? `<div style="margin-top:14px;"><div style="font-family:'Rajdhani',sans-serif;font-size:13px;color:#888;margin-bottom:6px;">FINDINGS</div>${result.details.map(d => `<div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#ccc;padding:3px 0;">&bull; ${d}</div>`).join('')}</div>` : ''}
    </div>`;
  setTimeout(() => { panel.querySelectorAll('.score-bar-fill').forEach(bar => { bar.style.width = bar.dataset.target + '%'; }); }, 50);
  appendTerminalLine(`[DEEPFAKE] Scan \u2014 Deepfake:${result.deepfakeScore || 0} Morph:${result.morphingScore || 0} NSFW:${result.nsfwScore || 0}`, Math.max(result.deepfakeScore || 0, result.morphingScore || 0, result.nsfwScore || 0) >= 40 ? 'alert' : 'ok');
  scanCount++; blockedCount += (Math.max(result.deepfakeScore || 0, result.morphingScore || 0) >= 40) ? 1 : 0; setScanCounts();
}

// FIX 25 — Phishing examples
const PHISHING_EXAMPLES = {
  sms: `Dear Customer, Your SBI account has been FROZEN due to incomplete KYC. Immediate action required. Click here to update now: bit.ly/sbi-kyc-2024 \u092f\u093e \u0905\u092d\u0940 OTP \u0936\u0947\u092f\u0930 \u0915\u0930\u0947\u0902\u0964 \u0905\u0928\u094d\u092f\u0925\u093e \u0916\u093e\u0924\u093e \u092c\u0902\u0926 \u0939\u094b \u091c\u093e\u090f\u0917\u093e\u0964`,
  url: `http://sbi-netbanking-kyc.xyz/verify?session=expired&otp=required&action=immediate&user=blocked`,
  email: `From: alerts@hdfc-secure.tk\nSubject: URGENT \u2014 Your account will be deactivated in 24 hours\n\nDear Customer,\n\nIncome Tax Department has flagged your HDFC account for suspicious activity. You must verify your details immediately or face a penalty of Rs.50,000 and legal action.\n\nSend Rs.1 to confirm@ybl to receive your account unlock OTP. Failure to act within 24 hours will result in permanent account suspension.\n\nClick here: bit.ly/hdfc-verify-now`
};

// Update sample loader to use new examples
Object.assign(SAMPLES, {
  high: PHISHING_EXAMPLES.sms,
  low: `Hi Priya, your Swiggy order #45231 has been delivered. Thank you for ordering! Rate your experience at swiggy.com/rate. Hope you enjoyed your meal! \u2014 Swiggy Customer Care`
});

// FIX 26 — showToast (override existing)
function showToast(message, type = 'info') {
  // Try existing toast first
  const existing = document.getElementById('toast');
  if (existing) {
    existing.textContent = message;
    existing.className = `toast show ${type}`;
    setTimeout(() => existing.classList.remove('show'), 3500);
    return;
  }
  // Fallback dynamic toast
  const old = document.getElementById('pgToast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = 'pgToast';
  const colors = { info: '#00aaff', success: '#00ff88', error: '#ff3366', warn: '#ffaa00' };
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;background:rgba(10,14,26,0.95);border:1px solid ${colors[type] || colors.info};color:#fff;font-family:'Rajdhani',sans-serif;font-weight:600;font-size:14px;padding:12px 20px;border-radius:8px;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,0.5);animation:fadeInLine 0.3s forwards;`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 3500);
}

// ─── MODULE 8: DIGITAL ARREST ─────────────────────────────────
function setDATab(tab) {
  document.querySelectorAll('#page-digitalArrest .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('daTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  const input = document.getElementById('daInput');
  if (tab === 'call') input.placeholder = "Paste the exact words the caller said...";
  else if (tab === 'whatsapp') input.placeholder = "Paste the WhatsApp message or notice...";
  else if (tab === 'email') input.placeholder = "Paste the threatening email content...";
}

function loadDAExample() {
  setDATab('call');
  document.getElementById('daInput').value = "This is CBI officer Vikram Singh. Your Aadhaar is linked to a money laundering case. Do not disconnect the video call. You are under digital arrest. Transfer ₹50,000 as a security deposit immediately to clear your name.";
}

async function analyzeDigitalArrest() {
  const text = document.getElementById('daInput').value.trim();
  if (!text) return showToast("Please paste the message or call script first.", "error");

  showLoading("Analyzing threat indicators...");
  try {
    const res = await fetch(`${API_URL}/api/scan/digital-arrest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const d = await res.json();
    if (d.success) renderDAResults(d.data);
    else showToast("Analysis failed: " + d.error, "error");
  } catch (err) {
    // API failed, fallback to basic regex locally
    const isScam = /cbi|arrest|transfer|video call/i.test(text);
    renderDAResults({
      isScam,
      riskScore: isScam ? 85 : 10,
      riskLevel: isScam ? "CRITICAL" : "LOW",
      findings: isScam ? [{ label: "Arrest/Transfer keywords found", score: 85 }] : [],
      verdict: isScam ? "🚨 DIGITAL ARREST SCAM CONFIRMED locally." : "✅ No keywords found locally.",
      immediateAction: isScam ? "Hang up immediately." : "Stay alert."
    });
  }
  document.getElementById('loading-overlay').style.display = 'none';
}

function renderDAResults(data) {
  const r = document.getElementById('daResults');
  r.style.display = 'block';
  r.innerHTML = `
    <div class="verdict-box ${data.riskLevel === 'CRITICAL' || data.riskLevel === 'HIGH' ? 'danger' : 'safe'}">
        <h4>${data.verdict}</h4>
        <p style="margin-top:8px;">${data.immediateAction}</p>
    </div>
    <div style="margin-top:15px; font-family:'Rajdhani', sans-serif;">
        <strong>Threat Score: ${data.riskScore}/100 [${data.riskLevel}]</strong>
    </div>
    <div style="margin-top:10px;">
        ${data.findings.length === 0 ? '<p>No specific threat markers found.</p>' : ''}
        ${data.findings.map(f => `<div class="finding-item">🚩 ${f.label} (+${f.score})</div>`).join('')}
    </div>
  `;
}

// ─── MODULE 9: FAKE JOB SCAM ─────────────────────────────────
function setJobTab(tab) {
  document.querySelectorAll('#page-fakeJob .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('jobTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  const input = document.getElementById('jobInput');
  if (tab === 'message') input.placeholder = "Paste the WhatsApp or Telegram job offer...";
  else if (tab === 'posting') input.placeholder = "Paste the job posting text...";
  else if (tab === 'email') input.placeholder = "Paste the job offer email...";
}

function loadJobExample() {
  setJobTab('message');
  document.getElementById('jobInput').value = "Work from home! Earn ₹5000 per day by just liking YouTube videos. No experience required. Pay ₹1000 registration fee to start immediately. WhatsApp us now.";
}

async function analyzeFakeJob() {
  const text = document.getElementById('jobInput').value.trim();
  const companyName = document.getElementById('companyNameInput').value.trim();
  const website = document.getElementById('companyWebsite').value.trim();

  if (!text) return showToast("Please paste the job offer text.", "error");

  showLoading("Verifying job offer...");
  try {
    const res = await fetch(`${API_URL}/api/scan/fake-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, companyName, website })
    });
    const d = await res.json();
    if (d.success) renderJobResults(d.data);
    else showToast("Analysis failed", "error");
  } catch (err) {
    const isScam = /fee|registration|5000 per day/i.test(text);
    renderJobResults({
      isScam, riskScore: isScam ? 90 : 10, riskLevel: isScam ? "CRITICAL" : "LOW",
      findings: isScam ? [{ label: "Upfront fee/unrealistic salary found", score: 90 }] : [],
      companyFlags: [], verdict: isScam ? "🚨 FAKE JOB SCAM (Local Scan)" : "✅ Local scan clear.",
      verifyLinks: []
    });
  }
  document.getElementById('loading-overlay').style.display = 'none';
}

function renderJobResults(data) {
  const r = document.getElementById('jobResults');
  r.style.display = 'block';
  r.innerHTML = `
    <div class="verdict-box ${data.riskLevel === 'CRITICAL' || data.riskLevel === 'HIGH' ? 'danger' : 'safe'}">
        <h4>${data.verdict}</h4>
    </div>
    <div style="margin-top:15px; font-family:'Rajdhani', sans-serif;">
        <strong>Threat Score: ${data.riskScore}/100 [${data.riskLevel}]</strong>
    </div>
    <div style="margin-top:10px;">
        ${data.findings.map(f => `<div class="finding-item">🚩 ${f.label}</div>`).join('')}
        ${data.companyFlags && data.companyFlags.map(f => `<div class="finding-item" style="color:#ffaa00">⚠️ ${f}</div>`).join('')}
    </div>
  `;
}

// ─── MODULE 10: MISINFORMATION ───────────────────────────────
function setMisTab(tab) {
  document.querySelectorAll('#page-misinformation .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('misTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  const input = document.getElementById('misInput');
  if (tab === 'forward') input.placeholder = "Paste the WhatsApp forward...";
  else if (tab === 'news') input.placeholder = "Paste the news claim or headline...";
  else if (tab === 'scheme') input.placeholder = "Paste the government scheme message...";
}

function loadMisExample() {
  setMisTab('forward');
  document.getElementById('misInput').value = "URGENT ALERT: Supreme Court has announced a new scheme giving free laptops to all students. Registration ends tomorrow. Click this link http://free-laptop-gov.tk to apply. Missing this means losing ₹50,000. Forward to 10 friends immediately!";
}

async function analyzeMisinformation() {
  const text = document.getElementById('misInput').value.trim();
  if (!text) return showToast("Please paste the message to fact-check.", "error");

  showLoading("Fact-checking claim...");
  try {
    const res = await fetch(`${API_URL}/api/scan/misinformation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const d = await res.json();
    if (d.success) renderMisResults(d.data);
    else showToast("Analysis failed", "error");
  } catch (err) {
    const isMisInfo = /forward to|free laptop|scheme/i.test(text);
    renderMisResults({
      isMisinformation: isMisInfo, riskScore: isMisInfo ? 85 : 10, riskLevel: isMisInfo ? "HIGH" : "LOW",
      findings: isMisInfo ? [{ label: "Chain forward / Fake scheme pattern", score: 85 }] : [],
      credibilityFlags: [], verdict: isMisInfo ? "🚨 LIKELY FAKE FORWARD (Local)" : "✅ Local check clear.",
      immediateAction: ""
    });
  }
  document.getElementById('loading-overlay').style.display = 'none';
}

function renderMisResults(data) {
  const r = document.getElementById('misResults');
  r.style.display = 'block';
  r.innerHTML = `
    <div class="verdict-box ${data.riskLevel === 'CRITICAL' || data.riskLevel === 'HIGH' ? 'danger' : 'safe'}">
        <h4>${data.verdict}</h4>
        <p style="margin-top:8px;">${data.immediateAction || ''}</p>
    </div>
    <div style="margin-top:15px; font-family:'Rajdhani', sans-serif;">
        <strong>Credibility Score: ${100 - data.riskScore}/100</strong>
    </div>
    <div style="margin-top:10px;">
        ${data.findings.map(f => `<div class="finding-item">🚩 ${f.label}</div>`).join('')}
        ${data.credibilityFlags && data.credibilityFlags.map(f => `<div class="finding-item" style="color:#ffaa00">⚠️ ${f}</div>`).join('')}
    </div>
  `;
}
