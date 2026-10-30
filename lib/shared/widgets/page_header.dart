import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import '../layout.dart';

/// Page title (monospace, bold), one muted description line and the page's primary actions.
class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, this.subtitle, this.actions = const <Widget>[]});

  final String title;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final Widget titles = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(title, style: monoStyle(size: 22, weight: FontWeight.w700, color: tokens.text)),
        if (subtitle != null) ...<Widget>[
          const SizedBox(height: 4),
          Text(subtitle!, style: TextStyle(fontSize: 14, color: tokens.muted, height: 1.35)),
        ],
      ],
    );
    final Widget actionRow = Wrap(spacing: 10, runSpacing: 10, crossAxisAlignment: WrapCrossAlignment.center, children: actions);
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: isNarrowLayout(context) || actions.isEmpty
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                titles,
                if (actions.isNotEmpty) ...<Widget>[const SizedBox(height: 14), actionRow],
              ],
            )
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[Expanded(child: titles), const SizedBox(width: 16), actionRow],
            ),
    );
  }
}
