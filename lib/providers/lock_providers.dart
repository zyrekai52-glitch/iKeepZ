import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_controller.dart';
import 'core_providers.dart';

/// Whether the app is locked. A locked app shows the unlock screen over everything and needs the account password.
class LockController extends Notifier<bool> {
  @override
  bool build() {
    ref.listen<AuthState>(authControllerProvider, (AuthState? previous, AuthState next) {
      if (next.phase != AuthPhase.ready && state) state = false;
    });
    return false;
  }

  void lock() {
    if (ref.read(authControllerProvider).phase == AuthPhase.ready) state = true;
  }

  /// Confirms the password with Firebase (re-authentication) and unlocks. Throws if the password is wrong.
  Future<void> unlock(String password) async {
    await ref.read(authServiceProvider).reauthenticate(password);
    state = false;
  }
}

final NotifierProvider<LockController, bool> lockControllerProvider =
    NotifierProvider<LockController, bool>(LockController.new);

/// Remembers when the person last touched the app (for the auto-lock timer).
class ActivityClock {
  DateTime _last = DateTime.now();

  void touch() {
    _last = DateTime.now();
  }

  Duration idleFor() => DateTime.now().difference(_last);
}

final Provider<ActivityClock> activityClockProvider = Provider<ActivityClock>((Ref ref) => ActivityClock());
