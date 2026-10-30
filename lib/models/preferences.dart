import 'package:flutter/material.dart';

import '../core/utils/json.dart';
import 'preference_values.dart';

/// The user's appearance, regional and privacy settings. Stored in `users/{uid}.preferences`
/// (the Firestore rules accept exactly these keys) and mirrored in local storage so the theme is right before sign-in.
class Preferences {
  const Preferences({
    required this.theme,
    required this.accent,
    required this.fontScale,
    required this.localeKey,
    required this.displayCurrency,
    required this.autoLockMinutes,
    required this.walletNotifications,
  });

  static const Preferences defaults = Preferences(
    theme: 'system',
    accent: 'slate',
    fontScale: 'medium',
    localeKey: 'en_PH',
    displayCurrency: 'PHP',
    autoLockMinutes: 0,
    walletNotifications: true,
  );

  factory Preferences.fromMap(Object? raw) {
    final Map<String, dynamic> map = readMap(raw);
    final Map<String, dynamic> notifications = readMap(map['notifications']);
    final String currency = readString(map['displayCurrency'], defaults.displayCurrency);
    return Preferences(
      theme: readChoice(map['theme'], kThemeModes, defaults.theme),
      accent: readChoice(map['accent'], kAccentKeys, defaults.accent),
      fontScale: readChoice(map['fontScale'], kFontScaleKeys, defaults.fontScale),
      localeKey: readChoice(map['locale'], kLocaleKeys, defaults.localeKey),
      displayCurrency: RegExp(r'^[A-Z]{3}$').hasMatch(currency) ? currency : defaults.displayCurrency,
      autoLockMinutes: clampInt(readInt(map['autoLockMinutes']), 0, 120),
      walletNotifications: readBool(notifications['wallet'], true),
    );
  }

  final String theme;
  final String accent;
  final String fontScale;
  final String localeKey;
  final String displayCurrency;
  final int autoLockMinutes;
  final bool walletNotifications;

  /// Exactly the keys the Firestore rules require.
  Map<String, Object?> toMap() {
    return <String, Object?>{
      'theme': theme,
      'accent': accent,
      'fontScale': fontScale,
      'locale': localeKey,
      'displayCurrency': displayCurrency,
      'autoLockMinutes': autoLockMinutes,
      'notifications': <String, Object?>{'wallet': walletNotifications},
    };
  }

  Preferences copyWith({
    String? theme,
    String? accent,
    String? fontScale,
    String? localeKey,
    String? displayCurrency,
    int? autoLockMinutes,
    bool? walletNotifications,
  }) {
    return Preferences(
      theme: theme ?? this.theme,
      accent: accent ?? this.accent,
      fontScale: fontScale ?? this.fontScale,
      localeKey: localeKey ?? this.localeKey,
      displayCurrency: displayCurrency ?? this.displayCurrency,
      autoLockMinutes: autoLockMinutes ?? this.autoLockMinutes,
      walletNotifications: walletNotifications ?? this.walletNotifications,
    );
  }

  ThemeMode get themeMode {
    switch (theme) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }

  Locale get flutterLocale {
    final int cut = localeKey.indexOf('_');
    if (cut < 0) return Locale(localeKey);
    return Locale(localeKey.substring(0, cut), localeKey.substring(cut + 1));
  }

  double get textScale {
    switch (fontScale) {
      case 'small':
        return 0.92;
      case 'large':
        return 1.15;
      default:
        return 1.0;
    }
  }

  @override
  bool operator ==(Object other) {
    return other is Preferences &&
        other.theme == theme &&
        other.accent == accent &&
        other.fontScale == fontScale &&
        other.localeKey == localeKey &&
        other.displayCurrency == displayCurrency &&
        other.autoLockMinutes == autoLockMinutes &&
        other.walletNotifications == walletNotifications;
  }

  @override
  int get hashCode => Object.hash(theme, accent, fontScale, localeKey, displayCurrency, autoLockMinutes, walletNotifications);
}
