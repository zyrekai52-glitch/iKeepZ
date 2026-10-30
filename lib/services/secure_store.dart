import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Small key/value store backed by the platform's secure storage (Android Keystore, Windows DPAPI).
///
/// The app keeps only one kind of data here: the idempotency keys of wallet operations that were sent but not yet
/// answered, so that a restart replays the same key instead of risking a second debit. Passwords and tokens are
/// handled by Firebase Auth and never stored by the app.
abstract class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class PlatformSecureStore implements SecureKeyValueStore {
  PlatformSecureStore() : _storage = const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  // If the platform store fails (for example a locked-down Windows profile) the app keeps working for this run.
  final Map<String, String> _memory = <String, String>{};

  @override
  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key) ?? _memory[key];
    } catch (error) {
      debugPrint('Secure storage read failed: $error');
      return _memory[key];
    }
  }

  @override
  Future<void> write(String key, String value) async {
    _memory[key] = value;
    try {
      await _storage.write(key: key, value: value);
    } catch (error) {
      debugPrint('Secure storage write failed: $error');
    }
  }

  @override
  Future<void> delete(String key) async {
    _memory.remove(key);
    try {
      await _storage.delete(key: key);
    } catch (error) {
      debugPrint('Secure storage delete failed: $error');
    }
  }
}

/// In-memory store for tests.
class MemorySecureStore implements SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

/// Keeps one idempotency key per wallet operation until the server has answered.
///
/// [keyFor] returns the stored key when the payload fingerprint is unchanged (a retry or a restart), and a new
/// random key otherwise (a different amount or destination must never reuse an old key: the server would answer
/// `idempotency_conflict`). Call [clear] once the server has given a definitive answer.
class IdempotencyStore {
  IdempotencyStore(this._store, {Random? random}) : _random = random ?? Random.secure();

  final SecureKeyValueStore _store;
  final Random _random;

  static const String _alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  String newKey() {
    final StringBuffer out = StringBuffer();
    for (int i = 0; i < 32; i++) {
      out.write(_alphabet[_random.nextInt(_alphabet.length)]);
    }
    return out.toString();
  }

  Future<String> keyFor(String operation, String fingerprint) async {
    final String storageKey = 'idem.$operation';
    final String? stored = await _store.read(storageKey);
    if (stored != null) {
      try {
        final Object? decoded = jsonDecode(stored);
        if (decoded is Map && decoded['fp'] == fingerprint && decoded['key'] is String) {
          return decoded['key'] as String;
        }
      } on FormatException {
        // fall through and create a new key
      }
    }
    final String key = newKey();
    await _store.write(storageKey, jsonEncode(<String, String>{'fp': fingerprint, 'key': key}));
    return key;
  }

  Future<void> clear(String operation) => _store.delete('idem.$operation');
}
