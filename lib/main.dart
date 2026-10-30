import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'providers/core_providers.dart';
import 'services/settings_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final SettingsStore settings = await SettingsStore.open();
  runApp(
    ProviderScope(
      // A failed provider must show its error, not silently retry in the background (a retry could repeat a request).
      retry: (int retryCount, Object error) => null,
      overrides: [
        settingsStoreProvider.overrideWithValue(settings),
      ],
      child: const IkeepzApp(),
    ),
  );
}
