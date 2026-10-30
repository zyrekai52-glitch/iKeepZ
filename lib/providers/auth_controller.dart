import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors/error_messages.dart';
import '../services/auth_service.dart';
import '../services/settings_store.dart';
import '../services/wallet_api.dart';
import 'core_providers.dart';

/// Where the person is in the sign-in journey. The router redirects on this, never on a timer.
enum AuthPhase {
  /// Firebase is still starting or restoring the previous session.
  initializing,
  signedOut,

  /// Signed in; creating the profile, wallet and default categories on the server (`POST /bootstrap`).
  settingUp,
  setupFailed,

  /// The account exists but the email address has not been verified yet.
  needsVerification,
  ready,
}

@immutable
class AuthState {
  const AuthState({required this.phase, this.user, this.error, this.isAdmin = false});

  final AuthPhase phase;
  final AuthUser? user;
  final String? error;
  final bool isAdmin;

  bool get isReady => phase == AuthPhase.ready;

  AuthState copyWith({AuthPhase? phase, AuthUser? user, bool? isAdmin}) {
    return AuthState(phase: phase ?? this.phase, user: user ?? this.user, error: error, isAdmin: isAdmin ?? this.isAdmin);
  }

  @override
  bool operator ==(Object other) {
    return other is AuthState &&
        other.phase == phase &&
        other.user == user &&
        other.error == error &&
        other.isAdmin == isAdmin;
  }

  @override
  int get hashCode => Object.hash(phase, user, error, isAdmin);
}

class AuthController extends Notifier<AuthState> {
  StreamSubscription<AuthUser?>? _subscription;
  String? _pendingDisplayName;
  int _setupToken = 0;
  bool _setupRunning = false;

  @override
  AuthState build() {
    ref.onDispose(() {
      _setupToken += 1;
      _subscription?.cancel();
      _subscription = null;
    });
    final BootResult? boot = ref.watch(bootstrapProvider).value;
    if (boot == null || !boot.isReady) return const AuthState(phase: AuthPhase.initializing);
    final AuthService service = ref.watch(authServiceProvider);
    _subscription?.cancel();
    _subscription = service.userChanges().listen(_onUser);
    final AuthUser? current = service.currentUser;
    if (current == null) return const AuthState(phase: AuthPhase.signedOut);
    return AuthState(phase: AuthPhase.settingUp, user: current);
  }

  void _onUser(AuthUser? user) {
    if (user == null) {
      _setupToken += 1;
      _setupRunning = false;
      state = const AuthState(phase: AuthPhase.signedOut);
      return;
    }
    final AuthState current = state;
    final AuthUser? known = current.user;
    final bool sameUser = known != null && known.uid == user.uid;
    if (sameUser && (current.phase == AuthPhase.ready || current.phase == AuthPhase.needsVerification)) {
      state = AuthState(
        phase: user.emailVerified ? AuthPhase.ready : AuthPhase.needsVerification,
        user: user,
        isAdmin: current.isAdmin,
      );
      return;
    }
    if (sameUser && _setupRunning) {
      state = AuthState(phase: AuthPhase.settingUp, user: user, isAdmin: current.isAdmin);
      return;
    }
    unawaited(_setUp(user));
  }

  Future<void> _setUp(AuthUser user) async {
    _setupToken += 1;
    final int token = _setupToken;
    _setupRunning = true;
    state = AuthState(phase: AuthPhase.settingUp, user: user);
    final SettingsStore settings = ref.read(settingsStoreProvider);
    final WalletApi api = ref.read(walletApiProvider);
    final String? name = _pendingDisplayName ?? user.displayName;
    try {
      if (settings.isBootstrapped(user.uid)) {
        // Already set up on this device: go straight in (works offline) and re-confirm in the background.
        unawaited(_confirmInBackground(api, name));
      } else {
        await api.bootstrap(displayName: name);
        await settings.markBootstrapped(user.uid);
      }
    } catch (error) {
      if (token != _setupToken) return;
      _setupRunning = false;
      state = AuthState(phase: AuthPhase.setupFailed, user: user, error: friendlyError(error));
      return;
    }
    if (token != _setupToken) return;
    final AuthService service = ref.read(authServiceProvider);
    bool admin = false;
    try {
      admin = await service.isAdmin();
    } catch (error) {
      debugPrint('Could not read the admin claim: $error');
    }
    if (token != _setupToken) return;
    _pendingDisplayName = null;
    _setupRunning = false;
    final AuthUser latest = service.currentUser ?? user;
    state = AuthState(
      phase: latest.emailVerified ? AuthPhase.ready : AuthPhase.needsVerification,
      user: latest,
      isAdmin: admin,
    );
  }

  Future<void> _confirmInBackground(WalletApi api, String? name) async {
    try {
      await api.bootstrap(displayName: name);
    } catch (error) {
      debugPrint('Background bootstrap check failed: $error');
    }
  }

  /// Tries the server set-up again after a failure.
  Future<void> retrySetUp() async {
    final AuthUser? user = state.user ?? ref.read(authServiceProvider).currentUser;
    if (user == null) return;
    await _setUp(user);
  }

  Future<void> signIn({required String email, required String password}) async {
    await ref.read(authServiceProvider).signIn(email: email, password: password);
    await ref.read(settingsStoreProvider).saveLastEmail(email.trim());
  }

  Future<void> register({required String email, required String password, required String displayName}) async {
    _pendingDisplayName = displayName.trim();
    try {
      await ref.read(authServiceProvider).register(email: email, password: password, displayName: displayName);
      await ref.read(settingsStoreProvider).saveLastEmail(email.trim());
    } catch (error) {
      _pendingDisplayName = null;
      rethrow;
    }
  }

  Future<void> sendPasswordReset(String email) => ref.read(authServiceProvider).sendPasswordReset(email);

  Future<void> resendVerification() => ref.read(authServiceProvider).sendVerificationEmail();

  /// Re-reads the account from the server. Returns true when the email address is now verified.
  Future<bool> refreshVerification() async {
    final AuthService service = ref.read(authServiceProvider);
    await service.reloadUser();
    final AuthUser? user = service.currentUser;
    if (user == null) return false;
    if (!user.emailVerified) {
      state = state.copyWith(user: user);
      return false;
    }
    bool admin = state.isAdmin;
    try {
      admin = await service.isAdmin();
    } catch (error) {
      debugPrint('Could not read the admin claim: $error');
    }
    state = AuthState(phase: AuthPhase.ready, user: user, isAdmin: admin);
    return true;
  }

  Future<void> signOut() => ref.read(authServiceProvider).signOut();
}

final NotifierProvider<AuthController, AuthState> authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);

/// The uid of the signed-in person once the account is fully set up, otherwise null. Data streams key off this.
final Provider<String?> uidProvider = Provider<String?>((Ref ref) {
  return ref.watch(authControllerProvider.select((AuthState s) => s.phase == AuthPhase.ready ? s.user?.uid : null));
});

final Provider<bool> isAdminProvider = Provider<bool>((Ref ref) {
  return ref.watch(authControllerProvider.select((AuthState s) => s.isAdmin && s.phase == AuthPhase.ready));
});
