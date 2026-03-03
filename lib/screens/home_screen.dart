import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'phishing_screen.dart';
import 'stolen_phone_screen.dart';
import 'image_protection_screen.dart';
import 'financial_fraud_screen.dart';

class HomeScreen extends StatefulWidget {
  static const routeName = '/home';
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;
  late final List<Widget> _pages = const [
    PhishingScreen(),
    StolenPhoneScreen(),
    ImageProtectionScreen(),
    FinancialFraudScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        leading: Icon(Icons.shield, color: cs.error),
        title: const Text('PhishGuard AI – Ignite Freelancers'),
        backgroundColor: cs.surface,
        elevation: 0,
      ),
      body: Column(
        children: [
          if (kIsWeb)
            Container(
              width: double.infinity,
              color: cs.errorContainer,
              padding: const EdgeInsets.all(8),
              child: Text(
                'Running in Web Demo Mode – some features limited',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.onErrorContainer),
              ),
            ),
          Expanded(child: IndexedStack(index: _index, children: _pages)),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        type: BottomNavigationBarType.fixed,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.security), label: 'Phishing'),
          BottomNavigationBarItem(icon: Icon(Icons.map), label: 'Tracking'),
          BottomNavigationBarItem(icon: Icon(Icons.image), label: 'Image'),
          BottomNavigationBarItem(icon: Icon(Icons.attach_money), label: 'Fraud'),
        ],
      ),
    );
  }
}
