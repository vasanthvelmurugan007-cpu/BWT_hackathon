import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:ui' as ui;
import 'package:tflite_flutter/tflite_flutter.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

class ImageProtectionScreen extends StatefulWidget {
  static const routeName = '/image-protection';
  const ImageProtectionScreen({super.key});

  @override
  State<ImageProtectionScreen> createState() => _ImageProtectionScreenState();
}

class _ImageProtectionScreenState extends State<ImageProtectionScreen> {
  final ImagePicker _picker = ImagePicker();
  XFile? _selected;
  double? _risk;
  String? _explanation;
  bool _loading = false;
  Interpreter? _interpreter;
  bool _aiReady = false;
  int _inputW = 224;
  int _inputH = 224;

  Future<void> _ensureModel() async {
    if (_aiReady) return;
    try {
      if (kIsWeb) {
        _aiReady = false;
        return;
      }
      _interpreter = await Interpreter.fromAsset('models/nsfw_model.tflite');
      final inShape = _interpreter!.getInputTensor(0).shape;
      if (inShape.length >= 3) {
        _inputW = inShape[1];
        _inputH = inShape[2];
      }
      _aiReady = true;
    } catch (_) {
      _aiReady = false;
    }
  }

  Future<void> _pickImage() async {
    final img = await _picker.pickImage(source: ImageSource.gallery);
    if (img != null) {
      setState(() {
        _selected = img;
        _risk = null;
        _explanation = null;
      });
    }
  }

  Future<void> _scan() async {
    if (_selected == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Select an image first')));
      return;
    }
    setState(() {
      _loading = true;
      _risk = null;
      _explanation = null;
    });
    try {
      await _ensureModel();
      if (_aiReady && _interpreter != null) {
        final prob = await _runInference(_selected!);
        final score = (prob * 100).clamp(0, 100);
        final isHigh = prob >= 0.5;
        setState(() {
          _risk = score.toDouble();
          _explanation = isHigh ? 'Inappropriate content detected' : 'No risky content found';
          _loading = false;
        });
      } else {
        final rnd = Random();
        final mockRisk = 30 + rnd.nextInt(71);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('AI model not loaded – using demo mode')));
        final isHigh = mockRisk >= 70;
        setState(() {
          _risk = mockRisk.toDouble();
          _explanation = isHigh ? 'Inappropriate content detected' : 'No risky content found';
          _loading = false;
        });
      }
    } catch (_) {
      setState(() {
        _loading = false;
        _risk = null;
        _explanation = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Scan failed')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final isHigh = (_risk ?? 0) >= 70;
    return Scaffold(
      appBar: AppBar(
        leading: Icon(Icons.shield, color: cs.error),
        title: const Text('Deepfake & Image Abuse Protection'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickImage,
                    icon: const Icon(Icons.photo_library),
                    label: const Text('Pick Image'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _loading ? null : _scan,
                    icon: const Icon(Icons.search),
                    label: const Text('Scan'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (kIsWeb)
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Web: select file from computer (demo mode)',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                ),
              ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _selected == null
                        ? Center(child: Text('Pick an image to scan', style: Theme.of(context).textTheme.bodyLarge))
                        : Column(
                            children: [
                              Expanded(
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(12),
                                  child: isHigh
                                      ? ImageFiltered(
                                          imageFilter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8),
                                          child: Image.file(File(_selected!.path), fit: BoxFit.cover),
                                        )
                                      : Image.file(File(_selected!.path), fit: BoxFit.cover),
                                ),
                              ),
                              const SizedBox(height: 12),
                              if (_risk != null)
                                Card(
                                  color: isHigh ? cs.errorContainer : cs.primaryContainer,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                  child: Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Row(
                                      children: [
                                        Icon(isHigh ? Icons.warning : Icons.verified, color: isHigh ? cs.onErrorContainer : cs.onPrimaryContainer),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                'Risk: ${_risk!.toStringAsFixed(0)}%',
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .titleMedium
                                                    ?.copyWith(color: isHigh ? cs.onErrorContainer : cs.onPrimaryContainer),
                                              ),
                                              const SizedBox(height: 4),
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
                                        const SizedBox(width: 8),
                                        if (_aiReady)
                                          Chip(
                                            label: Text('AI Scan ${_risk!.toStringAsFixed(0)}%'),
                                            backgroundColor: cs.surface,
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                            ],
                          ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<double> _runInference(XFile file) async {
    final bytes = await file.readAsBytes();
    final uiImg = await decodeImageFromList(bytes);
    final resized = await _resizeImage(uiImg, _inputW, _inputH);
    final bd = await resized.toByteData(format: ui.ImageByteFormat.rawRgba);
    final data = bd!.buffer.asUint8List();
    final input = List.generate(_inputH, (y) {
      return List.generate(_inputW, (x) {
        final idx = (y * _inputW + x) * 4;
        final r = data[idx].toDouble();
        final g = data[idx + 1].toDouble();
        final b = data[idx + 2].toDouble();
        return [(r / 255.0), (g / 255.0), (b / 255.0)];
      });
    });
    final modelInput = [input];
    final outTensor = _interpreter!.getOutputTensor(0);
    final outShape = outTensor.shape;
    dynamic output;
    if (outShape.length == 2) {
      output = List.generate(outShape[0], (_) => List.filled(outShape[1], 0.0));
    } else {
      output = List.filled(outShape.reduce((a, b) => a * b), 0.0);
    }
    _interpreter!.run(modelInput, output);
    double prob;
    if (output is List && output.isNotEmpty) {
      if (output[0] is List) {
        final List<double> probs = (output[0] as List).map((e) => (e as num).toDouble()).toList();
        prob = probs.length > 1 ? probs[1] : (probs.isNotEmpty ? probs.last : 0.0);
      } else {
        prob = (output[0] as num).toDouble();
      }
    } else {
      prob = 0.0;
    }
    return prob;
  }

  Future<ui.Image> _resizeImage(ui.Image src, int w, int h) async {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final paint = Paint();
    final srcRect = Rect.fromLTWH(0, 0, src.width.toDouble(), src.height.toDouble());
    final dstRect = Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble());
    canvas.drawImageRect(src, srcRect, dstRect, paint);
    final picture = recorder.endRecording();
    return picture.toImage(w, h);
  }
}
