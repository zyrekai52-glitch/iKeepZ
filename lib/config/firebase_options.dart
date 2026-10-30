import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

import 'app_config.dart';

/// Builds the Firebase options from [config] (no `google-services.json`, no generated file).
///
/// Windows uses the web-app configuration of the same Firebase project, as the desktop SDK expects.
FirebaseOptions firebaseOptionsFor(AppConfig config, TargetPlatform platform) {
  final String appId = platform == TargetPlatform.android ? config.firebaseAppIdAndroid : config.firebaseAppIdWindows;
  final String authDomain = config.firebaseAuthDomain.trim();
  return FirebaseOptions(
    apiKey: config.firebaseApiKey.trim(),
    appId: appId.trim(),
    messagingSenderId: config.firebaseMessagingSenderId.trim(),
    projectId: config.firebaseProjectId.trim(),
    storageBucket: config.firebaseStorageBucket.trim(),
    authDomain: authDomain.isEmpty ? null : authDomain,
  );
}
