import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/error_messages.dart';
import '../../providers/auth_controller.dart';
import '../../services/auth_service.dart';
import '../../shared/widgets/busy_button.dart';
import '../../shared/widgets/states.dart';
import '../../theme/tokens.dart';
import 'auth_scaffold.dart';

/// Shown after registration (or on a later sign-in) until the email address is confirmed. The wallet and records
/// stay locked until then. The page re-checks every few seconds, so confirming in a mail app moves the person on.
class VerifyPage extends ConsumerStatefulWidget {
  const VerifyPage({super.key});

  @override
  ConsumerState<VerifyPage> createState() => _VerifyPageState();
}

class _VerifyPageState extends ConsumerState<VerifyPage> {
  static const int _cooldownSeconds = 60;

  Timer? _poll;
  Timer? _tick;
  bool _checking = false;
  bool _pollBusy = false;
  bool _resending = false;
  int _cooldown = 0;
  String? _message;
  String _tone = 'info';

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 5), (Timer timer) => _checkQuietly());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  /// Background re-check: no spinner and no message, the router moves on by itself once the address is confirmed.
  Future<void> _checkQuietly() async {
    if (_checking || _pollBusy) return;
    _pollBusy = true;
    try {
      await ref.read(authControllerProvider.notifier).refreshVerification();
    } catch (error) {
      debugPrint('Background verification check failed: $error');
    } finally {
      _pollBusy = false;
    }
  }

  Future<void> _check() async {
    if (_checking) return;
    setState(() {
      _checking = true;
      _message = null;
    });
    try {
      final bool verified = await ref.read(authControllerProvider.notifier).refreshVerification();
      if (!mounted || verified) return;
      setState(() {
        _tone = 'warning';
        _message = 'Not confirmed yet. Open the link in the email we sent, then try again.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _tone = 'error';
        _message = friendlyError(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _checking = false;
        });
      }
    }
  }

  Future<void> _resend() async {
    if (_resending || _cooldown > 0) return;
    setState(() {
      _resending = true;
      _message = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).resendVerification();
      if (!mounted) return;
      setState(() {
        _tone = 'success';
        _message = 'Verification email sent. It can take a minute to arrive.';
        _cooldown = _cooldownSeconds;
      });
      _tick?.cancel();
      _tick = Timer.periodic(const Duration(seconds: 1), (Timer timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        setState(() {
          _cooldown -= 1;
        });
        if (_cooldown <= 0) timer.cancel();
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _tone = 'error';
        _message = friendlyError(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _resending = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final AuthUser? user = ref.watch(authControllerProvider).user;
    final String email = user?.email ?? '';
    return AuthScaffold(
      title: 'Confirm your email',
      subtitle: email.isEmpty
          ? 'We sent you a link to confirm your address.'
          : 'We sent a link to $email. Open it to unlock your wallet and records.',
      footer: TextButton(
        onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
        child: const Text('Use a different account'),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (_message != null) ...<Widget>[
            InlineNotice(message: _message!, tone: _tone),
            const SizedBox(height: 14),
          ],
          BusyButton(
            label: "I've confirmed my email",
            busy: _checking,
            busyLabel: 'Checking…',
            icon: Icons.mark_email_read_outlined,
            onPressed: _check,
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: (_resending || _cooldown > 0) ? null : _resend,
            icon: const Icon(Icons.send_outlined, size: 18),
            label: Text(_cooldown > 0 ? 'Resend in ${_cooldown}s' : 'Resend email'),
          ),
          const SizedBox(height: 14),
          Text(
            'Nothing arrived? Check your spam folder, or make sure $email is spelled correctly.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: tokens.muted, height: 1.4),
          ),
        ],
      ),
    );
  }
}
