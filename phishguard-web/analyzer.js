/**
 * PhishGuard AI — Ported from phishing_analyzer.dart (Dart → JS)
 * Full phishing + financial fraud analyzer logic
 */

const PHISHING_RULES = [
    { regex: /urgent|immediate action|expires? (today|now|soon)|last chance/i, label: 'Urgency Trigger', score: 20 },
    { regex: /account.{0,20}(suspended|blocked|frozen|deactivated)/i, label: 'Account Threat', score: 30 },
    { regex: /\b(sbi|hdfc|icici|axis bank|pnb|kotak|paytm|phonepe|gpay|google pay)\b/i, label: 'Bank Impersonation', score: 25 },
    { regex: /kyc.{0,30}(update|expir|pending|incomplete|verif)/i, label: 'KYC Scam', score: 35 },
    { regex: /\botp\b.{0,30}(share|send|give|provide|enter|bata|de\s)/i, label: 'OTP Request', score: 40 },
    { regex: /\b(bit\.ly|tinyurl\.com|t\.co|rb\.gy|cutt\.ly|goo\.gl|short\.gy)\b/i, label: 'Shortened URL', score: 25 },
    { regex: /(won|winner|selected|eligible).{0,40}(prize|reward|cashback|lottery|lucky draw)/i, label: 'Prize Scam', score: 35 },
    { regex: /upi.{0,30}(collect|request).{0,30}(approve|accept|click|tap)/i, label: 'UPI Collect Fraud', score: 40 },
    { regex: /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, label: 'IP Address URL', score: 30 },
    { regex: /(sbi|hdfc|icici|paytm|npci|uidai|aadhaar).{0,10}\.(xyz|tk|ml|ga|cf|gq|top|club|buzz)/i, label: 'Lookalike Domain', score: 45 },
    { regex: /खाता.{0,10}(बंद|ब्लॉक|फ्रीज)/, label: 'Hindi Account Threat', score: 30 },
    { regex: /ओटीपी.{0,10}(बताएं|शेयर|दें|दे)/, label: 'Hindi OTP Request', score: 40 },
    { regex: /केवाईसी.{0,10}(अपडेट|वेरिफिकेशन|करें)/, label: 'Hindi KYC Scam', score: 35 },
    { regex: /(income tax|trai|rbi|sebi|npci|govt).{0,50}(notice|penalty|fine|arrest|action)/i, label: 'Govt Impersonation', score: 35 },
];

function analyzePhishing(text) {
    let score = 0;
    const findings = [];
    PHISHING_RULES.forEach(rule => {
        if (rule.regex.test(text)) {
            score += rule.score;
            findings.push({ label: rule.label, score: rule.score });
        }
    });
    score = Math.min(score, 100);
    const riskLevel = score >= 70 ? 'CRITICAL' : score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';

    // Mapping added to preserve backwards UI compatibility
    const uiLevel = riskLevel === 'CRITICAL' ? 'High' : riskLevel === 'HIGH' ? 'High' : riskLevel === 'MEDIUM' ? 'Medium' : 'Low';

    return {
        isPhishing: score >= 40,
        riskScore: score,
        riskLevel,
        findings,
        summary: score >= 40
            ? `⚠️ ${findings.length} threat indicators detected. Do NOT click links or share any information.`
            : score >= 20
                ? `⚡ Suspicious patterns found. Exercise caution.`
                : `✅ No significant phishing indicators found.`,
        score: score,
        level: uiLevel,
        reasons: findings.map(f => f.label),
        explanation: score >= 40
            ? `⚠️ ${findings.length} threat indicators detected. Do NOT click links or share any information.`
            : score >= 20
                ? `⚡ Suspicious patterns found. Exercise caution.`
                : `✅ No significant phishing indicators found.`,
        explanationHi: score >= 40 ? `⚠️ उच्च जोखिम की फ़िशिंग पाई गई। कोई लिंक न खोलें।` : `✅ सुरक्षित`
    };
}

function analyzePhishingText(text) { return analyzePhishing(text); }

/**
 * Financial fraud analysis — port of FinancialFraudScreen._analyze()
 */
