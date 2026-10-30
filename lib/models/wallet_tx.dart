import '../core/utils/json.dart';

enum StatusTone { success, warning, danger, neutral }

/// A wallet transaction (`walletTx/{txId}`), read from Firestore or from an API response.
class WalletTx {
  const WalletTx({
    required this.id,
    required this.reference,
    required this.kind,
    required this.status,
    required this.amountMinor,
    required this.feeMinor,
    required this.totalMinor,
    required this.currency,
    required this.ownerUid,
    required this.counterpartyUid,
    required this.participants,
    required this.directions,
    required this.ownerDisplay,
    required this.counterpartyDisplay,
    required this.destinationId,
    required this.destinationSummary,
    required this.provider,
    required this.checkoutUrl,
    required this.note,
    required this.failureReason,
    required this.payoutReference,
    required this.reversesTxId,
    required this.reversedByTxId,
    required this.createdAt,
    required this.updatedAt,
    required this.completedAt,
  });

  factory WalletTx.fromMap(String id, Map<String, dynamic> map) {
    final Map<String, dynamic> rawDirections = readMap(map['directions']);
    final Map<String, String> directions = <String, String>{};
    rawDirections.forEach((String uid, Object? value) {
      if (value is String) directions[uid] = value;
    });
    return WalletTx(
      id: id,
      reference: readString(map['reference'], id),
      kind: readString(map['kind']),
      status: readString(map['status']),
      amountMinor: readInt(map['amountMinor']),
      feeMinor: readInt(map['feeMinor']),
      totalMinor: readInt(map['totalMinor']),
      currency: readString(map['currency'], 'PHP'),
      ownerUid: readString(map['ownerUid']),
      counterpartyUid: readStringOrNull(map['counterpartyUid']),
      participants: readStringList(map['participants']),
      directions: directions,
      ownerDisplay: readString(map['ownerDisplay']),
      counterpartyDisplay: readStringOrNull(map['counterpartyDisplay']),
      destinationId: readStringOrNull(map['destinationId']),
      destinationSummary: readStringOrNull(map['destinationSummary']),
      provider: readStringOrNull(map['provider']),
      checkoutUrl: readStringOrNull(map['checkoutUrl']),
      note: readStringOrNull(map['note']),
      failureReason: readStringOrNull(map['failureReason']),
      payoutReference: readStringOrNull(map['payoutReference']),
      reversesTxId: readStringOrNull(map['reversesTxId']),
      reversedByTxId: readStringOrNull(map['reversedByTxId']),
      createdAt: readDate(map['createdAt']),
      updatedAt: readDate(map['updatedAt']),
      completedAt: readDate(map['completedAt']),
    );
  }

  final String id;
  final String reference;

  /// `deposit`, `withdrawal`, `transfer` or `reversal`.
  final String kind;
  final String status;
  final int amountMinor;
  final int feeMinor;
  final int totalMinor;
  final String currency;
  final String ownerUid;
  final String? counterpartyUid;
  final List<String> participants;
  final Map<String, String> directions;
  final String ownerDisplay;
  final String? counterpartyDisplay;
  final String? destinationId;
  final String? destinationSummary;
  final String? provider;

  /// Only present for the owner of a deposit that is still pending.
  final String? checkoutUrl;
  final String? note;
  final String? failureReason;
  final String? payoutReference;
  final String? reversesTxId;
  final String? reversedByTxId;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? completedAt;

  bool get isDeposit => kind == 'deposit';
  bool get isWithdrawal => kind == 'withdrawal';
  bool get isTransfer => kind == 'transfer';
  bool get isReversal => kind == 'reversal';

  /// Still waiting for something to happen (payment, review, payout).
  bool get isOpen => status == 'pending' || status == 'pending_review' || status == 'approved';

  /// The owner can cancel a pending deposit or a withdrawal that has not been approved yet.
  bool get canCancel => (isDeposit && status == 'pending') || (isWithdrawal && status == 'pending_review');

  /// `credit` or `debit` from the point of view of [uid].
  String directionFor(String uid) {
    final String? stored = directions[uid];
    if (stored != null) return stored;
    if (isDeposit) return 'credit';
    if (isWithdrawal) return 'debit';
    return uid == ownerUid ? 'debit' : 'credit';
  }

