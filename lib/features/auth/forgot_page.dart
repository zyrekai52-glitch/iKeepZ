import 'package:firebase_auth/firebase_auth.dart' show FirebaseAuthException;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/error_messages.dart';
import '../../providers/auth_controller.dart';
import '../../providers/core_providers.dart';
import '../../shared/widgets/busy_button.dart';
import '../../shared/widgets/form_widgets.dart';
import '../../shared/widgets/states.dart';
import 'auth_scaffold.dart';

class ForgotPage extends ConsumerStatefulWidget {
  const ForgotPage({super.key});

  @override
  ConsumerState<ForgotPage> createState() => _ForgotPageState();
}

class _ForgotPageState extends ConsumerState<ForgotPage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _email;
  bool _busy = false;
  bool _sent = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: ref.read(settingsStoreProvider).lastEmail);
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).sendPasswordReset(_email.text);
      if (mounted) {
        setState(() {
          _sent = true;
        });
      }
    } on FirebaseAuthException catch (error) {
      if (!mounted) return;
      if (error.code == 'user-not-found') {
        // Do not reveal whether an address has an account.
        setState(() {
          _sent = true;
        });
      } else {
        setState(() {
          _error = friendlyError(error);
        });
      }
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
    return AuthScaffold(
      title: 'Reset your password',
      subtitle: _sent
          ? null
          : 'Enter the email address of your account and we will send you a link to choose a new password.',
      footer: TextButton(onPressed: () => context.go('/login'), child: const Text('Back to sign in')),
      child: _sent
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                InlineNotice(
                  tone: 'success',
                  message: 'If an account exists for ${_email.text.trim()}, a reset link is on its way. Check your spam folder too.',
                ),
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: () => setState(() {
                    _sent = false;
                  }),
                  child: const Text('Send to a different address'),
                ),
              ],
            )
          : Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AppTextField(
                    label: 'Email',
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.done,
                    autofillHints: const <String>[AutofillHints.email],
                    onSubmitted: (String _) => _submit(),
                    validator: validateEmail,
                    enabled: !_busy,
                  ),
                  if (_error != null) ...<Widget>[
                    const SizedBox(height: 14),
                    InlineNotice(message: _error!, tone: 'error'),
                  ],
                  const SizedBox(height: 18),
                  BusyButton(label: 'Send reset link', busy: _busy, busyLabel: 'Sending…', onPressed: _submit),
                ],
              ),
            ),
    );
  }
}
