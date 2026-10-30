import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors/error_messages.dart';
import '../models/preferences.dart';
import '../providers/auth_controller.dart';
import '../providers/data_providers.dart';
import '../providers/lock_providers.dart';
import '../shared/widgets/dialogs.dart';

// Actions shared by the sidebar, the top bar and the command palette. They take the app's ProviderContainer
// (not a WidgetRef) so they keep working after the widget that started them has closed, for example the palette.

/// Switches between the light and the dark theme and saves the choice to the account.
Future<void> toggleThemeMode(BuildContext context, ProviderContainer container) async {
  final bool isDark = Theme.of(context).brightness == Brightness.dark;
  final Preferences prefs = container.read(preferencesProvider);
  try {
    await container.read(preferencesProvider.notifier).update(prefs.copyWith(theme: isDark ? 'light' : 'dark'));
  } catch (error) {
    if (context.mounted) showToast(context, friendlyError(error), error: true);
  }
}

/// Asks first, then signs out.
Future<void> confirmAndSignOut(BuildContext context, ProviderContainer container) async {
  final bool confirmed = await confirmAction(
    context,
    title: 'Sign out?',
    message: 'You will need your email and password to sign in again.',
    confirmLabel: 'Sign out',
  );
  if (!confirmed) return;
  try {
    await container.read(authControllerProvider.notifier).signOut();
  } catch (error) {
    if (context.mounted) showToast(context, friendlyError(error), error: true);
  }
}

void lockApp(ProviderContainer container) {
  container.read(lockControllerProvider.notifier).lock();
}
