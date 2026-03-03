import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../utils/phishing_analyzer.dart';
import '../models/phishing_result.dart';

class PhishingScreen extends StatefulWidget {
  static const routeName = '/phishing-screen';
  const PhishingScreen({super.key});

  @override
  State<PhishingScreen> createState() => _PhishingScreenState();
}

class _PhishingScreenState extends State<PhishingScreen> with SingleTickerProviderStateMixin {
  final TextEditingController _controller = TextEditingController();
  PhishingResult? _result;
  bool _loading = false;

  Future<void> _analyze() async {
    final text = _controller.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter text to analyze')));
      return;
    }
    try {
      setState(() {
        _loading = true;
        _result = null;
      });
      await Future.delayed(const Duration(milliseconds: 800));
      final r = await PhishingAnalyzer.analyzeHybrid(text);
      setState(() {
        _result = r;
        _loading = false;
      });
    } catch (e) {
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Error analyzing message')));
    }
  }

  void _block() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Blocked')));
  }

  void _report() {
    if (_result == null) return;
    final text = _controller.text.trim();
    final r = _result!;
    final report = 'Phishing Report\\nLevel: ${r.level}\\nScore: ${r.score.toStringAsFixed(0)}%\\nReasons: ${r.reasons.join(', ')}\\nText: $text';
    Clipboard.setData(ClipboardData(text: report));
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report copied to clipboard')));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        leading: Icon(Icons.shield, color: cs.error),
        title: const Text('Phishing & Scam Detection'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: _controller,
              maxLines: 8,
              decoration: InputDecoration(
                hintText: 'Paste SMS / message / URL / email content',
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
                    : _result == null
                        ? Center(
                            child: Text(
                              'Enter content and tap Analyze',
                              style: Theme.of(context).textTheme.bodyLarge,
                            ),
                          )
                        : _buildResult(context, _result!, cs),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _result == null ? null : _block,
                icon: const Icon(Icons.block),
                label: const Text('Block'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: _result == null ? null : _report,
                icon: const Icon(Icons.report),
                label: const Text('Report'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResult(BuildContext context, PhishingResult r, ColorScheme cs) {
    final risky = r.level != 'Low';
    final bg = risky ? cs.errorContainer : cs.primaryContainer;
    final fg = risky ? cs.onErrorContainer : cs.onPrimaryContainer;
    return TweenAnimationBuilder<double>(
      duration: const Duration(milliseconds: 250),
      tween: Tween(begin: 0.9, end: 1.0),
      builder: (context, scale, child) => Transform.scale(scale: scale, child: child),
      child: Card(
        color: bg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(risky ? Icons.warning : Icons.verified, color: fg),
                  const SizedBox(width: 8),
                  Text(
                    '${r.level} Risk • ${r.score.toStringAsFixed(0)}%',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(color: fg),
                  ),
                  const Spacer(),
                  if (r.aiUsed)
                    Chip(
                      label: const Text('AI Powered'),
                      backgroundColor: cs.surface,
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                risky ? r.explanationHi : r.explanation,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: fg),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: r.reasons
                    .map((e) => Chip(
                          label: Text(e),
                          backgroundColor: cs.surface,
                        ))
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
