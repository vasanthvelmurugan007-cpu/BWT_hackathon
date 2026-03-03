import 'package:flutter/material.dart';
import 'screens/home_screen.dart';
import 'screens/phishing_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/stolen_tracking_screen.dart';
import 'screens/deepfake_protection_screen.dart';
import 'screens/financial_fraud_screen.dart';
import 'screens/stolen_phone_screen.dart';
import 'screens/image_protection_screen.dart';

void main() {
  runApp(const PhishGuardApp());
}

class PhishGuardApp extends StatelessWidget {
  const PhishGuardApp({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(seedColor: Colors.red);
    return MaterialApp(
      title: 'PhishGuard AI',
      theme: ThemeData(
        colorScheme: colorScheme,
        useMaterial3: true,
        visualDensity: VisualDensity.adaptivePlatformDensity,
      ),
      home: const SplashScreen(),
      routes: {
        PhishingScreen.routeName: (_) => const PhishingScreen(),
        HomeScreen.routeName: (_) => const HomeScreen(),
        StolenTrackingScreen.routeName: (_) => const StolenTrackingScreen(),
        StolenPhoneScreen.routeName: (_) => const StolenPhoneScreen(),
        DeepfakeProtectionScreen.routeName: (_) => const DeepfakeProtectionScreen(),
        ImageProtectionScreen.routeName: (_) => const ImageProtectionScreen(),
        FinancialFraudScreen.routeName: (_) => const FinancialFraudScreen(),
      },
    );
  }
}
