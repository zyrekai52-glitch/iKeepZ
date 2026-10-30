import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/error_messages.dart';
import '../../providers/auth_controller.dart';
import '../../shared/widgets/busy_button.dart';
import '../../shared/widgets/form_widgets.dart';
import '../../shared/widgets/states.dart';
import '../../theme/tokens.dart';
import 'auth_scaffold.dart';

class RegisterPage extends ConsumerStatefulWidget {
  const RegisterPage({super.key});

  @override
  ConsumerState<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends ConsumerState<RegisterPage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _name = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _acknowledged = false;
  bool _showAcknowledgeError = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _password.addListener(_onPasswordChanged);
  }

  void _onPasswordChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _password.removeListener(_onPasswordChanged);
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final bool valid = _formKey.currentState?.validate() ?? false;
    if (!_acknowledged) {
      setState(() {
        _showAcknowledgeError = true;
      });
      return;
    }
    if (!valid) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).register(
            email: _email.text,
            password: _password.text,
            displayName: _name.text,
          );
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
    return AuthScaffold(
      title: 'Create your account',
      subtitle: 'It takes a minute. We will email you a link to confirm your address.',
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Text('Already have an account?', style: TextStyle(color: tokens.muted)),
          TextButton(onPressed: _busy ? null : () => context.go('/login'), child: const Text('Sign in')),
        ],
      ),
      child: AutofillGroup(
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AppTextField(
                label: 'Full name',
                controller: _name,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.name],
                maxLength: 60,
                enabled: !_busy,
                validator: (String? value) => validateRequired(value, 'Enter your name.'),
              ),
              const SizedBox(height: 14),
              AppTextField(
                label: 'Email',
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.email],
                enabled: !_busy,
                validator: validateEmail,
              ),
              const SizedBox(height: 14),
              PasswordField(
                controller: _password,
                label: 'Password',
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.newPassword],
                validator: (String? value) {
                  final String text = value ?? '';
                  if (text.length < 8) return 'Use at least 8 characters.';
                  return null;
                },
              ),
              const SizedBox(height: 8),
              StrengthMeter(password: _password.text),
              const SizedBox(height: 14),
              PasswordField(
                controller: _confirm,
                label: 'Confirm password',
                textInputAction: TextInputAction.done,
                autofillHints: const <String>[AutofillHints.newPassword],
                onSubmitted: (String _) => _submit(),
                validator: (String? value) => value == _password.text ? null : 'The two passwords do not match.',
              ),
              const SizedBox(height: 14),
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: _busy
                    ? null
                    : () => setState(() {
                          _acknowledged = !_acknowledged;
                          if (_acknowledged) _showAcknowledgeError = false;
                        }),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Checkbox(
                      value: _acknowledged,
                      onChanged: _busy
                          ? null
                          : (bool? value) => setState(() {
                                _acknowledged = value ?? false;
                                if (_acknowledged) _showAcknowledgeError = false;
                              }),
                    ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          'I understand that iKeepZ is a personal finance app and its e-wallet is an in-app ledger, not a bank account.',
                          style: TextStyle(fontSize: 13, color: tokens.text, height: 1.35),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              if (_showAcknowledgeError)
                Padding(
                  padding: const EdgeInsets.only(left: 12, top: 2),
                  child: Text('Please confirm this to continue.', style: TextStyle(fontSize: 12, color: tokens.danger)),
                ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 14),
                InlineNotice(message: _error!, tone: 'error'),
              ],
              const SizedBox(height: 16),
              BusyButton(label: 'Create account', busy: _busy, busyLabel: 'Creating account…', onPressed: _submit),
            ],
          ),
        ),
      ),
    );
  }
}
