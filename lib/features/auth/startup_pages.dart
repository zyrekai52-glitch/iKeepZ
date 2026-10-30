import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_controller.dart';
import '../../providers/core_providers.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/busy_button.dart';
import '../../shared/widgets/dialogs.dart';
import '../../shared/widgets/states.dart';
import '../../shared/widgets/visuals.dart';
import '../../theme/tokens.dart';
import 'auth_scaffold.dart';

/// First frame while Firebase starts and the previous session is restored.
class StartupPage extends StatelessWidget {
  const StartupPage({super.key});

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const BrandMark(size: 56),
            const SizedBox(height: 14),
            Text('iKeepZ', style: monoStyle(size: 26, weight: FontWeight.w700, color: tokens.text)),
            const SizedBox(height: 22),
            const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5)),
          ],
        ),
      ),
    );
  }
}

/// Shown instead of the app when the build cannot run: no Firebase configuration, an unsupported platform, or a
/// failed start-up. It says exactly what is missing instead of failing later with a confusing error.
class ConfigPage extends ConsumerWidget {
  const ConfigPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppTokens tokens = context.tokens;
    final BootResult? boot = ref.watch(bootstrapProvider).value;
    final BootStatus status = boot?.status ?? BootStatus.failed;
    final List<String> missing = boot?.missing ?? const <String>[];

    String title = 'iKeepZ could not start';
    String subtitle = boot?.message ?? 'Something went wrong while starting.';
    final List<Widget> body = <Widget>[];

    if (status == BootStatus.configMissing) {
      title = 'Configuration required';
      subtitle = 'This build was made without the Firebase project values iKeepZ needs, so it cannot sign anyone in yet.';
      body.addAll(<Widget>[
        const MicroLabel('Missing values'),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: tokens.fill, borderRadius: BorderRadius.circular(kControlRadius)),
          child: SelectableText(missing.join('\n'), style: monoStyle(size: 12.5, color: tokens.text, height: 1.6)),
        ),
        const SizedBox(height: 12),
        Text(
          'Fill them in config/app_config.json (copy config/app_config.example.json) and build again with '
          '--dart-define-from-file=config/app_config.json, or set the matching GitHub Actions secrets. '
          'None of these values is a password; the README explains where to find each one.',
          style: TextStyle(color: tokens.muted, height: 1.45, fontSize: 13),
        ),
        const SizedBox(height: 14),
        OutlinedButton.icon(
          icon: const Icon(Icons.copy_outlined, size: 18),
          label: const Text('Copy the list'),
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: missing.join('\n')));
            if (context.mounted) showToast(context, 'Copied the list of missing values.');
          },
        ),
      ]);
    } else if (status == BootStatus.unsupported) {
      title = 'This device is not supported';
      body.add(Text(
        'iKeepZ is built for Android phones and tablets and for Windows PCs.',
        style: TextStyle(color: tokens.muted, height: 1.45),
      ));
    } else {
      body.addAll(<Widget>[
        BusyButton(
          label: 'Try again',
          icon: Icons.refresh,
          onPressed: () => ref.invalidate(bootstrapProvider),
        ),
      ]);
    }

    return AuthScaffold(
      title: title,
      subtitle: subtitle,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: body),
    );
  }
}

/// Shown while the server creates the profile, wallet and default categories on first sign-in,
/// and when that fails (with a retry).
class SetupPage extends ConsumerWidget {
  const SetupPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthState auth = ref.watch(authControllerProvider);
    final bool failed = auth.phase == AuthPhase.setupFailed;
    final AuthController controller = ref.read(authControllerProvider.notifier);
    if (!failed) {
      return AuthScaffold(
        title: 'Setting up your account',
        subtitle: 'Creating your profile, wallet and starter categories. This only happens once.',
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 10),
          child: Center(child: SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 2.5))),
        ),
      );
    }
    return AuthScaffold(
      title: 'Could not finish setting up',
      subtitle: 'You are signed in, but the server did not answer.',
      footer: TextButton(onPressed: controller.signOut, child: const Text('Sign out')),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          InlineNotice(message: auth.error ?? 'Something went wrong. Please try again.', tone: 'error'),
          const SizedBox(height: 16),
          BusyButton(label: 'Try again', icon: Icons.refresh, onPressed: controller.retrySetUp),
        ],
      ),
    );
  }
}
