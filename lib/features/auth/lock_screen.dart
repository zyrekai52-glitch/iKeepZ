import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/error_messages.dart';
import '../../providers/auth_controller.dart';
import '../../providers/lock_providers.dart';
import '../../shared/widgets/busy_button.dart';
import '../../shared/widgets/form_widgets.dart';
import '../../shared/widgets/states.dart';
import '../../theme/tokens.dart';
import 'auth_scaffold.dart';

/// Covers the whole app (including open dialogs) until the account password is entered again.
class LockScreen extends ConsumerStatefulWidget {
  const LockScreen({super.key});

  @override
  ConsumerState<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<LockScreen> {
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    if (_busy) return;
    if (_password.text.isEmpty) {
      setState(() {
        _error = 'Enter your password.';
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(lockControllerProvider.notifier).unlock(_password.text);
      _password.clear();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = friendlyError(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final String email = ref.watch(authControllerProvider).user?.email ?? '';
    return PopScope(
      canPop: false,
      child: AuthScaffold(
        title: 'iKeepZ is locked',
        subtitle: email.isEmpty ? 'Enter your password to continue.' : 'Enter the password for $email to continue.',
        footer: TextButton(
          onPressed: _busy ? null : () => ref.read(authControllerProvider.notifier).signOut(),
          child: Text('Sign out instead', style: TextStyle(color: tokens.muted)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PasswordField(
              controller: _password,
              autofocus: true,
              textInputAction: TextInputAction.done,
              onSubmitted: (String _) => _unlock(),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 14),
              InlineNotice(message: _error!, tone: 'error'),
            ],
            const SizedBox(height: 18),
            BusyButton(label: 'Unlock', icon: Icons.lock_open_outlined, busy: _busy, busyLabel: 'Checking…', onPressed: _unlock),
          ],
        ),
      ),
    );
  }
}
