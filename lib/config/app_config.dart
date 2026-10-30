import 'package:flutter/foundation.dart';

/// Build-time configuration, injected with `--dart-define-from-file=config/app_config.json`.
///
/// None of these values is a secret: Firebase client identifiers are public and are protected by the
/// security rules in `backend/`. Payment-provider keys and signing keys never reach the app.
class AppConfig {
  const AppConfig({
    required this.firebaseApiKey,
    required this.firebaseProjectId,
    required this.firebaseMessagingSenderId,
    required this.firebaseStorageBucket,
    required this.firebaseAppIdAndroid,
    required this.firebaseAppIdWindows,
    required this.firebaseAuthDomain,
    required this.apiBaseUrl,
    required this.supportEmail,
    required this.privacyUrl,
    required this.releasesUrl,
  });

  /// The values compiled into this build.
  static const AppConfig fromEnvironment = AppConfig(
    firebaseApiKey: String.fromEnvironment('FIREBASE_API_KEY'),
    firebaseProjectId: String.fromEnvironment('FIREBASE_PROJECT_ID'),
    firebaseMessagingSenderId: String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID'),
    firebaseStorageBucket: String.fromEnvironment('FIREBASE_STORAGE_BUCKET'),
    firebaseAppIdAndroid: String.fromEnvironment('FIREBASE_APP_ID_ANDROID'),
    firebaseAppIdWindows: String.fromEnvironment('FIREBASE_APP_ID_WINDOWS'),
    firebaseAuthDomain: String.fromEnvironment('FIREBASE_AUTH_DOMAIN'),
    apiBaseUrl: String.fromEnvironment('API_BASE_URL'),
    supportEmail: String.fromEnvironment('SUPPORT_EMAIL'),
    privacyUrl: String.fromEnvironment('PRIVACY_URL'),
    releasesUrl: String.fromEnvironment('RELEASES_URL'),
  );

  final String firebaseApiKey;
  final String firebaseProjectId;
  final String firebaseMessagingSenderId;
  final String firebaseStorageBucket;
  final String firebaseAppIdAndroid;
  final String firebaseAppIdWindows;
  final String firebaseAuthDomain;
  final String apiBaseUrl;
  final String supportEmail;
  final String privacyUrl;
  final String releasesUrl;

  /// API base URL without trailing slashes.
  String get apiBase {
    String value = apiBaseUrl.trim();
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    return value;
  }

  bool get hasSupportEmail => supportEmail.trim().isNotEmpty;
  bool get hasPrivacyUrl => privacyUrl.trim().isNotEmpty;
  bool get hasReleasesUrl => releasesUrl.trim().isNotEmpty;

  /// Whether the app can run on [platform] at all (Firebase is wired for Android and Windows).
  static bool isSupportedPlatform(TargetPlatform platform) {
    return platform == TargetPlatform.android || platform == TargetPlatform.windows;
  }

  /// Names of required keys that are empty in this build, for the "Configuration required" screen.
  List<String> missingKeys(TargetPlatform platform) {
    final List<String> missing = <String>[];
    if (firebaseApiKey.trim().isEmpty) missing.add('FIREBASE_API_KEY');
    if (firebaseProjectId.trim().isEmpty) missing.add('FIREBASE_PROJECT_ID');
    if (firebaseMessagingSenderId.trim().isEmpty) missing.add('FIREBASE_MESSAGING_SENDER_ID');
    if (firebaseStorageBucket.trim().isEmpty) missing.add('FIREBASE_STORAGE_BUCKET');
    if (platform == TargetPlatform.android) {
      if (firebaseAppIdAndroid.trim().isEmpty) missing.add('FIREBASE_APP_ID_ANDROID');
    } else {
      if (firebaseAppIdWindows.trim().isEmpty) missing.add('FIREBASE_APP_ID_WINDOWS');
    }
    if (apiBase.isEmpty) missing.add('API_BASE_URL');
    return missing;
  }
}
