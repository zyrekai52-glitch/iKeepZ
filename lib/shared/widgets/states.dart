import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/error_messages.dart';
import '../../theme/tokens.dart';

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label});

  final String? label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.5)),
            if (label != null) ...<Widget>[
              const SizedBox(height: 14),
              Text(label!, style: TextStyle(color: context.tokens.muted)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Shown when a list or a page has nothing to show yet, with an optional call to action.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(color: tokens.fill, shape: BoxShape.circle),
                child: Icon(icon, color: tokens.muted, size: 24),
              ),
              const SizedBox(height: 14),
              Text(title, textAlign: TextAlign.center, style: monoStyle(size: 15, weight: FontWeight.w700, color: tokens.text)),
              if (message != null) ...<Widget>[
                const SizedBox(height: 6),
                Text(message!, textAlign: TextAlign.center, style: TextStyle(color: tokens.muted, height: 1.4)),
              ],
              if (actionLabel != null && onAction != null) ...<Widget>[
                const SizedBox(height: 16),
                FilledButton(onPressed: onAction, child: Text(actionLabel!)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A real error with a human sentence and, when possible, a retry button.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.error_outline,
      title: 'Could not load this',
      message: friendlyError(error),
      actionLabel: onRetry == null ? null : 'Try again',
      onAction: onRetry,
    );
  }
}

/// Renders an [AsyncValue] with consistent loading, error and data states.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({super.key, required this.value, required this.builder, this.onRetry, this.loading});

  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: builder,
      error: (Object error, StackTrace stackTrace) => ErrorView(error: error, onRetry: onRetry),
      loading: () => loading ?? const LoadingView(),
    );
  }
}

/// A one-line inline message (error, warning or info) for forms and cards.
class InlineNotice extends StatelessWidget {
  const InlineNotice({super.key, required this.message, this.tone = 'info', this.icon});

  final String message;

  /// `info`, `warning`, `error` or `success`.
  final String tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    Color foreground = tokens.muted;
    Color background = tokens.fill;
    IconData symbol = Icons.info_outline;
    switch (tone) {
      case 'warning':
        foreground = tokens.warning;
        background = tokens.warningBg;
        symbol = Icons.warning_amber_rounded;
        break;
      case 'error':
        foreground = tokens.danger;
        background = tokens.dangerBg;
        symbol = Icons.error_outline;
        break;
      case 'success':
        foreground = tokens.success;
        background = tokens.successBg;
        symbol = Icons.check_circle_outline;
        break;
      default:
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(kControlRadius)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon ?? symbol, size: 18, color: foreground),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: TextStyle(color: foreground, fontSize: 13, height: 1.35))),
        ],
      ),
    );
  }
}
