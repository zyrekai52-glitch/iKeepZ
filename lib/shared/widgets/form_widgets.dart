import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/money/money.dart';
import '../../theme/tokens.dart';
import 'app_card.dart';

/// A text field with the micro-label above it (reference style) instead of a floating label.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.helper,
    this.validator,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.maxLines = 1,
    this.maxLength,
    this.onChanged,
    this.onSubmitted,
    this.suffix,
    this.prefix,
    this.autofocus = false,
    this.enabled = true,
    this.inputFormatters,
    this.autofillHints,
    this.textCapitalization = TextCapitalization.none,
    this.focusNode,
    this.readOnly = false,
    this.onTap,
    this.mono = false,
    this.textAlign = TextAlign.start,
  });

  final String label;
  final TextEditingController? controller;
  final String? hint;
  final String? helper;
  final FormFieldValidator<String>? validator;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool obscureText;
  final int maxLines;
  final int? maxLength;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final Widget? suffix;
  final Widget? prefix;
  final bool autofocus;
  final bool enabled;
  final List<TextInputFormatter>? inputFormatters;
  final Iterable<String>? autofillHints;
  final TextCapitalization textCapitalization;
  final FocusNode? focusNode;
  final bool readOnly;
  final VoidCallback? onTap;
  final bool mono;
  final TextAlign textAlign;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        MicroLabel(label),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          focusNode: focusNode,
          autofocus: autofocus,
          enabled: enabled,
          readOnly: readOnly,
          onTap: onTap,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          obscureText: obscureText,
          maxLines: obscureText ? 1 : maxLines,
          maxLength: maxLength,
          validator: validator,
          onChanged: onChanged,
          onFieldSubmitted: onSubmitted,
          inputFormatters: inputFormatters,
          autofillHints: autofillHints,
          textCapitalization: textCapitalization,
          textAlign: textAlign,
          style: mono ? monoStyle(size: 15, color: tokens.text) : null,
          decoration: InputDecoration(
            hintText: hint,
            helperText: helper,
            helperMaxLines: 3,
            errorMaxLines: 3,
            counterText: '',
            prefixIcon: prefix,
            suffixIcon: suffix,
          ),
        ),
      ],
    );
  }
}

/// Password field with a show/hide toggle.
class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    this.label = 'Password',
    this.validator,
    this.textInputAction,
    this.onSubmitted,
    this.autofocus = false,
    this.autofillHints = const <String>[AutofillHints.password],
    this.helper,
  });

  final TextEditingController controller;
  final String label;
  final FormFieldValidator<String>? validator;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final Iterable<String> autofillHints;
  final String? helper;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _hidden = true;

  @override
  Widget build(BuildContext context) {
    return AppTextField(
      label: widget.label,
      controller: widget.controller,
      obscureText: _hidden,
      validator: widget.validator,
      textInputAction: widget.textInputAction,
      onSubmitted: widget.onSubmitted,
      autofocus: widget.autofocus,
      autofillHints: widget.autofillHints,
      helper: widget.helper,
      keyboardType: TextInputType.visiblePassword,
      suffix: IconButton(
        tooltip: _hidden ? 'Show password' : 'Hide password',
        icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20),
        onPressed: () => setState(() => _hidden = !_hidden),
      ),
    );
  }
}

/// An amount field in major units ("1,250.50") with the currency symbol in front.
class AmountField extends StatelessWidget {
  const AmountField({
    super.key,
    required this.controller,
    required this.currency,
    this.label = 'Amount',
    this.validator,
    this.onChanged,
    this.autofocus = false,
    this.helper,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String currency;
  final String label;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onChanged;
  final bool autofocus;
  final String? helper;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return AppTextField(
      label: label,
      controller: controller,
      mono: true,
      autofocus: autofocus,
      enabled: enabled,
      helper: helper,
      validator: validator,
      onChanged: onChanged,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
      hint: currencyExponent(currency) == 0 ? '0' : '0.00',
      prefix: Padding(
        padding: const EdgeInsets.only(left: 12, right: 6),
        child: Center(
          widthFactor: 1,
          child: Text(currencySymbol(currency).trim(), style: monoStyle(size: 15, weight: FontWeight.w600, color: tokens.muted)),
        ),
      ),
    );
  }
}

/// One option of a [Segmented] control.
class SegmentOption<T> {
  const SegmentOption({required this.value, required this.label, this.icon});

  final T value;
  final String label;
  final IconData? icon;
}

/// A compact segmented control (Light / Dark, Income / Expense ...).
class Segmented<T> extends StatelessWidget {
  const Segmented({super.key, required this.options, required this.value, required this.onChanged, this.expand = true});

