import 'package:flutter/material.dart';

class StolenTrackingScreen extends StatelessWidget {
  static const routeName = '/stolen';
  const StolenTrackingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Stolen Phone Tracking & FIR')),
      body: const Center(
        child: Text('Tracking & FIR feature coming next'),
      ),
    );
  }
}
