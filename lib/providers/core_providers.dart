import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../config/app_config.dart';
import '../config/firebase_options.dart';
import '../core/errors/error_messages.dart';
import '../repositories/categories_repository.dart';
import '../repositories/notifications_repository.dart';
import '../repositories/profile_repository.dart';
import '../repositories/records_repository.dart';
import '../repositories/wallet_repository.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/secure_store.dart';
import '../services/settings_store.dart';
import '../services/wallet_api.dart';

final Provider<AppConfig> appConfigProvider = Provider<AppConfig>((Ref ref) => AppConfig.fromEnvironment);

/// Overridden in `main()` with the opened store (and in tests).
final Provider<SettingsStore> settingsStoreProvider = Provider<SettingsStore>((Ref ref) {
  throw UnimplementedError('settingsStoreProvider must be overridden with an opened SettingsStore.');
});

final Provider<SecureKeyValueStore> secureStoreProvider = Provider<SecureKeyValueStore>((Ref ref) => PlatformSecureStore());

final Provider<IdempotencyStore> idempotencyStoreProvider = Provider<IdempotencyStore>((Ref ref) {
  return IdempotencyStore(ref.watch(secureStoreProvider));
});

// ------------------------------------------------------------------ start-up

enum BootStatus { ready, configMissing, unsupported, failed }

/// Outcome of the real start-up work: platform check, configuration check, Firebase initialisation, locale data
/// and the first authentication event.
class BootResult {
  const BootResult(this.status, {this.missing = const <String>[], this.message = ''});

  final BootStatus status;
  final List<String> missing;
  final String message;

  bool get isReady => status == BootStatus.ready;
}

final FutureProvider<BootResult> bootstrapProvider = FutureProvider<BootResult>((Ref ref) async {
  final AppConfig config = ref.watch(appConfigProvider);
  final TargetPlatform platform = defaultTargetPlatform;
  if (!AppConfig.isSupportedPlatform(platform)) {
    return BootResult(BootStatus.unsupported, message: 'iKeepZ runs on Android and Windows (this device: ${platform.name}).');
  }
  final List<String> missing = config.missingKeys(platform);
  if (missing.isNotEmpty) return BootResult(BootStatus.configMissing, missing: missing);
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(options: firebaseOptionsFor(config, platform));
    }
    await initializeDateFormatting();
    // Wait for Firebase Auth to restore the previous session (or report that there is none).
    await FirebaseAuth.instance.authStateChanges().first;
    return const BootResult(BootStatus.ready);
  } catch (error) {
    return BootResult(BootStatus.failed, message: friendlyError(error));
  }
});

// ------------------------------------------------------------------ firebase

final Provider<FirebaseAuth> firebaseAuthProvider = Provider<FirebaseAuth>((Ref ref) => FirebaseAuth.instance);

final Provider<FirebaseFirestore> firestoreProvider = Provider<FirebaseFirestore>((Ref ref) => FirebaseFirestore.instance);

final Provider<FirebaseStorage> firebaseStorageProvider = Provider<FirebaseStorage>((Ref ref) => FirebaseStorage.instance);

final Provider<AuthService> authServiceProvider = Provider<AuthService>((Ref ref) {
  return FirebaseAuthService(ref.watch(firebaseAuthProvider));
});

// ------------------------------------------------------------------ api

final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((Ref ref) {
  final AppConfig config = ref.watch(appConfigProvider);
  final AuthService auth = ref.watch(authServiceProvider);
  final ApiClient client = ApiClient(baseUrl: config.apiBase, tokenProvider: auth.idToken);
  ref.onDispose(client.close);
  return client;
});

final Provider<WalletApi> walletApiProvider = Provider<WalletApi>((Ref ref) {
  return WalletApi(ref.watch(apiClientProvider), ref.watch(idempotencyStoreProvider));
});

// ------------------------------------------------------------ repositories

final Provider<RecordsRepository> recordsRepositoryProvider = Provider<RecordsRepository>((Ref ref) {
  return RecordsRepository(ref.watch(firestoreProvider));
});

final Provider<CategoriesRepository> categoriesRepositoryProvider = Provider<CategoriesRepository>((Ref ref) {
  return CategoriesRepository(ref.watch(firestoreProvider));
});

final Provider<ProfileRepository> profileRepositoryProvider = Provider<ProfileRepository>((Ref ref) {
  return ProfileRepository(ref.watch(firestoreProvider), ref.watch(firebaseStorageProvider));
});

final Provider<WalletRepository> walletRepositoryProvider = Provider<WalletRepository>((Ref ref) {
  return WalletRepository(ref.watch(firestoreProvider));
});

final Provider<NotificationsRepository> notificationsRepositoryProvider = Provider<NotificationsRepository>((Ref ref) {
  return NotificationsRepository(ref.watch(firestoreProvider));
});
