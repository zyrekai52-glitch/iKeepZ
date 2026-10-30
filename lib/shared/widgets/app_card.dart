import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

/// White (or dark) card with a 1 px border and a 10 px radius, as in the reference design.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.onTap,
    this.color,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final Widget content = Padding(padding: padding, child: child);
    return Material(
      color: color ?? tokens.surface,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kCardRadius),
        side: BorderSide(color: tokens.border),
      ),
      child: onTap == null ? content : InkWell(onTap: onTap, child: content),
    );
  }
}

/// Small uppercase label, used above groups and form fields (9-10 px, wide tracking).
class MicroLabel extends StatelessWidget {
  const MicroLabel(this.text, {super.key, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Text(
      text.toUpperCase(),
      style: monoStyle(size: 10, weight: FontWeight.w600, color: color ?? tokens.muted, letterSpacing: 0.9),
    );
  }
}

/// Card title row: a mono title with optional trailing widget.
class CardTitle extends StatelessWidget {
  const CardTitle(this.title, {super.key, this.trailing, this.subtitle});

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title, style: monoStyle(size: 14, weight: FontWeight.w700, color: tokens.text)),
              if (subtitle != null) ...<Widget>[
                const SizedBox(height: 2),
                Text(subtitle!, style: TextStyle(fontSize: 12, color: tokens.muted)),
              ],
            ],
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

/// A label on the left and a value on the right, for detail dialogs and summaries.
class DetailRow extends StatelessWidget {
  const DetailRow({super.key, required this.label, required this.value, this.valueStyle, this.trailing});

  final String label;
  final String value;
  final TextStyle? valueStyle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(width: 118, child: Text(label, style: TextStyle(fontSize: 13, color: tokens.muted))),
          Expanded(
            child: Text(
              value,
              style: valueStyle ?? TextStyle(fontSize: 14, color: tokens.text, fontWeight: FontWeight.w500),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
