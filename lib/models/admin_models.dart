import '../core/utils/json.dart';
import 'wallet_tx.dart';

/// Full payout details, only ever sent to administrators.
class AdminPayout {
  const AdminPayout({
    required this.kind,
    required this.providerName,
    required this.accountName,
    required this.accountNumber,
  });

  factory AdminPayout.fromMap(Map<String, dynamic> map) {
    return AdminPayout(
      kind: readString(map['kind']),
      providerName: readString(map['providerName']),
      accountName: readString(map['accountName']),
      accountNumber: readString(map['accountNumber']),
    );
  }

  final String kind;
  final String providerName;
  final String accountName;
  final String accountNumber;
}

/// One row of the withdrawal review queue (`GET /admin/withdrawals`).
class AdminWithdrawal {
  const AdminWithdrawal({required this.tx, required this.userEmail, required this.payout});

  factory AdminWithdrawal.fromMap(Map<String, dynamic> map) {
    final Map<String, dynamic> destination = readMap(map['destination']);
    return AdminWithdrawal(
      tx: WalletTx.fromMap(readString(readMap(map['tx'])['id']), readMap(map['tx'])),
      userEmail: readStringOrNull(map['userEmail']),
      payout: destination.isEmpty ? null : AdminPayout.fromMap(destination),
    );
  }

  final WalletTx tx;
  final String? userEmail;
  final AdminPayout? payout;
}

class ReconcileMismatch {
  const ReconcileMismatch({required this.uid, required this.field, required this.expected, required this.actual});

  factory ReconcileMismatch.fromMap(Map<String, dynamic> map) {
    return ReconcileMismatch(
      uid: readString(map['uid']),
      field: readString(map['field']),
      expected: '${map['expected']}',
      actual: '${map['actual']}',
    );
  }

  final String uid;
  final String field;
  final String expected;
  final String actual;
}

/// One page of `GET /admin/reconcile`.
class ReconcileReport {
  const ReconcileReport({
    required this.walletsChecked,
    required this.mismatches,
    required this.platformRevenue,
    required this.next,
  });

  factory ReconcileReport.fromMap(Map<String, dynamic> map) {
    final List<ReconcileMismatch> mismatches = <ReconcileMismatch>[];
    final Object? rawList = map['mismatches'];
    if (rawList is List) {
      for (final Object? item in rawList) {
        mismatches.add(ReconcileMismatch.fromMap(readMap(item)));
      }
    }
    final Map<String, int> revenue = <String, int>{};
    readMap(map['platformRevenue']).forEach((String currency, Object? value) {
      revenue[currency] = readInt(value);
    });
    return ReconcileReport(
      walletsChecked: readInt(map['walletsChecked']),
      mismatches: mismatches,
      platformRevenue: revenue,
      next: readStringOrNull(map['next']),
    );
  }

  final int walletsChecked;
  final List<ReconcileMismatch> mismatches;
  final Map<String, int> platformRevenue;

  /// Pass as `after` to fetch the next page, or null when this was the last page.
  final String? next;
}