  final List<SegmentOption<T>> options;
  final T value;
  final ValueChanged<T> onChanged;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final List<Widget> items = <Widget>[];
    for (final SegmentOption<T> option in options) {
      final bool selected = option.value == value;
      final Widget item = Semantics(
        button: true,
        selected: selected,
        label: option.label,
        child: InkWell(
          borderRadius: BorderRadius.circular(kControlRadius - 1),
          onTap: () => onChanged(option.value),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: selected ? tokens.surface : Colors.transparent,
              borderRadius: BorderRadius.circular(kControlRadius - 1),
              border: Border.all(color: selected ? tokens.border : Colors.transparent),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                if (option.icon != null) ...<Widget>[
                  Icon(option.icon, size: 16, color: selected ? tokens.text : tokens.muted),
                  const SizedBox(width: 6),
                ],
                Flexible(
                  child: Text(
                    option.label,
                    overflow: TextOverflow.ellipsis,
                    style: monoStyle(size: 12, weight: selected ? FontWeight.w700 : FontWeight.w500, color: selected ? tokens.text : tokens.muted),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      items.add(expand ? Expanded(child: item) : item);
    }
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: tokens.fill, borderRadius: BorderRadius.circular(kControlRadius)),
      child: Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, children: items),
    );
  }
}

/// A read-only field that opens the date picker.
class DateField extends StatelessWidget {
  const DateField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    required this.format,
    this.firstDate,
    this.lastDate,
  });

  final String label;
  final DateTime value;
  final ValueChanged<DateTime> onChanged;
  final String Function(DateTime) format;
  final DateTime? firstDate;
  final DateTime? lastDate;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        MicroLabel(label),
        const SizedBox(height: 6),
        InkWell(
          borderRadius: BorderRadius.circular(kControlRadius),
          onTap: () async {
            final DateTime? picked = await showDatePicker(
              context: context,
              initialDate: value,
              firstDate: firstDate ?? DateTime(2000),
              lastDate: lastDate ?? DateTime(2100),
            );
            if (picked != null) onChanged(picked);
          },
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
            decoration: BoxDecoration(color: tokens.fill, borderRadius: BorderRadius.circular(kControlRadius)),
            child: Row(
              children: <Widget>[
                Expanded(child: Text(format(value))),
                Icon(Icons.calendar_today_outlined, size: 16, color: tokens.muted),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// A drop-down with the micro-label above it.
class ChoiceField<T> extends StatelessWidget {
  const ChoiceField({
    super.key,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
    this.hint,
  });

  final String label;
  final T? value;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?>? onChanged;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        MicroLabel(label),
        const SizedBox(height: 6),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(color: tokens.fill, borderRadius: BorderRadius.circular(kControlRadius)),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<T>(
              value: value,
              isExpanded: true,
              hint: hint == null ? null : Text(hint!),
              items: items,
              onChanged: onChanged,
              borderRadius: BorderRadius.circular(kControlRadius),
              dropdownColor: tokens.surface,
            ),
          ),
        ),
      ],
    );
  }
}

/// Email format check used by the sign-in and registration forms.
String? validateEmail(String? value) {
  final String text = (value ?? '').trim();
  if (text.isEmpty) return 'Enter your email address.';
  if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$').hasMatch(text)) return 'That email address does not look right.';
  return null;
}

String? validateRequired(String? value, String message) {
  return (value ?? '').trim().isEmpty ? message : null;
}

/// Rough strength score 0..4 for the password meter (length and character variety).
int passwordStrength(String password) {
  if (password.isEmpty) return 0;
  int score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (RegExp(r'[a-z]').hasMatch(password) && RegExp(r'[A-Z]').hasMatch(password)) score += 1;
  if (RegExp(r'\d').hasMatch(password) && RegExp(r'[^A-Za-z0-9]').hasMatch(password)) score += 1;
  return score;
}

/// Four-segment strength bar (the reference's password strength meter).
class StrengthMeter extends StatelessWidget {
  const StrengthMeter({super.key, required this.password});

  final String password;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final int score = passwordStrength(password);
    final List<String> labels = <String>['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
    final Color color = score <= 1 ? tokens.danger : (score == 2 ? tokens.warning : tokens.success);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            for (int i = 0; i < 4; i++)
              Expanded(
                child: Container(
                  height: 4,
                  margin: EdgeInsets.only(right: i == 3 ? 0 : 4),
                  decoration: BoxDecoration(
                    color: i < score ? color : tokens.fill,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        Text(password.isEmpty ? 'Use at least 8 characters.' : labels[score], style: TextStyle(fontSize: 12, color: tokens.muted)),
      ],
    );
  }
}
