import '../core/utils/json.dart';

/// `wallets/{uid}`: server-written, read-only for the app. All amounts are minor units.
class Wallet {
  const Wallet({
    required this.uid,
    required this.currency,
    required this.availableMinor,
    required this.heldMinor,
    required this.pendingDepositMinor,
    required this.walletCode,
    required this.status,
    required this.version,
    required this.updatedAt,
  });

  factory Wallet.fromMap(String uid, Map<String, dynamic> map) {
    return Wallet(
      uid: uid,
      currency: readString(map['currency'], 'PHP'),
      availableMinor: readInt(map['availableMinor']),
      heldMinor: readInt(map['heldMinor']),
      pendingDepositMinor: readInt(map['pendingDepositMinor']),
      walletCode: readString(map['walletCode']),
      status: readString(map['status'], 'active'),
      version: readInt(map['version']),
      updatedAt: readDate(map['updatedAt']),
    );
  }

  final String uid;
  final String currency;
  final int availableMinor;

  /// Money reserved for withdrawals that are waiting for review or payout.
  final int heldMinor;

  /// Deposits started but not yet confirmed by the payment provider. NOT part of the balance.
  final int pendingDepositMinor;
  final String walletCode;
  final String status;
  final int version;
  final DateTime? updatedAt;

  bool get isActive => status == 'active';
  bool get isFrozen => status == 'frozen';
}
