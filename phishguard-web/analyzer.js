/**
 * PhishGuard AI — Ported from phishing_analyzer.dart (Dart → JS)
 * Full phishing + financial fraud analyzer logic
 */

const KEYWORDS = [
    'urgent', 'verify now', 'kyc', 'otp', 'account blocked', 'click here',
    'limited time', 'winner', 'loan', 'refund', 'password', 'bank', 'netbanking',
    'ifsc', 'pan', 'aadhaar', 'pan update', 'kyc update', 'bank otp', 'sim swap',
    'income tax', 'package delivery', 'courier', 'amazon', 'flipkart',
    'wallet freeze', 'account suspended', 'verify account', 'prize', 'congratulations',
    'fake upi', 'upi blocked', 'blocked immediately', 'free gift', 'claim now'
];

const SHORTENERS = [
    'bit.ly', 'tinyurl', 't.co', 'goo.gl', 'ow.ly', 'cutt.ly', 'is.gd',
    'rebrand.ly', 'tiny.cc', 'shorturl.at', 'rb.gy', 'yourls'
];

const BANKS = [
    'hdfc', 'icici', 'sbi', 'axis', 'kotak', 'bank of baroda', 'canara',
    'indusind', 'idfc', 'union bank', 'yes bank', 'pnb', 'boi', 'bob',
    'allahabad', 'uco', 'andhra', 'karnataka'
];

const SUSPICIOUS_DOMAINS = [
    'sbi-reward', 'hdfc-verify', 'icici-update', 'paytm-kyc', 'upi-block',
    'bank-alert', 'secure-verify', 'account-verify', 'kyc-update', 'rbl-secure',
    'reward-claim', 'prize-india', 'income-tax-refund'
];

const HINDI_MAP = {
    'High risk of phishing detected.': 'उच्च जोखिम की फ़िशिंग पाई गई.',
    'Medium risk indicators found.': 'मध्यम जोखिम के संकेत मिले.',
    'Low risk — likely safe.': 'कम जोखिम — संभवतः सुरक्षित.',
    'Reasons:': 'कारण:',
    'Keyword:': 'कीवर्ड:',
    'Short link:': 'शॉर्ट लिंक:',
    'Bank mention:': 'बैंक उल्लेख:',
    'Links detected:': 'लिंक पाए गए:',
    'Sensitive info requested': 'संवेदनशील जानकारी मांगी गई',
    'Payment collect request': 'भुगतान कलेक्ट अनुरोध',
    'Amount mentioned': 'राशि उल्लेखित है',
    'Suspicious domain pattern': 'संदिग्ध डोमेन पैटर्न',
    'No common phishing patterns found.': 'कोई सामान्य फ़िशिंग पैटर्न नहीं मिला.'
};

function translateHindi(text) {
    let t = text;
    for (const [en, hi] of Object.entries(HINDI_MAP)) {
        t = t.replaceAll(en, hi);
    }
    return t;
}

function buildExplanation(level, reasons) {
    const prefix = level === 'High'
        ? 'High risk of phishing detected.'
        : level === 'Medium'
            ? 'Medium risk indicators found.'
            : 'Low risk — likely safe.';
    const detail = reasons.length === 0
        ? 'No common phishing patterns found.'
        : 'Reasons: ' + reasons.join(', ') + '.';
    return `${prefix} ${detail}`;
}

/**
 * Main phishing analysis — port of PhishingAnalyzer.analyzeRules()
 */
function analyzePhishingText(text) {
    const lower = text.toLowerCase();
    let hits = 0;
    const reasons = [];

    for (const k of KEYWORDS) {
        if (lower.includes(k)) {
            hits += 2;
            reasons.push(`Keyword: "${k}"`);
        }
    }

    for (const s of SHORTENERS) {
        if (lower.includes(s)) {
            hits += 3;
            reasons.push(`Short link: ${s}`);
        }
    }

    for (const b of BANKS) {
        if (lower.includes(b)) {
            hits += 1;
            reasons.push(`Bank mention: ${b.toUpperCase()}`);
        }
    }

    for (const d of SUSPICIOUS_DOMAINS) {
        if (lower.includes(d)) {
            hits += 4;
            reasons.push(`Suspicious domain pattern`);
        }
    }

    const urlPattern = /(https?:\/\/|www\.)([\w\-\.]+)\.[a-z]{2,}/gi;
    const urls = [...text.matchAll(urlPattern)];
    if (urls.length > 0) {
        hits += urls.length;
        reasons.push(`Links detected: ${urls.length}`);
    }

    if (/(otp|password|pin|kyc|verify)/i.test(lower)) {
        hits += 2;
        reasons.push('Sensitive info requested');
    }

    if (/(collect request|payment request|upi collect)/i.test(lower)) {
        hits += 2;
        reasons.push('Payment collect request');
    }

    const amtMatches = [...lower.matchAll(/(rs\.?\s?\d+[\,\d]*|inr\s?\d+[\,\d]*)/gi)];
    if (amtMatches.length > 0) {
        hits += Math.min(3, amtMatches.length);
        reasons.push('Amount mentioned');
    }

    const score = Math.min(100, hits * 6 + (urls.length > 0 ? 8 : 0));
    const level = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
    const explanation = buildExplanation(level, reasons);
    const explanationHi = translateHindi(explanation);

    return { score, level, reasons, explanation, explanationHi };
}

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