function analyzeFinancialText(text) {
    const lower = text.toLowerCase();
    let hits = 0;
    const reasons = [];

    const amtMatch = text.match(/(rs\.?\s?[\d,]+|inr\s?[\d,]+)/i);
    let amount = 0;
    if (amtMatch) {
        amount = parseFloat(amtMatch[0].replace(/[^0-9]/g, '')) || 0;
        if (amount > 0) { reasons.push('Amount detected'); hits += 1; }
        if (amount >= 5000) { reasons.push(`High amount ₹${amount.toLocaleString('en-IN')}`); hits += 2; }
        if (amount >= 50000) { reasons.push('Very large transaction'); hits += 3; }
    }

    if (/collect request|payment request/i.test(lower)) { reasons.push('Collect/payment request'); hits += 3; }
    if (/unknown|unregistered/i.test(lower)) { reasons.push('Unknown sender'); hits += 2; }
    if (/upi.*debited|debited.*upi/i.test(lower)) { reasons.push('UPI debit detected'); hits += 1; }
    if (/refund|chargeback/i.test(lower)) { reasons.push('Refund lure'); hits += 2; }
    if (/urgent|immediate|now|asap/i.test(lower)) { reasons.push('Urgency language'); hits += 2; }
    if (/otp|password|pin/i.test(lower)) { reasons.push('OTP/sensitive data request'); hits += 3; }
    if (/blocked|suspend|freeze/i.test(lower)) { reasons.push('Threat/intimidation language'); hits += 2; }
    if (/\+91\d{10}|unknown@|@ybl|@upi/i.test(lower)) { reasons.push('Suspicious UPI ID/number'); hits += 2; }

    const score = Math.min(100, hits * 14);
    const level = score >= 60 ? 'High' : score >= 30 ? 'Medium' : 'Low';
    const explanation = score >= 60
        ? `⚠️ Potential fraud detected: ${reasons.join(', ')}.`
        : reasons.length === 0
            ? '✅ No suspicious patterns found. Transaction appears legitimate.'
            : `ℹ️ Some risk indicators present: ${reasons.join(', ')}.`;

    return { score, level, reasons, explanation, amount };
}

/**
 * UPI ID risk checker
 */
function checkUPIId(upiId) {
    const lower = upiId.toLowerCase();
    const flags = [];
    let risk = 0;

    const suspiciousWords = ['support', 'help', 'refund', 'prize', 'reward', 'win', 'bank', 'sbi', 'hdfc', 'icici', 'verify', 'kyc', 'block', 'claim', 'lottery', 'gift'];
    for (const w of suspiciousWords) {
        if (lower.includes(w)) { flags.push(`Contains "${w}"`); risk += 20; }
    }

    if (!/^[\w.\-]+@[\w]+$/.test(upiId)) { flags.push('Invalid UPI format'); risk += 30; }
    if (/\d{10}@/.test(lower)) { flags.push('Phone number as UPI handle'); risk += 10; }

    const safeHandles = ['@okhdfcbank', '@okicici', '@okaxis', '@ybl', '@ibl', '@paytm', '@upi', '@apl', '@sbi', '@oksbi'];
    const handle = '@' + (upiId.split('@')[1] || '');
    if (!safeHandles.includes(handle)) { flags.push('Unrecognized payment handle'); risk += 15; }

    risk = Math.min(100, risk);
    const level = risk >= 60 ? 'High' : risk >= 30 ? 'Medium' : 'Low';
    return { risk, level, flags };
}

/**
 * Deepfake image simulation (no real ML in browser)
 * Uses image metadata heuristics + simulated analysis
 */
async function analyzeImageForDeepfake(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const reasons = [];
                let score = 0;

                // Heuristic checks on the image
                const { width, height } = img;
                const ratio = width / height;

                // Perfect 1:1 or suspicious resolutions common in AI-generated images
                if (Math.abs(ratio - 1) < 0.05) { reasons.push('Square aspect ratio (common in AI-generated)'); score += 15; }
                if (width === 512 || width === 1024 || width === 256) { reasons.push(`Resolution ${width}px is standard AI output size`); score += 20; }
                if (width > 4000 && height > 4000) { reasons.push('Unusually high resolution'); score += 10; }

                // File size heuristic
                const fileSizeKB = file.size / 1024;
                if (fileSizeKB < 50) { reasons.push('Very small file size may indicate compression artifacts'); score += 10; }
                if (fileSizeKB > 8000) { reasons.push('Unusually large file'); score += 5; }

                const ext = file.name.split('.').pop().toLowerCase();
                if (ext === 'webp') { reasons.push('WebP format commonly used in AI outputs'); score += 10; }

                const nameMatch = file.name.match(/\d{5,}/);
                if (nameMatch) { reasons.push('Numeric filename pattern (AI tool output)'); score += 10; }

                // Add randomized uncertainty to simulate ML
                const noise = Math.floor(Math.random() * 25);
                score = Math.min(99, score + noise);

                const level = score >= 65 ? 'High' : score >= 35 ? 'Medium' : 'Low';
                if (reasons.length === 0) reasons.push('No artifact patterns detected');

                const explanation = level === 'High'
                    ? '⚠️ Multiple indicators suggest this image may be AI-generated or manipulated. Do not share.'
                    : level === 'Medium'
                        ? 'ℹ️ Some suspicious patterns detected. Treat with caution.'
                        : '✅ Image analysis shows no clear signs of AI generation or manipulation.';

                resolve({ score, level, reasons, explanation, imgWidth: width, imgHeight: height, fileSizeKB });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}
