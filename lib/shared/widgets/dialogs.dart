import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import '../layout.dart';

/// Opens [builder]'s content in a modal: a centred card on tablets and desktops (with a dimmed, blurred backdrop),
/// a full-screen page on phones. Returns whatever the content pops with.
Future<T?> showAppModal<T>(
  BuildContext context, {
  required String title,
  required WidgetBuilder builder,
  double maxWidth = 520,
  bool dismissible = true,
}) {
  final bool narrow = isNarrowLayout(context);
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: dismissible,
    barrierLabel: 'Close',
    barrierColor: narrow ? Colors.black54 : Colors.black38,
    transitionDuration: const Duration(milliseconds: 180),
    pageBuilder: (BuildContext dialogContext, Animation<double> animation, Animation<double> secondaryAnimation) {
      return AppModalFrame(title: title, maxWidth: maxWidth, dismissible: dismissible, child: builder(dialogContext));
    },
    transitionBuilder: (BuildContext dialogContext, Animation<double> animation, Animation<double> secondaryAnimation, Widget child) {
      final Animation<double> curved = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
      return Stack(
        children: <Widget>[
          if (!narrow)
            Positioned.fill(
              child: FadeTransition(
                opacity: curved,
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 2.5, sigmaY: 2.5),
                  child: const SizedBox.expand(),
                ),
              ),
            ),
          FadeTransition(
            opacity: curved,
            child: ScaleTransition(scale: Tween<double>(begin: 0.97, end: 1.0).animate(curved), child: child),
          ),
        ],
      );
    },
  );
}

/// The chrome of a modal: title, close button, scrollable content.
class AppModalFrame extends StatelessWidget {
  const AppModalFrame({
    super.key,
    required this.title,
    required this.child,
    this.maxWidth = 520,
    this.dismissible = true,
  });

  final String title;
  final Widget child;
  final double maxWidth;
  final bool dismissible;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    final Widget titleRow = Row(
      children: <Widget>[
        Expanded(
          child: Text(title, style: monoStyle(size: 16, weight: FontWeight.w700, color: tokens.text), maxLines: 2, overflow: TextOverflow.ellipsis),
        ),
        if (dismissible)
          IconButton(
            tooltip: 'Close',
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.of(context).maybePop(),
          ),
      ],
    );
    if (isNarrowLayout(context)) {
      return Dialog.fullscreen(
        backgroundColor: tokens.surface,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Padding(padding: const EdgeInsets.fromLTRB(18, 8, 6, 4), child: titleRow),
              Divider(height: 1, color: tokens.border),
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(18, 18, 18, 18 + MediaQuery.viewInsetsOf(context).bottom),
                  child: child,
                ),
              ),
            ],
          ),
        ),
      );
    }
    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth, maxHeight: MediaQuery.sizeOf(context).height - 48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(padding: const EdgeInsets.fromLTRB(22, 10, 10, 6), child: titleRow),
            Divider(height: 1, color: tokens.border),
            Flexible(child: SingleChildScrollView(padding: const EdgeInsets.all(22), child: child)),
          ],
        ),
      ),
    );
  }
}

/// Cancel / confirm buttons at the bottom of a modal.
class ModalActions extends StatelessWidget {
  const ModalActions({
    super.key,
    required this.confirmLabel,
    required this.onConfirm,
    this.cancelLabel = 'Cancel',
    this.onCancel,
    this.busy = false,
    this.destructive = false,
    this.busyLabel,
  });

  final String confirmLabel;
  final VoidCallback? onConfirm;
  final String cancelLabel;
  final VoidCallback? onCancel;
  final bool busy;
  final bool destructive;
  final String? busyLabel;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: <Widget>[
        OutlinedButton(
          onPressed: busy ? null : (onCancel ?? () => Navigator.of(context).maybePop()),
          child: Text(cancelLabel),
        ),
        const SizedBox(width: 10),
        FilledButton(
          onPressed: busy ? null : onConfirm,
          style: destructive ? FilledButton.styleFrom(backgroundColor: tokens.danger, foregroundColor: Colors.white) : null,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (busy) ...<Widget>[
                const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
                const SizedBox(width: 8),
              ],
              Text(busy ? (busyLabel ?? 'Working…') : confirmLabel),
            ],
          ),
        ),
      ],
    );
  }
}

/// Asks a yes/no question. Returns true only when the person confirms.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Confirm',
  bool destructive = false,
}) async {
  final bool? result = await showAppModal<bool>(
    context,
    title: title,
    maxWidth: 440,
    builder: (BuildContext dialogContext) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(message, style: const TextStyle(height: 1.45)),
          const SizedBox(height: 22),
          ModalActions(
            confirmLabel: confirmLabel,
            destructive: destructive,
            onCancel: () => Navigator.of(dialogContext).pop(false),
            onConfirm: () => Navigator.of(dialogContext).pop(true),
          ),
        ],
      );
    },
  );
  return result ?? false;
}

/// A short message at the bottom-right on wide screens and at the bottom on phones.
void showToast(BuildContext context, String message, {bool error = false}) {
  final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  final double width = MediaQuery.sizeOf(context).width;
  final bool wide = width >= kNarrowBreakpoint;
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      duration: Duration(seconds: error ? 6 : 3),
      margin: wide ? EdgeInsets.only(left: width - 400, right: 20, bottom: 20) : const EdgeInsets.fromLTRB(12, 0, 12, 12),
      content: Row(
        children: <Widget>[
          Icon(error ? Icons.error_outline : Icons.check_circle_outline, size: 18, color: error ? const Color(0xFFF08080) : const Color(0xFF5CC283)),
          const SizedBox(width: 10),
          Expanded(child: Text(message)),
        ],
      ),
    ),
  );
}
