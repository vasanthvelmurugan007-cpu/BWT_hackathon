import 'package:flutter/material.dart';
import 'dart:math';

class FinancialFraudScreen extends StatefulWidget {
  static const routeName = '/fraud';
  const FinancialFraudScreen({super.key});

  @override
  State<FinancialFraudScreen> createState() => _FinancialFraudScreenState();
}

class _FinancialFraudScreenState extends State<FinancialFraudScreen> {
  final TextEditingController _controller = TextEditingController();
  bool _loading = false;
  double? _risk;
  String? _explanation;

  Future<void> _analyze() async {
    final text = _controller.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Paste a transaction message')));
      return;
    }
    setState(() {
      _loading = true;
      _risk = null;
      _explanation = null;
    });
    await Future.delayed(const Duration(milliseconds: 800));
    final lower = text.toLowerCase();
    int hits = 0;
    final reasons = <String>[];

    final amountMatch = RegExp(r'(rs\.?\s?\d+[\,\d]*|inr\s?\d+[\,\d]*)', caseSensitive: false).firstMatch(text);
    double amount = 0;
    if (amountMatch != null) {
      final amtStr = amountMatch.group(0)!.replaceAll(RegExp(r'[^0-9]'), '');
      if (amtStr.isNotEmpty) {
        amount = double.tryParse(amtStr) ?? 0;
      }
      if (amount > 0) {
        reasons.add('Amount detected');
        hits += 1;
      }
      if (amount >= 5000) {
        reasons.add('High amount > ₹5000');
        hits += 2;
      }
    }

    if (lower.contains('collect request') || lower.contains('payment request')) {
      reasons.add('Collect/payment request');
      hits += 2;
    }
    if (lower.contains('+91') || lower.contains('unknown')) {
      reasons.add('Unknown sender');
      hits += 2;
    }
    if (lower.contains('upi') && lower.contains('debited')) {
      reasons.add('UPI debit');
      hits += 1;
    }
    if (lower.contains('refund') || lower.contains('chargeback')) {
      reasons.add('Refund lure');
      hits += 1;
    }
    if (lower.contains('urgent') || lower.contains('immediate')) {
      reasons.add('Urgent tone');
      hits += 1;
    }

    final score = min(100, hits * 15 + (amount >= 5000 ? 10 : 0)).toDouble();
    final isHigh = score >= 60;
    setState(() {
      _risk = score;
      _explanation = isHigh
          ? 'Potential fraud detected: ${reasons.join(', ')}.'
          : reasons.isEmpty
              ? 'No suspicious patterns found.'
              : 'Some risk indicators: ${reasons.join(', ')}.';
      _loading = false;
    });
  }

  void _freeze() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Freeze requested')));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final isHigh = (_risk ?? 0) >= 60;
    return Scaffold(
      appBar: AppBar(
        leading: Icon(Icons.shield, color: cs.error),
        title: const Text('Financial Fraud & Banking Protection'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: _controller,
              maxLines: 5,
              decoration: InputDecoration(
                hintText: 'Paste UPI/bank SMS (e.g., "Rs 12000 debited...")',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _loading ? null : _analyze,
                icon: const Icon(Icons.search),
                label: const Text('Analyze'),
              ),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _risk == null
                        ? Center(child: Text('Enter a message and analyze', style: Theme.of(context).textTheme.bodyLarge))
                        : Card(
                            color: isHigh ? cs.errorContainer : cs.primaryContainer,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Icon(isHigh ? Icons.warning : Icons.verified,
                                          color: isHigh ? cs.onErrorContainer : cs.onPrimaryContainer),
                                      const SizedBox(width: 8),
                                      Text(
                                        'Risk: ${_risk!.toStringAsFixed(0)}%',
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleMedium
                                            ?.copyWith(color: isHigh ? cs.onErrorContainer : cs.onPrimaryContainer),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    _explanation ?? '',
                                    style: Theme.of(context)
                                        .textTheme
                                        .bodyMedium
                                        ?.copyWith(color: isHigh ? cs.onErrorContainer : cs.onPrimaryContainer),
                                  ),
                                ],
                              ),
                            ),
                          ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(16),
        child: ElevatedButton.icon(
          onPressed: _risk == null ? null : _freeze,
          icon: const Icon(Icons.lock),
          label: const Text('Freeze Transaction'),
        ),
      ),
    );
  }
}
