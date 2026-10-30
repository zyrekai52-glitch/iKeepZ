import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

/// A filled button that shows a spinner and ignores taps while its action runs.
class BusyButton extends StatelessWidget {
  const BusyButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.icon,
    this.expand = true,
    this.busyLabel,
    this.destructive = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final IconData? icon;
  final bool expand;
  final String? busyLabel;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final Color foreground = destructive ? Colors.white : tokens.onPrimary;
    final Widget button = FilledButton(
      onPressed: busy ? null : onPressed,
      style: destructive ? FilledButton.styleFrom(backgroundColor: tokens.danger, foregroundColor: Colors.white) : null,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          if (busy) ...<Widget>[
            SizedBox(width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2, color: foreground)),
            const SizedBox(width: 9),
          ] else if (icon != null) ...<Widget>[
            Icon(icon, size: 18),
            const SizedBox(width: 8),
          ],
          Flexible(child: Text(busy ? (busyLabel ?? label) : label, overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
    if (!expand) return button;
    return SizedBox(width: double.infinity, child: button);
  }
}
