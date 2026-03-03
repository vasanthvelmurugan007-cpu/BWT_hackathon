import 'package:flutter/material.dart';

class DeepfakeProtectionScreen extends StatelessWidget {
  static const routeName = '/deepfake';
  const DeepfakeProtectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Deepfake & Image Abuse Protection')),
      body: const Center(
        child: Text('Deepfake/Image feature coming next'),
      ),
    );
  }
}
