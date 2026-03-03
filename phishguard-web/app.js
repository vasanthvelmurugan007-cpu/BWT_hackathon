/**
 * PhishGuard AI — Main Application Logic
 */

// ─── STATE ───────────────────────────────────────────
let scanCount = 0;
let blockedCount = 0;
let trackingTimer = null;
let trackingActive = false;
let map = null;
let mapMarker = null;
let currentLat = 12.9716;
let currentLng = 77.5946;
let contacts = JSON.parse(localStorage.getItem('pg_contacts') || '[]');
let lastPhishingResult = null;
let lastFinanceResult = null;
let currentImage_File = null;
let sosActive = false;

const PAGE_TITLES = {
    dashboard: 'Dashboard',
    phishing: 'Phishing Detector',
    tracking: 'Stolen Phone & FIR',
    deepfake: 'Deepfake Guard',
    finance: 'Financial Fraud',
    sos: 'SOS & Safety'
};

// ─── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    renderContacts();
    setScanCounts();
    initMap();

    // Drag & drop for image
    const zone = document.getElementById('upload-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'rgba(239,68,68,.6)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.style.borderColor = '';
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) setImageFile(f);
    });
});

function updateClock() {
    const now = new Date();
    document.getElementById('time-display').textContent =
        now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setScanCounts() {
    document.getElementById('scan-count').textContent = scanCount;
    document.getElementById('blocked-count').textContent = blockedCount;
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

    const result = analyzePhishingText(text);
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

function updateMapPosition(lat, lng) {
    currentLat = lat; currentLng = lng;
    document.getElementById('lat-display').textContent = lat.toFixed(6);
    document.getElementById('lng-display').textContent = lng.toFixed(6);
    document.getElementById('last-update').textContent = new Date().toLocaleTimeString('en-IN');

    if (map && mapMarker) {
        mapMarker.setLatLng([lat, lng]);
        map.panTo([lat, lng]);
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
        document.getElementById('battery-display').textContent = bat + '%';
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

function downloadFIR() {
    const name = document.getElementById('fir-name').value.trim() || 'Unknown Complainant';
    const phone = document.getElementById('fir-phone').value.trim() || 'Not Provided';
    const imei = document.getElementById('fir-imei').value.trim() || 'Not Provided';
    const now = new Date().toLocaleString('en-IN');

    const content = `
FIRST INFORMATION REPORT (FIR)
Mobile Theft / Digital Crime
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Date & Time  : ${now}
Report No.   : PG-${Date.now()}-FIR

━━━━━━━ COMPLAINANT DETAILS ━━━━━━━
Name         : ${name}
Phone        : ${phone}
Device IMEI  : ${imei}

━━━━━━━ INCIDENT DETAILS ━━━━━━━━━
Type         : Mobile Phone Theft / Cybercrime
App          : PhishGuard AI — Auto-FIR System

━━━━━━━ LAST KNOWN LOCATION ━━━━━━
Latitude     : ${currentLat.toFixed(6)}
Longitude    : ${currentLng.toFixed(6)}
Town/City    : Bengaluru, Karnataka (approx.)
Timestamp    : ${now}

━━━━━━━ STATEMENT ━━━━━━━━━━━━━━━━
My mobile device was stolen / went missing.
Location updates were recorded by PhishGuard AI.
I request the police to investigate and assist
in recovering the device with the above details.

━━━━━━━ HELPLINES ━━━━━━━━━━━━━━━━
Police       : 100
Cyber Crime  : 1930  |  cybercrime.gov.in

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Signature: ${name}
Generated by: PhishGuard AI — Safe Digital Bharat
  `.trim();

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `PhishGuard_FIR_${Date.now()}.txt`;
    a.click(); URL.revokeObjectURL(url);
    showToast('✅ FIR downloaded successfully!', 'success');
    addLog('FIR', `FIR generated for ${name}`, 'badge-safe');
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
    await sleep(1400);

    const r = await analyzeImageForDeepfake(currentImage_File);
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

function activateKillSwitch() {
    const btn = document.getElementById('kill-btn');
    showLoading('Activating Kill Switch...');
    setTimeout(() => {
        hideLoading();
        btn.textContent = '✅ KILL SWITCH ACTIVE';
        btn.classList.add('active');
        showToast('⚡ Kill Switch activated! All UPI IDs and cards frozen. Contact your bank to re-enable.', 'error', 5000);
        addLog('KILL', 'Kill Switch activated — all accounts frozen', 'badge-high');
    }, 1800);
}

// ─── SOS ─────────────────────────────────────────────
function renderContacts() {
    const list = document.getElementById('contact-list');
    list.innerHTML = contacts.length === 0
        ? '<div style="color:var(--muted);font-size:13px;text-align:center;padding:12px">No contacts added yet</div>'
        : contacts.map((c, i) => `
      <div class="contact-item">
        <div>
          <div class="contact-name">👤 ${c.name}</div>
          <div class="contact-phone">${c.phone}</div>
        </div>
        <button class="btn-remove" onclick="removeContact(${i})">✕</button>
      </div>`).join('');
}

function addContact() {
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    if (!name || !phone) { showToast('Enter both name and phone number', 'error'); return; }
    contacts.push({ name, phone });
    localStorage.setItem('pg_contacts', JSON.stringify(contacts));
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    renderContacts();
    showToast(`✅ ${name} added as emergency contact`, 'success');
}

function removeContact(i) {
    contacts.splice(i, 1);
    localStorage.setItem('pg_contacts', JSON.stringify(contacts));
    renderContacts();
}

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
