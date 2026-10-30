import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/errors/error_messages.dart';
import '../../providers/auth_controller.dart';
import '../../providers/core_providers.dart';
import '../../shared/widgets/busy_button.dart';
import '../../shared/widgets/form_widgets.dart';
import '../../shared/widgets/states.dart';
import '../../theme/tokens.dart';
import 'auth_scaffold.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _email;
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: ref.read(settingsStoreProvider).lastEmail);
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
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
      await ref.read(authControllerProvider.notifier).signIn(email: _email.text, password: _password.text);
      // The router moves on by itself as soon as the signed-in state arrives.
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
      title: 'Sign in',
      subtitle: 'Welcome back. Your records and wallet are waiting.',
      footer: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Text('New to iKeepZ?', style: TextStyle(color: tokens.muted)),
          TextButton(onPressed: _busy ? null : () => context.go('/register'), child: const Text('Create an account')),
        ],
      ),
      child: AutofillGroup(
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AppTextField(
                label: 'Email',
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const <String>[AutofillHints.email],
                validator: validateEmail,
                enabled: !_busy,
              ),
              const SizedBox(height: 14),
              PasswordField(
                controller: _password,
                textInputAction: TextInputAction.done,
                onSubmitted: (String _) => _submit(),
                validator: (String? value) => validateRequired(value, 'Enter your password.'),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 14),
                InlineNotice(message: _error!, tone: 'error'),
              ],
              const SizedBox(height: 18),
              BusyButton(label: 'Sign in', busy: _busy, busyLabel: 'Signing in…', onPressed: _submit),
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(onPressed: _busy ? null : () => context.go('/forgot'), child: const Text('Forgot password?')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