  bool isCreditFor(String uid) => directionFor(uid) == 'credit';

  /// What actually moved in [uid]'s wallet: the amount for a credit, amount plus fee for a debit.
  /// (A reversal is the mirror image: the sender of the original transfer gets the fee back too.)
  int walletDeltaFor(String uid) {
    if (!isSettledOrHolding) return 0;
    final bool credit = isCreditFor(uid);
    if (isReversal) return credit ? totalMinor : -amountMinor;
    return credit ? amountMinor : -totalMinor;
  }

  /// Completed transactions and withdrawals whose funds are on hold change the wallet.
  bool get isSettledOrHolding {
    if (status == 'completed' || status == 'reversed') return true;
    if (isWithdrawal && (status == 'pending_review' || status == 'approved')) return true;
    return false;
  }

  String titleFor(String uid) {
    switch (kind) {
      case 'deposit':
        return 'Deposit';
      case 'withdrawal':
        final String? where = destinationSummary;
        return where == null || where.isEmpty ? 'Withdrawal' : 'Withdrawal to $where';
      case 'transfer':
        if (isCreditFor(uid)) return 'Received from ${ownerDisplay.isEmpty ? 'a wallet' : ownerDisplay}';
        final String? to = counterpartyDisplay;
        return to == null || to.isEmpty ? 'Transfer sent' : 'Sent to $to';
      case 'reversal':
        return 'Reversal';
      default:
        return 'Wallet transaction';
    }
  }

  String get statusLabel => walletStatusLabel(kind, status);
  StatusTone get tone => walletStatusTone(status);
}

String walletStatusLabel(String kind, String status) {
  switch (status) {
    case 'pending':
      return kind == 'deposit' ? 'Awaiting payment' : 'Pending';
    case 'pending_review':
      return 'In review';
    case 'approved':
      return 'Approved';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    case 'reversed':
      return 'Reversed';
    default:
      return status.isEmpty ? 'Unknown' : status;
  }
}

StatusTone walletStatusTone(String status) {
  switch (status) {
    case 'completed':
      return StatusTone.success;
    case 'pending':
    case 'pending_review':
    case 'approved':
      return StatusTone.warning;
    case 'failed':
    case 'rejected':
      return StatusTone.danger;
    default:
      return StatusTone.neutral;
  }
}

/// `wallets/{uid}/ledger/{entryId}`: one immutable line of the wallet statement.
class LedgerEntry {
  const LedgerEntry({
    required this.id,
    required this.txId,
    required this.type,
    required this.deltaAvailableMinor,
    required this.deltaHeldMinor,
    required this.balanceAvailableAfterMinor,
    required this.balanceHeldAfterMinor,
    required this.currency,
    required this.seq,
    required this.createdAt,
  });

  factory LedgerEntry.fromMap(String id, Map<String, dynamic> map) {
    return LedgerEntry(
      id: id,
      txId: readString(map['txId']),
      type: readString(map['type']),
      deltaAvailableMinor: readInt(map['deltaAvailableMinor']),
      deltaHeldMinor: readInt(map['deltaHeldMinor']),
      balanceAvailableAfterMinor: readInt(map['balanceAvailableAfterMinor']),
      balanceHeldAfterMinor: readInt(map['balanceHeldAfterMinor']),
      currency: readString(map['currency'], 'PHP'),
      seq: readInt(map['seq']),
      createdAt: readDate(map['createdAt']),
    );
  }

  final String id;
  final String txId;
  final String type;
  final int deltaAvailableMinor;
  final int deltaHeldMinor;
  final int balanceAvailableAfterMinor;
  final int balanceHeldAfterMinor;
  final String currency;
  final int seq;
  final DateTime? createdAt;

  String get label {
    switch (type) {
      case 'deposit_credit':
        return 'Deposit credited';
      case 'withdrawal_hold':
        return 'Withdrawal requested (funds held)';
      case 'withdrawal_release':
        return 'Withdrawal released back to wallet';
      case 'withdrawal_settle':
        return 'Withdrawal paid out';
      case 'transfer_out':
        return 'Transfer sent';
      case 'transfer_in':
        return 'Transfer received';
      case 'reversal_debit':
        return 'Reversal (debit)';
      case 'reversal_credit':
        return 'Reversal (credit)';
      default:
        return type;
    }
  }
}
