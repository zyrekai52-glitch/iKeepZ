import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import 'app_card.dart';

/// A summary card: micro label, a large monospace value and an optional caption.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.caption,
    this.icon,
    this.valueColor,
    this.footer,
  });

  final String label;
  final String value;
  final String? caption;
  final IconData? icon;
  final Color? valueColor;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(child: MicroLabel(label)),
              if (icon != null) Icon(icon, size: 18, color: tokens.muted),
            ],
          ),
          const SizedBox(height: 10),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: monoStyle(size: 24, weight: FontWeight.w700, color: valueColor ?? tokens.text)),
          ),
          if (caption != null) ...<Widget>[
            const SizedBox(height: 4),
            Text(caption!, style: TextStyle(fontSize: 12, color: tokens.muted)),
          ],
          if (footer != null) ...<Widget>[const SizedBox(height: 10), footer!],
        ],
      ),
    );
  }
}
