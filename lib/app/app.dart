import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/lock_screen.dart';
import '../models/preference_values.dart';
import '../models/preferences.dart';
import '../providers/auth_controller.dart';
import '../providers/data_providers.dart';
import '../providers/lock_providers.dart';
import '../theme/app_theme.dart';
import 'router.dart';

/// The root widget: theme, language and text size come from the saved preferences.
class IkeepzApp extends ConsumerWidget {
  const IkeepzApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Preferences prefs = ref.watch(preferencesProvider);
    final GoRouter router = ref.watch(routerProvider);
    final List<Locale> locales = <Locale>[
      for (final String key in kLocaleKeys) Preferences.defaults.copyWith(localeKey: key).flutterLocale,
    ];
    return MaterialApp.router(
      title: 'iKeepZ',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(brightness: Brightness.light, accent: prefs.accent),
      darkTheme: buildAppTheme(brightness: Brightness.dark, accent: prefs.accent),
      themeMode: prefs.themeMode,
      locale: prefs.flutterLocale,
      supportedLocales: locales,
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: router,
      builder: (BuildContext context, Widget? child) {
        return AppGate(textScale: prefs.textScale, child: child ?? const SizedBox.shrink());
      },
    );
  }
}

/// Sits above every page: applies the text-size preference, watches for inactivity (auto-lock) and covers the
/// whole app with the lock screen while it is locked.
class AppGate extends ConsumerStatefulWidget {
  const AppGate({super.key, required this.child, required this.textScale});

  final Widget child;
  final double textScale;

  @override
  ConsumerState<AppGate> createState() => _AppGateState();
}

class _AppGateState extends ConsumerState<AppGate> with WidgetsBindingObserver {
  Timer? _timer;
  DateTime? _backgroundedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    HardwareKeyboard.instance.addHandler(_onKey);
    _timer = Timer.periodic(const Duration(seconds: 10), (Timer timer) => _checkIdle());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    HardwareKeyboard.instance.removeHandler(_onKey);
    _timer?.cancel();
    super.dispose();
  }

  bool _onKey(KeyEvent event) {
    ref.read(activityClockProvider).touch();
    return false;
  }

  bool get _signedIn => ref.read(authControllerProvider).phase == AuthPhase.ready;

  void _checkIdle() {
    final int minutes = ref.read(preferencesProvider).autoLockMinutes;
    if (minutes <= 0 || !_signedIn) return;
    if (ref.read(activityClockProvider).idleFor() >= Duration(minutes: minutes)) {
      ref.read(lockControllerProvider.notifier).lock();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _backgroundedAt = DateTime.now();
      return;
    }
    if (state != AppLifecycleState.resumed) return;
    final DateTime? since = _backgroundedAt;
    _backgroundedAt = null;
    final int minutes = ref.read(preferencesProvider).autoLockMinutes;
    if (since != null && minutes > 0 && _signedIn && DateTime.now().difference(since) >= Duration(minutes: minutes)) {
      ref.read(lockControllerProvider.notifier).lock();
    }
    ref.read(activityClockProvider).touch();
  }

  @override
  Widget build(BuildContext context) {
    final bool locked = ref.watch(lockControllerProvider);
    final ActivityClock clock = ref.read(activityClockProvider);
    final double system = MediaQuery.textScalerOf(context).scale(1.0);
    final double factor = (system * widget.textScale).clamp(0.8, 2.0).toDouble();
    return MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(factor)),
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (PointerEvent event) => clock.touch(),
        onPointerMove: (PointerEvent event) => clock.touch(),
        onPointerSignal: (PointerEvent event) => clock.touch(),
        child: Stack(
          children: <Widget>[
            Positioned.fill(child: widget.child),
            // The lock screen has its own Overlay because this widget sits above the router's Navigator.
            if (locked) Positioned.fill(child: Overlay.wrap(child: const LockScreen())),
          ],
        ),
      ),
    );
  }
}
