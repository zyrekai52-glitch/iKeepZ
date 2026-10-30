import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/utils/formats.dart';
import '../models/category.dart';
import '../models/money_record.dart';
import '../models/notification_item.dart';
import '../models/payout_destination.dart';
import '../models/preferences.dart';
import '../models/server_info.dart';
import '../models/user_profile.dart';
import '../models/wallet.dart';
import '../models/wallet_tx.dart';
import '../services/settings_store.dart';
import 'auth_controller.dart';
import 'core_providers.dart';

// ------------------------------------------------------- live Firestore data
// Every stream is keyed on the signed-in uid, so signing out (or switching accounts) drops all of it.

final StreamProvider<UserProfile?> profileProvider = StreamProvider<UserProfile?>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<UserProfile?>.empty();
  return ref.watch(profileRepositoryProvider).watch(uid);
});

final StreamProvider<List<MoneyRecord>> recordsProvider = StreamProvider<List<MoneyRecord>>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<List<MoneyRecord>>.empty();
  return ref.watch(recordsRepositoryProvider).watch(uid);
});

final StreamProvider<List<Category>> categoriesProvider = StreamProvider<List<Category>>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<List<Category>>.empty();
  return ref.watch(categoriesRepositoryProvider).watch(uid);
});

final StreamProvider<Wallet?> walletProvider = StreamProvider<Wallet?>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<Wallet?>.empty();
  return ref.watch(walletRepositoryProvider).watchWallet(uid);
});

final StreamProvider<List<WalletTx>> walletTxProvider = StreamProvider<List<WalletTx>>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<List<WalletTx>>.empty();
  return ref.watch(walletRepositoryProvider).watchTransactions(uid);
});

final StreamProvider<List<LedgerEntry>> ledgerProvider = StreamProvider<List<LedgerEntry>>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<List<LedgerEntry>>.empty();
  return ref.watch(walletRepositoryProvider).watchLedger(uid);
});

final StreamProvider<List<PayoutDestination>> destinationsProvider = StreamProvider<List<PayoutDestination>>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<List<PayoutDestination>>.empty();
  return ref.watch(walletRepositoryProvider).watchDestinations(uid);
});

final StreamProvider<List<NotificationItem>> notificationsProvider = StreamProvider<List<NotificationItem>>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<List<NotificationItem>>.empty();
  return ref.watch(notificationsRepositoryProvider).watch(uid);
});

final StreamProvider<List<ActivityItem>> activityProvider = StreamProvider<List<ActivityItem>>((Ref ref) {
  final String? uid = ref.watch(uidProvider);
  if (uid == null) return const Stream<List<ActivityItem>>.empty();
  return ref.watch(notificationsRepositoryProvider).watchActivity(uid);
});

// -------------------------------------------------------------- derived data

final Provider<List<MoneyRecord>> recordListProvider = Provider<List<MoneyRecord>>((Ref ref) {
  return ref.watch(recordsProvider).value ?? const <MoneyRecord>[];
});

final Provider<List<Category>> categoryListProvider = Provider<List<Category>>((Ref ref) {
  return ref.watch(categoriesProvider).value ?? const <Category>[];
});

final Provider<Map<String, Category>> categoryMapProvider = Provider<Map<String, Category>>((Ref ref) {
  final Map<String, Category> map = <String, Category>{};
  for (final Category category in ref.watch(categoryListProvider)) {
    map[category.id] = category;
  }
  return map;
});

final Provider<int> unreadCountProvider = Provider<int>((Ref ref) {
  final List<NotificationItem> items = ref.watch(notificationsProvider).value ?? const <NotificationItem>[];
  return items.where((NotificationItem item) => !item.isRead).length;
});

// --------------------------------------------------------------- preferences

/// The effective preferences: the account's (once loaded) or the device copy kept from the last session.
class PreferencesController extends Notifier<Preferences> {
  @override
  Preferences build() {
    final SettingsStore store = ref.read(settingsStoreProvider);
    final Preferences? remote = ref.watch(
      profileProvider.select((AsyncValue<UserProfile?> value) => value.value?.preferences),
    );
    if (remote != null) {
      unawaited(store.savePreferences(remote));
      return remote;
    }
    return store.loadPreferences();
  }

  /// Applies [next] immediately, stores it on the device and writes it to the account. Reverts and rethrows on failure.
  Future<void> update(Preferences next) async {
    final Preferences previous = state;
    if (next == previous) return;
    state = next;
    final SettingsStore store = ref.read(settingsStoreProvider);
    await store.savePreferences(next);
    final String? uid = ref.read(uidProvider);
    if (uid == null) return;
    try {
      await ref.read(profileRepositoryProvider).updatePreferences(uid, next);
    } catch (error) {
      state = previous;
      await store.savePreferences(previous);
      rethrow;
    }
  }
}

final NotifierProvider<PreferencesController, Preferences> preferencesProvider =
    NotifierProvider<PreferencesController, Preferences>(PreferencesController.new);

final Provider<AppFormats> formatsProvider = Provider<AppFormats>((Ref ref) {
  return AppFormats(ref.watch(preferencesProvider.select((Preferences p) => p.localeKey)));
});

// ------------------------------------------------------------------- server

/// What the backend can do right now (`GET /health`). Invalidate to re-check.
final FutureProvider<ServerCapabilities> capabilitiesProvider = FutureProvider<ServerCapabilities>((Ref ref) {
  ref.watch(uidProvider);
  return ref.watch(walletApiProvider).health();
});

final FutureProvider<SecurityStatus> securityStatusProvider = FutureProvider<SecurityStatus>((Ref ref) {
  ref.watch(uidProvider);
  return ref.watch(walletApiProvider).securityStatus();
});
