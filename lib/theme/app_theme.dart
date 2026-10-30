import 'package:flutter/material.dart';

import 'tokens.dart';

/// Builds the light or dark Material 3 theme for [accent] (one of `slate`, `sage`, `clay`, `moss`, `stone`, `dusk`).
ThemeData buildAppTheme({required Brightness brightness, required String accent}) {
  final AppTokens tokens = AppTokens.forAccent(accent: accent, brightness: brightness);
  final ColorScheme scheme = ColorScheme.fromSeed(seedColor: tokens.primary, brightness: brightness).copyWith(
    primary: tokens.primary,
    onPrimary: tokens.onPrimary,
    primaryContainer: tokens.selected,
    onPrimaryContainer: tokens.primary,
    secondary: tokens.primary,
    onSecondary: tokens.onPrimary,
    secondaryContainer: tokens.selected,
    onSecondaryContainer: tokens.primary,
    error: tokens.danger,
    onError: brightness == Brightness.light ? Colors.white : const Color(0xFF1B0B0B),
    surface: tokens.surface,
    onSurface: tokens.text,
    onSurfaceVariant: tokens.muted,
    surfaceContainerLowest: tokens.surface,
    surfaceContainerLow: tokens.surface,
    surfaceContainer: tokens.fill,
    surfaceContainerHigh: tokens.fill,
    surfaceContainerHighest: tokens.fill,
    outline: tokens.border,
    outlineVariant: tokens.border,
  );

  final TextTheme baseText = ThemeData(brightness: brightness).textTheme;
  final TextTheme textTheme = baseText
      .copyWith(
        displaySmall: monoStyle(size: 30, weight: FontWeight.w700),
        headlineMedium: monoStyle(size: 24, weight: FontWeight.w700),
        headlineSmall: monoStyle(size: 20, weight: FontWeight.w700),
        titleLarge: monoStyle(size: 18, weight: FontWeight.w700),
        titleMedium: monoStyle(size: 15, weight: FontWeight.w600),
        titleSmall: monoStyle(size: 13, weight: FontWeight.w600),
        labelLarge: monoStyle(size: 13, weight: FontWeight.w600),
        labelMedium: monoStyle(size: 12, weight: FontWeight.w500),
        labelSmall: monoStyle(size: 10, weight: FontWeight.w600, letterSpacing: 0.8),
        bodyLarge: const TextStyle(fontSize: 15, height: 1.4),
        bodyMedium: const TextStyle(fontSize: 14, height: 1.4),
        bodySmall: const TextStyle(fontSize: 12, height: 1.35),
      )
      .apply(displayColor: tokens.text, bodyColor: tokens.text);

  final BorderRadius controlRadius = BorderRadius.circular(kControlRadius);
  final OutlineInputBorder noBorder = OutlineInputBorder(borderRadius: controlRadius, borderSide: BorderSide.none);
  final ButtonStyle buttonShape = ButtonStyle(
    shape: WidgetStatePropertyAll<OutlinedBorder>(RoundedRectangleBorder(borderRadius: controlRadius)),
    textStyle: WidgetStatePropertyAll<TextStyle>(monoStyle(size: 13, weight: FontWeight.w600)),
    minimumSize: const WidgetStatePropertyAll<Size>(Size(64, 42)),
    padding: const WidgetStatePropertyAll<EdgeInsetsGeometry>(EdgeInsets.symmetric(horizontal: 18, vertical: 12)),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: tokens.page,
    canvasColor: tokens.surface,
    dividerColor: tokens.border,
    textTheme: textTheme,
    visualDensity: VisualDensity.adaptivePlatformDensity,
    extensions: <ThemeExtension<dynamic>>[tokens],
    dividerTheme: DividerThemeData(color: tokens.border, thickness: 1, space: 1),
    cardTheme: CardThemeData(
      color: tokens.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kCardRadius),
        side: BorderSide(color: tokens.border),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: tokens.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kModalRadius),
        side: BorderSide(color: tokens.border),
      ),
      titleTextStyle: monoStyle(size: 16, weight: FontWeight.w700, color: tokens.text),
    ),
    inputDecorationTheme: InputDecorationThemeData(
      filled: true,
      fillColor: tokens.fill,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
      border: noBorder,
      enabledBorder: noBorder,
      disabledBorder: noBorder,
      focusedBorder: OutlineInputBorder(borderRadius: controlRadius, borderSide: BorderSide(color: tokens.primary, width: 1.5)),
      errorBorder: OutlineInputBorder(borderRadius: controlRadius, borderSide: BorderSide(color: tokens.danger)),
      focusedErrorBorder: OutlineInputBorder(borderRadius: controlRadius, borderSide: BorderSide(color: tokens.danger, width: 1.5)),
      hintStyle: TextStyle(color: tokens.muted),
      errorStyle: TextStyle(color: tokens.danger, fontSize: 12),
      helperStyle: TextStyle(color: tokens.muted, fontSize: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: buttonShape.merge(
        FilledButton.styleFrom(backgroundColor: tokens.primary, foregroundColor: tokens.onPrimary, elevation: 0),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: buttonShape.merge(
        OutlinedButton.styleFrom(foregroundColor: tokens.text, side: BorderSide(color: tokens.border)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: buttonShape.merge(TextButton.styleFrom(foregroundColor: tokens.primary)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: brightness == Brightness.light ? const Color(0xFF1B2430) : const Color(0xFFE6E8EB),
      contentTextStyle: TextStyle(
        color: brightness == Brightness.light ? Colors.white : const Color(0xFF0E1013),
        fontSize: 14,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kControlRadius)),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: tokens.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kControlRadius),
        side: BorderSide(color: tokens.border),
      ),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: tokens.text, borderRadius: BorderRadius.circular(6)),
      textStyle: TextStyle(color: tokens.surface, fontSize: 12),
    ),
    listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.symmetric(horizontal: 16)),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: tokens.primary, linearTrackColor: tokens.fill),
  );
}
