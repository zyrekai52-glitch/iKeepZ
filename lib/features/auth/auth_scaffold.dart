import 'package:flutter/material.dart';

import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/visuals.dart';
import '../../theme/tokens.dart';

/// Shared frame of the sign-in, registration, password-reset and verification pages.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.footer,
  });

  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      const BrandMark(size: 34),
                      const SizedBox(width: 10),
                      Text('iKeepZ', style: monoStyle(size: 24, weight: FontWeight.w700, color: tokens.text)),
                    ],
                  ),
                  const SizedBox(height: 24),
                  AppCard(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Text(title, style: monoStyle(size: 18, weight: FontWeight.w700, color: tokens.text)),
                        if (subtitle != null) ...<Widget>[
                          const SizedBox(height: 6),
                          Text(subtitle!, style: TextStyle(color: tokens.muted, height: 1.4)),
                        ],
                        const SizedBox(height: 20),
                        child,
                      ],
                    ),
                  ),
                  if (footer != null) ...<Widget>[const SizedBox(height: 14), footer!],
                  const SizedBox(height: 22),
                  Text(
                    "iKeepZ is a personal finance app. Its e-wallet is an in-app ledger run by the app's owner; iKeepZ is not a bank.",
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11.5, color: tokens.muted, height: 1.4),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
