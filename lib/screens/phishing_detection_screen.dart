import 'package:flutter/material.dart';
import '../utils/phishing_analyzer.dart';
import '../models/phishing_result.dart';
import 'package:flutter/services.dart';

class PhishingDetectionScreen extends StatefulWidget {
  static const routeName = '/phishing';
  const PhishingDetectionScreen({super.key});

  @override
  State<PhishingDetectionScreen> createState() => _PhishingDetectionScreenState();
}

class _PhishingDetectionScreenState extends State<PhishingDetectionScreen> {
  final TextEditingController _controller = TextEditingController();
  PhishingResult? _result;
  bool _loading = false;
  bool _showHindi = false;

  Future<void> _analyze() async {
    final text = _controller.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter text to analyze')));
      return;
    }
    setState(() {
      _loading = true;
      _result = null;
    });
    await Future.delayed(const Duration(milliseconds: 800));
    final r = PhishingAnalyzer.analyze(text);
    setState(() {
      _result = r;
      _loading = false;
    });
  }

  void _blockReport() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Blocked and reported')));
  }

  Color _riskColor(String level, ColorScheme cs) {
    if (level == 'High') return cs.errorContainer;
    if (level == 'Medium') return cs.tertiaryContainer;
    return cs.primaryContainer;
  }

  Color _riskOnColor(String level, ColorScheme cs) {
    if (level == 'High') return cs.onErrorContainer;
    if (level == 'Medium') return cs.onTertiaryContainer;
    return cs.onPrimaryContainer;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Phishing & Scam Detection'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: _controller,
              maxLines: 5,
              decoration: InputDecoration(
                hintText: 'Paste SMS/URL/email text',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _loading ? null : _analyze,
                    icon: const Icon(Icons.search),
                    label: const Text('Analyze'),
                  ),
                ),
                const SizedBox(width: 12),
                Row(
                  children: [
                    Switch(
                      value: _showHindi,
                      onChanged: (v) => setState(() => _showHindi = v),
                    ),
                    const Text('Hindi'),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (_loading)
              const Expanded(
                child: Center(child: CircularProgressIndicator()),
              )
            else
              Expanded(
                child: _result == null
                    ? Center(
                        child: Text(
                          'Enter text and tap Analyze',
                          style: Theme.of(context).textTheme.bodyLarge,
                        ),
                      )
                    : _buildResultCard(context, _result!, cs),
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
                onPressed: _result == null ? null : () {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Blocked')));
                },
                icon: const Icon(Icons.block),
                label: const Text('Block'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: _result == null ? null : () {
                  final text = _controller.text.trim();
                  final r = _result!;
                  final report = 'Phishing Report\\nLevel: ${r.level}\\nScore: ${r.score.toStringAsFixed(0)}%\\nReasons: ${r.reasons.join(', ')}\\nText: $text';
                  Clipboard.setData(ClipboardData(text: report));
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report copied to clipboard')));
                },
                icon: const Icon(Icons.report),
                label: const Text('Report'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResultCard(BuildContext context, PhishingResult r, ColorScheme cs) {
    final bg = _riskColor(r.level, cs);
    final fg = _riskOnColor(r.level, cs);
    return Card(
      color: bg,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(r.level == 'High' ? Icons.warning : Icons.verified, color: fg),
                const SizedBox(width: 8),
                Text(
                  '${r.level} Risk • ${r.score.toStringAsFixed(0)}%',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(color: fg),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              _showHindi ? r.explanationHi : r.explanation,
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
    );
  }
}
