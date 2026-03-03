import 'dart:math';
import '../models/phishing_result.dart';
import 'package:tflite_flutter/tflite_flutter.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

class PhishingAnalyzer {
  static Interpreter? _interpreter;
  static List<String>? _labels;
  static bool _aiReady = false;

  static Future<void> ensureInitialized() async {
    if (_aiReady) return;
    try {
      if (kIsWeb) {
        _aiReady = false;
        return;
      }
      _interpreter = await Interpreter.fromAsset('models/phishing_model.tflite');
      try {
        final raw = await rootBundle.loadString('assets/models/labels.txt');
        _labels = raw.split('\n').where((e) => e.trim().isNotEmpty).toList();
      } catch (_) {}
      _aiReady = true;
    } catch (_) {
      _aiReady = false;
    }
  }
  static final List<String> keywords = [
    'urgent',
    'verify now',
    'kyc',
    'otp',
    'upi',
    'fake upi',
    'account blocked',
    'click here',
    'limited time',
    'winner',
    'loan',
    'refund',
    'password',
    'bank',
    'netbanking',
    'ifsc',
    'pan',
    'aadhaar',
    'pan update',
    'kyc update',
    'bank otp',
    'sim swap',
    'income tax',
    'package delivery',
    'courier',
    'amazon',
    'flipkart',
    'wallet freeze',
    'account suspended',
    'verify account',
  ];

  static final List<String> shorteners = [
    'bit.ly',
    'tinyurl',
    't.co',
    'goo.gl',
    'ow.ly',
    'cutt.ly',
    'is.gd',
    'rebrand.ly',
  ];

  static final List<String> banks = [
    'hdfc',
    'icici',
    'sbi',
    'axis',
    'kotak',
    'bank of baroda',
    'canara',
    'indusind',
    'idfc',
    'union bank',
    'yes bank',
  ];

  static PhishingResult analyzeRules(String text) {
    final lower = text.toLowerCase();
    int hits = 0;
    final reasons = <String>[];

    for (final k in keywords) {
      if (lower.contains(k)) {
        hits += 2;
        reasons.add('Keyword: $k');
      }
    }

    for (final s in shorteners) {
      if (lower.contains(s)) {
        hits += 3;
        reasons.add('Short link: $s');
      }
    }

    for (final b in banks) {
      if (lower.contains(b)) {
        hits += 1;
        reasons.add('Bank mention: $b');
      }
    }

    final urlPattern = RegExp(r'(https?:\/\/|www\.)[\w\-\.]+\.[a-z]{2,}');
    final urls = urlPattern.allMatches(text).map((m) => m.group(0) ?? '').toList();
    if (urls.isNotEmpty) {
      hits += urls.length;
      reasons.add('Links detected: ${urls.length}');
    }

    final askSensitive = RegExp(r'(otp|password|pin|kyc|verify)');
    if (askSensitive.hasMatch(lower)) {
      hits += 2;
      reasons.add('Sensitive info requested');
    }

    final collectReq = RegExp(r'(collect request|payment request|upi collect)');
    if (collectReq.hasMatch(lower)) {
      hits += 2;
      reasons.add('Payment collect request');
    }

    final amountMatch = RegExp(r'(rs\.?\s?\d+[\,\d]*|inr\s?\d+[\,\d]*)', caseSensitive: false).allMatches(text);
    if (amountMatch.isNotEmpty) {
      hits += min(3, amountMatch.length);
      reasons.add('Amount mentioned');
    }

    double score = min(100, hits * 6.0 + (urls.length > 0 ? 8 : 0));
    String level;
    if (score >= 70) {
      level = 'High';
    } else if (score >= 40) {
      level = 'Medium';
    } else {
      level = 'Low';
    }

    final explanation = _buildExplanation(level, reasons);
    final explanationHi = _translateHi(explanation);

    return PhishingResult(
      score: score,
      level: level,
      reasons: reasons,
      explanation: explanation,
      explanationHi: explanationHi,
      aiUsed: false,
    );
  }

