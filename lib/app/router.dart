import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/forgot_page.dart';
import '../features/auth/login_page.dart';
import '../features/auth/register_page.dart';
import '../features/auth/startup_pages.dart';
import '../features/auth/verify_page.dart';
import '../features/pending_page.dart';
import '../providers/auth_controller.dart';
import '../providers/core_providers.dart';
import '../shared/widgets/states.dart';
import 'shell.dart';

/// Where signed-in people land.
const String kHomePath = '/dashboard';

/// Pages a signed-out person may open.
const Set<String> kSignedOutPaths = <String>{'/login', '/register', '/forgot'};

/// Pages that only make sense before sign-in is complete. Once the account is ready they all lead to the dashboard.
const Set<String> kGatePaths = <String>{'/', '/startup', '/config', '/login', '/register', '/forgot', '/setup', '/verify'};

/// Decides where the app must be for the current start-up and sign-in state. Returns null to stay where we are.
/// A pure function so every branch can be unit-tested.
String? appRedirect({required BootResult? boot, required AuthState auth, required String location}) {
  final String path = Uri.parse(location).path;
  if (boot == null) return path == '/startup' ? null : '/startup';
  if (!boot.isReady) return path == '/config' ? null : '/config';
  switch (auth.phase) {
    case AuthPhase.initializing:
      return path == '/startup' ? null : '/startup';
    case AuthPhase.signedOut:
      return kSignedOutPaths.contains(path) ? null : '/login';
    case AuthPhase.settingUp:
    case AuthPhase.setupFailed:
      return path == '/setup' ? null : '/setup';
    case AuthPhase.needsVerification:
      return path == '/verify' ? null : '/verify';
    case AuthPhase.ready:
      if (kGatePaths.contains(path)) return kHomePath;
      if (path == '/admin' && !auth.isAdmin) return kHomePath;
      return null;
  }
}

/// Re-runs the router's redirect whenever start-up or sign-in state changes.
class _RouterRefresh extends ChangeNotifier {
  _RouterRefresh(Ref ref) {
    ref.listen<AsyncValue<BootResult>>(bootstrapProvider, (AsyncValue<BootResult>? previous, AsyncValue<BootResult> next) => _ping());
    ref.listen<AuthState>(authControllerProvider, (AuthState? previous, AuthState next) => _ping());
  }

  bool _closed = false;

  void _ping() {
    if (!_closed) notifyListeners();
  }

  @override
  void dispose() {
    _closed = true;
    super.dispose();
  }
}

Page<void> _fade(GoRouterState state, Widget child) {
  return CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionDuration: const Duration(milliseconds: 180),
    transitionsBuilder: (BuildContext context, Animation<double> animation, Animation<double> secondaryAnimation, Widget child) {
      return FadeTransition(opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut), child: child);
    },
  );
}

GoRoute _outside(String path, Widget Function() build) {
  return GoRoute(
    path: path,
    pageBuilder: (BuildContext context, GoRouterState state) => _fade(state, build()),
  );
}

GoRoute _section(String path, Widget Function() build) {
  return GoRoute(
    path: path,
    pageBuilder: (BuildContext context, GoRouterState state) => NoTransitionPage<void>(key: state.pageKey, child: build()),
  );
}

class _NotFoundPage extends StatelessWidget {
  const _NotFoundPage({required this.location});

  final String location;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: EmptyState(
        icon: Icons.explore_off_outlined,
        title: 'Page not found',
        message: 'There is nothing at $location.',
        actionLabel: 'Go to the dashboard',
        onAction: () => context.go(kHomePath),
      ),
    );
  }
}

final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  final _RouterRefresh refresh = _RouterRefresh(ref);
  final GoRouter router = GoRouter(
    initialLocation: '/startup',
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) {
      return appRedirect(
        boot: ref.read(bootstrapProvider).value,
        auth: ref.read(authControllerProvider),
        location: state.uri.toString(),
      );
    },
    errorPageBuilder: (BuildContext context, GoRouterState state) => _fade(state, _NotFoundPage(location: state.uri.path)),
    routes: <RouteBase>[
      _outside('/', () => const StartupPage()),
      _outside('/startup', () => const StartupPage()),
      _outside('/config', () => const ConfigPage()),
      _outside('/login', () => const LoginPage()),
      _outside('/register', () => const RegisterPage()),
      _outside('/forgot', () => const ForgotPage()),
      _outside('/setup', () => const SetupPage()),
      _outside('/verify', () => const VerifyPage()),
      ShellRoute(
        pageBuilder: (BuildContext context, GoRouterState state, Widget child) {
          return NoTransitionPage<void>(child: AppShell(location: state.uri.path, child: child));
        },
        routes: <RouteBase>[
          _section('/dashboard', () => const PendingSectionPage(title: 'Dashboard')),
          _section('/analytics', () => const PendingSectionPage(title: 'Analytics')),
          _section('/records', () => const PendingSectionPage(title: 'Records')),
          _section('/categories', () => const PendingSectionPage(title: 'Categories')),
          _section('/reports', () => const PendingSectionPage(title: 'Reports')),
          _section('/wallet', () => const PendingSectionPage(title: 'E-Wallet')),
          _section('/notifications', () => const PendingSectionPage(title: 'Notifications')),
          _section('/profile', () => const PendingSectionPage(title: 'Profile')),
          _section('/security', () => const PendingSectionPage(title: 'Security')),
          _section('/settings', () => const PendingSectionPage(title: 'Settings')),
          _section('/help', () => const PendingSectionPage(title: 'Help & Support')),
          _section('/about', () => const PendingSectionPage(title: 'About')),
          _section('/admin', () => const PendingSectionPage(title: 'Wallet admin')),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    refresh.dispose();
  });
  return router;
});
