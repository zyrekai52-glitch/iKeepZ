import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/tokens.dart';
import 'app_card.dart';

/// Six-digit wallet PIN entry. The digits are hidden and never leave the device except in the API call that checks them.
class PinInput extends StatelessWidget {
  const PinInput({
    super.key,
    required this.controller,
    this.label = 'Wallet PIN',
    this.autofocus = false,
    this.onSubmitted,
    this.onChanged,
    this.enabled = true,
    this.errorText,
  });

  final TextEditingController controller;
  final String label;
  final bool autofocus;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;
  final bool enabled;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        MicroLabel(label),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          autofocus: autofocus,
          enabled: enabled,
          obscureText: true,
          obscuringCharacter: '●',
          keyboardType: TextInputType.number,
          textAlign: TextAlign.center,
          maxLength: 6,
          onSubmitted: onSubmitted,
          onChanged: onChanged,
          autofillHints: const <String>[],
          enableSuggestions: false,
          autocorrect: false,
          inputFormatters: <TextInputFormatter>[
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(6),
          ],
          style: monoStyle(size: 24, weight: FontWeight.w700, color: tokens.text, letterSpacing: 10),
          decoration: InputDecoration(
            counterText: '',
            hintText: '••••••',
            errorText: errorText,
            errorMaxLines: 3,
          ),
        ),
      ],
    );
  }
}

bool isCompletePin(String value) => RegExp(r'^\d{6}$').hasMatch(value);
