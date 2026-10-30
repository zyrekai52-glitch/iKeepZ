import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/preferences.dart';

/// Device-local settings: a mirror of the account preferences (so the theme is right before sign-in and while
/// offline) and the last email address used on the sign-in form.
class SettingsStore {
  SettingsStore(this._prefs);

  final SharedPreferences _prefs;

  static const String _prefsKey = 'preferences.v1';
  static const String _emailKey = 'lastEmail';

  static Future<SettingsStore> open() async {
    return SettingsStore(await SharedPreferences.getInstance());
  }

  Preferences loadPreferences() {
    final String? raw = _prefs.getString(_prefsKey);
    if (raw == null) return Preferences.defaults;
    try {
      return Preferences.fromMap(jsonDecode(raw));
    } on FormatException {
      return Preferences.defaults;
    }
  }

  Future<void> savePreferences(Preferences preferences) async {
    await _prefs.setString(_prefsKey, jsonEncode(preferences.toMap()));
  }

  String get lastEmail => _prefs.getString(_emailKey) ?? '';

  /// Whether `POST /bootstrap` already succeeded for [uid] on this device (lets the app start offline afterwards).
  bool isBootstrapped(String uid) => _prefs.getBool('bootstrapped.$uid') ?? false;

  Future<void> markBootstrapped(String uid) async {
    await _prefs.setBool('bootstrapped.$uid', true);
  }

  Future<void> saveLastEmail(String email) async {
    if (email.isEmpty) {
      await _prefs.remove(_emailKey);
    } else {
      await _prefs.setString(_emailKey, email);
    }
  }
}
