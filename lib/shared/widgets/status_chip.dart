import 'package:flutter/material.dart';

import '../../models/wallet_tx.dart';
import '../../theme/tokens.dart';

/// Small coloured pill: green for success, amber for pending, red for failures (the reference's Low/Medium/High chips).
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.tone});

  final String label;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final ToneColors colors = context.tokens.toneColors(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: colors.background, borderRadius: BorderRadius.circular(999)),
      child: Text(
        label,
        style: monoStyle(size: 11, weight: FontWeight.w600, color: colors.foreground),
      ),
    );
  }
}

/// Chip for a wallet transaction's status.
class TxStatusChip extends StatelessWidget {
  const TxStatusChip({super.key, required this.tx});

  final WalletTx tx;

  @override
  Widget build(BuildContext context) {
    return StatusChip(label: tx.statusLabel, tone: tx.tone);
  }
}

/// Neutral chip for tags and kinds.
class TagChip extends StatelessWidget {
  const TagChip(this.label, {super.key, this.onDeleted});

  final String label;
  final VoidCallback? onDeleted;

  @override
  Widget build(BuildContext context) {
    final AppTokens tokens = context.tokens;
    return Container(
      padding: EdgeInsets.only(left: 9, right: onDeleted == null ? 9 : 4, top: 3, bottom: 3),
      decoration: BoxDecoration(color: tokens.fill, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(label, style: monoStyle(size: 11, color: tokens.muted)),
          if (onDeleted != null)
            InkWell(
              onTap: onDeleted,
              borderRadius: BorderRadius.circular(999),
              child: Padding(
                padding: const EdgeInsets.all(2),
                child: Icon(Icons.close, size: 13, color: tokens.muted),
              ),
            ),
        ],
      ),
    );
  }
}
