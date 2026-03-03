import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' as latlng2;
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

class StolenPhoneScreen extends StatefulWidget {
  static const routeName = '/stolen-phone';
  const StolenPhoneScreen({super.key});

  @override
  State<StolenPhoneScreen> createState() => _StolenPhoneScreenState();
}

class _StolenPhoneScreenState extends State<StolenPhoneScreen> {
  GoogleMapController? _mapController;
  Timer? _timer;
  LatLng _position = const LatLng(12.9716, 77.5946);
  bool _tracking = false;
  bool _useOsm = false;

  @override
  void dispose() {
    _timer?.cancel();
    _mapController?.dispose();
    super.dispose();
  }

  Future<void> _requestPermission() async {
    if (kIsWeb) return;
    final status = await Permission.locationWhenInUse.request();
    if (status.isGranted) return;
    if (status.isDenied || status.isPermanentlyDenied) {
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Location Permission'),
          content: const Text('Location is needed to show device position. Please allow in settings.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('OK')),
          ],
        ),
      );
    }
  }

  void _startTracking() async {
    await _requestPermission();
    if (_tracking) return;
    setState(() {
      _tracking = true;
      if (kIsWeb) {
        _useOsm = true;
      }
    });
    _timer = Timer.periodic(const Duration(seconds: 5), (t) {
      final rnd = Random();
      final dx = (rnd.nextDouble() - 0.5) / 1000;
      final dy = (rnd.nextDouble() - 0.5) / 1000;
      _position = LatLng(_position.latitude + dx, _position.longitude + dy);
      setState(() {});
      _mapController?.animateCamera(
        CameraUpdate.newLatLng(_position),
      );
    });
  }

  Future<void> _generateFIR() async {
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Generate FIR'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Name'),
              ),
              TextField(
                controller: phoneController,
                decoration: const InputDecoration(labelText: 'Phone'),
                keyboardType: TextInputType.phone,
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Create')),
          ],
        );
      },
    );
    if (ok != true) return;
    final now = DateTime.now();
    final doc = pw.Document();
    doc.addPage(
      pw.Page(
        build: (pw.Context context) {
          return pw.Padding(
            padding: const pw.EdgeInsets.all(24),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text('FIR – Mobile Theft', style: pw.TextStyle(fontSize: 24, fontWeight: pw.FontWeight.bold)),
                pw.SizedBox(height: 16),
                pw.Text('Complainant: ${nameController.text}'),
                pw.Text('Phone: ${phoneController.text}'),
                pw.SizedBox(height: 12),
                pw.Text('Last known location:'),
                pw.Text('Lat: ${_position.latitude.toStringAsFixed(6)}, Lng: ${_position.longitude.toStringAsFixed(6)}'),
                pw.SizedBox(height: 12),
                pw.Text('Timestamp: $now'),
                pw.SizedBox(height: 24),
                pw.Text('Details:'),
                pw.Text('Device reported stolen. Location updates simulated for investigation.'),
              ],
            ),
          );
        },
      ),
    );
    try {
      final bytes = await doc.save();
      await Printing.sharePdf(bytes: bytes, filename: 'FIR_Mobile_Theft.pdf');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Error generating PDF')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        leading: Icon(Icons.shield, color: cs.error),
        title: const Text('Stolen Phone Tracking & FIR'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _startTracking,
                    icon: const Icon(Icons.report),
                    label: const Text('Device Stolen'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _generateFIR,
                    icon: const Icon(Icons.picture_as_pdf),
                    label: const Text('Generate FIR'),
                  ),
                ),
                const SizedBox(width: 12),
                TextButton(
                  onPressed: () => setState(() => _useOsm = !_useOsm),
                  child: Text(_useOsm ? 'Use Google Map' : 'Use Open Map'),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'If Google Map is blank, add Android API key in AndroidManifest.xml or use Open Map fallback.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
              ),
            ),
          ),
          Expanded(
            child: _useOsm
                ? FlutterMap(
                    options: MapOptions(
                      initialCenter: latlng2.LatLng(_position.latitude, _position.longitude),
                      initialZoom: 14,
                    ),
                    children: [
                      TileLayer(
                        urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        subdomains: const ['a', 'b', 'c'],
                        userAgentPackageName: 'phishguard_ai',
                      ),
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: latlng2.LatLng(_position.latitude, _position.longitude),
                            width: 40,
                            height: 40,
                            child: const Icon(Icons.location_on, color: Colors.red, size: 36),
                          ),
                        ],
                      ),
                    ],
                  )
                : GoogleMap(
                    onMapCreated: (c) => _mapController = c,
                    initialCameraPosition: CameraPosition(target: _position, zoom: 14),
                    markers: {
                      Marker(markerId: const MarkerId('device'), position: _position),
                    },
                    myLocationButtonEnabled: false,
                    zoomControlsEnabled: true,
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(Icons.location_on, color: cs.error),
                const SizedBox(width: 8),
                Text('Lat: ${_position.latitude.toStringAsFixed(6)}, Lng: ${_position.longitude.toStringAsFixed(6)}'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
