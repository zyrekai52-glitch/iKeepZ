import 'package:flutter/material.dart';

import '../models/wallet_tx.dart' show StatusTone;

const String kMonoFont = 'JetBrainsMono';

const double kCardRadius = 10;
const double kModalRadius = 12;
const double kControlRadius = 8;

/// The seed colours of the six accents (light mode). Dark mode uses lightened versions.
const Map<String, Color> kAccentColors = <String, Color>{
  'slate': Color(0xFF3F6A85),
  'sage': Color(0xFF4F7D5F),
  'clay': Color(0xFFA85A40),
  'moss': Color(0xFF5F7233),
  'stone': Color(0xFF6B675F),
  'dusk': Color(0xFF6A5A8E),
};

Color accentFor(String key, Brightness brightness) {
  final Color base = kAccentColors[key] ?? kAccentColors['slate']!;
  if (brightness == Brightness.light) return base;
  final HSLColor hsl = HSLColor.fromColor(base);
  return hsl.withLightness(0.68).withSaturation(hsl.saturation < 0.5 ? hsl.saturation + 0.1 : hsl.saturation).toColor();
}

/// Design tokens (colours that are not part of Material's ColorScheme), available as `context.tokens`.
@immutable
class AppTokens extends ThemeExtension<AppTokens> {
  const AppTokens({
    required this.page,
    required this.surface,
    required this.fill,
    required this.border,
    required this.selected,
    required this.text,
    required this.muted,
    required this.primary,
    required this.onPrimary,
    required this.success,
    required this.successBg,
    required this.warning,
    required this.warningBg,
    required this.danger,
    required this.dangerBg,
    required this.income,
    required this.expense,
  });

  factory AppTokens.forAccent({required String accent, required Brightness brightness}) {
    final Color primary = accentFor(accent, brightness);
    if (brightness == Brightness.light) {
      return AppTokens(
        page: const Color(0xFFF6F7F9),
        surface: const Color(0xFFFFFFFF),
        fill: const Color(0xFFF3F4F6),
        border: const Color(0xFFE5E7EB),
        selected: Color.alphaBlend(primary.withValues(alpha: 0.13), const Color(0xFFFFFFFF)),
        text: const Color(0xFF1B2430),
        muted: const Color(0xFF6B7580),
        primary: primary,
        onPrimary: const Color(0xFFFFFFFF),
        success: const Color(0xFF2F8F4E),
        successBg: const Color(0xFFDDF2E3),
        warning: const Color(0xFFB7791F),
        warningBg: const Color(0xFFFBEFD0),
        danger: const Color(0xFFC53030),
        dangerBg: const Color(0xFFFBDADA),
        income: const Color(0xFF2F8F4E),
        expense: const Color(0xFFC2410C),
      );
    }
    return AppTokens(
      page: const Color(0xFF0E1013),
      surface: const Color(0xFF1A1E23),
      fill: const Color(0xFF232830),
      border: const Color(0xFF2A2F36),
      selected: Color.alphaBlend(primary.withValues(alpha: 0.18), const Color(0xFF1A1E23)),
      text: const Color(0xFFE6E8EB),
      muted: const Color(0xFF98A2AD),
      primary: primary,
      onPrimary: const Color(0xFF0E1013),
      success: const Color(0xFF5CC283),
      successBg: const Color(0xFF173222),
      warning: const Color(0xFFE0A93E),
      warningBg: const Color(0xFF3A2D12),
      danger: const Color(0xFFF08080),
      dangerBg: const Color(0xFF3B1A1A),
      income: const Color(0xFF5CC283),
      expense: const Color(0xFFF08A5D),
    );
  }

  final Color page;
  final Color surface;
  final Color fill;
  final Color border;
  final Color selected;
  final Color text;
  final Color muted;
  final Color primary;
  final Color onPrimary;
  final Color success;
  final Color successBg;
  final Color warning;
  final Color warningBg;
  final Color danger;
  final Color dangerBg;
  final Color income;
  final Color expense;

  @override
  AppTokens copyWith({
    Color? page,
    Color? surface,
    Color? fill,
    Color? border,
    Color? selected,
    Color? text,
    Color? muted,
    Color? primary,
    Color? onPrimary,
    Color? success,
    Color? successBg,
    Color? warning,
    Color? warningBg,
    Color? danger,
    Color? dangerBg,
    Color? income,
    Color? expense,
  }) {
    return AppTokens(
      page: page ?? this.page,
      surface: surface ?? this.surface,
      fill: fill ?? this.fill,
      border: border ?? this.border,
      selected: selected ?? this.selected,
      text: text ?? this.text,
      muted: muted ?? this.muted,
      primary: primary ?? this.primary,
      onPrimary: onPrimary ?? this.onPrimary,
      success: success ?? this.success,
      successBg: successBg ?? this.successBg,
      warning: warning ?? this.warning,
      warningBg: warningBg ?? this.warningBg,
      danger: danger ?? this.danger,
      dangerBg: dangerBg ?? this.dangerBg,
      income: income ?? this.income,
      expense: expense ?? this.expense,
    );
  }

  @override
  AppTokens lerp(ThemeExtension<AppTokens>? other, double t) {
    if (other is! AppTokens) return this;
    return AppTokens(
      page: Color.lerp(page, other.page, t) ?? page,
      surface: Color.lerp(surface, other.surface, t) ?? surface,
      fill: Color.lerp(fill, other.fill, t) ?? fill,
      border: Color.lerp(border, other.border, t) ?? border,
      selected: Color.lerp(selected, other.selected, t) ?? selected,
      text: Color.lerp(text, other.text, t) ?? text,
      muted: Color.lerp(muted, other.muted, t) ?? muted,
      primary: Color.lerp(primary, other.primary, t) ?? primary,
      onPrimary: Color.lerp(onPrimary, other.onPrimary, t) ?? onPrimary,
      success: Color.lerp(success, other.success, t) ?? success,
      successBg: Color.lerp(successBg, other.successBg, t) ?? successBg,
      warning: Color.lerp(warning, other.warning, t) ?? warning,
      warningBg: Color.lerp(warningBg, other.warningBg, t) ?? warningBg,
      danger: Color.lerp(danger, other.danger, t) ?? danger,
      dangerBg: Color.lerp(dangerBg, other.dangerBg, t) ?? dangerBg,
      income: Color.lerp(income, other.income, t) ?? income,
      expense: Color.lerp(expense, other.expense, t) ?? expense,
    );
  }

  /// Foreground and background colours for a status tone.
  ToneColors toneColors(StatusTone tone) {
    switch (tone) {
      case StatusTone.success:
        return ToneColors(success, successBg);
      case StatusTone.warning:
        return ToneColors(warning, warningBg);
      case StatusTone.danger:
        return ToneColors(danger, dangerBg);
      case StatusTone.neutral:
        return ToneColors(muted, fill);
    }
  }
}

class ToneColors {
  const ToneColors(this.foreground, this.background);

  final Color foreground;
  final Color background;
}

extension AppTokensContext on BuildContext {
  AppTokens get tokens {
    final AppTokens? found = Theme.of(this).extension<AppTokens>();
    return found ?? AppTokens.forAccent(accent: 'slate', brightness: Theme.of(this).brightness);
  }
}

/// Monospace style used for titles, labels, buttons and numbers.
TextStyle monoStyle({double size = 14, FontWeight weight = FontWeight.w500, Color? color, double? letterSpacing, double? height}) {
  return TextStyle(
    fontFamily: kMonoFont,
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
  );
}