  static Future<PhishingResult> analyzeHybrid(String text) async {
    final base = analyzeRules(text);
    await ensureInitialized();
    double? aiScore;
    if (_aiReady && _interpreter != null) {
      try {
        aiScore = _runInference(text);
      } catch (_) {
        aiScore = null;
      }
    }
    final combinedScore = aiScore != null ? max(base.score, aiScore) : base.score;
    String level;
    if (combinedScore >= 70) {
      level = 'High';
    } else if (combinedScore >= 40) {
      level = 'Medium';
    } else {
      level = 'Low';
    }
    final explanation = _buildExplanation(level, base.reasons);
    final explanationHi = _translateHi(explanation);
    return PhishingResult(
      score: combinedScore,
      level: level,
      reasons: base.reasons,
      explanation: explanation,
      explanationHi: explanationHi,
      aiUsed: aiScore != null,
    );
  }

  static double? _runInference(String text) {
    final interpreter = _interpreter!;
    final inputTensor = interpreter.getInputTensor(0);
    final outputTensor = interpreter.getOutputTensor(0);
    final inShape = inputTensor.shape;
    final outShape = outputTensor.shape;
    final seqLen = inShape.length == 2 ? inShape[1] : 128;
    final tokens = _tokenize(text, seqLen);
    final input = [tokens];
    dynamic output;
    if (outShape.length == 2) {
      output = List.generate(outShape[0], (_) => List.filled(outShape[1], 0.0));
    } else {
      output = List.filled(outShape.reduce((a, b) => a * b), 0.0);
    }
    interpreter.run(input, output);
    double prob;
    if (output is List && output.isNotEmpty) {
      if (output[0] is List) {
        final List<double> probs = (output[0] as List).map((e) => (e as num).toDouble()).toList();
        int phishingIndex = 1;
        if (_labels != null) {
          final idx = _labels!.indexWhere((l) => l.toLowerCase().contains('phishing') || l.toLowerCase().contains('spam'));
          if (idx >= 0) phishingIndex = idx;
        }
        prob = probs.length > phishingIndex ? probs[phishingIndex] : (probs.isNotEmpty ? probs.last : 0.0);
      } else {
        prob = (output[0] as num).toDouble();
      }
    } else {
      prob = 0.0;
    }
    return (prob * 100).clamp(0, 100);
  }

  static List<int> _tokenize(String text, int maxLen) {
    final words = text.toLowerCase().split(RegExp(r'[^a-z0-9]+')).where((w) => w.isNotEmpty).toList();
    final seq = List<int>.filled(maxLen, 0);
    for (int i = 0; i < maxLen && i < words.length; i++) {
      seq[i] = (words[i].codeUnits.fold<int>(0, (p, c) => p + c) % 10000) + 1;
    }
    return seq;
  }

  static String _buildExplanation(String level, List<String> reasons) {
    final prefix = level == 'High'
        ? 'High risk of phishing detected.'
        : level == 'Medium'
            ? 'Medium risk indicators found.'
            : 'Low risk detected.';
    final detail = reasons.isEmpty ? 'No common phishing patterns found.' : 'Reasons: ${reasons.join(', ')}.';
    return '$prefix $detail';
  }

  static String _translateHi(String text) {
    final map = {
      'High risk of phishing detected.': 'उच्च जोखिम की फ़िशिंग पाई गई.',
      'Medium risk indicators found.': 'मध्यम जोखिम के संकेत मिले.',
      'Low risk detected.': 'कम जोखिम पाया गया.',
      'No common phishing patterns found.': 'सामान्य फ़िशिंग पैटर्न नहीं मिला.',
      'Reasons:': 'कारण:',
    };
    var t = text;
    map.forEach((k, v) {
      t = t.replaceAll(k, v);
    });
    return t;
  }
}
