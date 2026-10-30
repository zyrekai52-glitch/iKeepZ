import '../core/utils/json.dart';

/// `users/{uid}/destinations/{id}`: a saved payout destination. The app only ever sees the masked number.
class PayoutDestination {
  const PayoutDestination({
    required this.id,
    required this.kind,
    required this.providerName,
    required this.accountName,
    required this.accountNumberMasked,
    required this.status,
    required this.createdAt,
  });

  factory PayoutDestination.fromMap(String id, Map<String, dynamic> map) {
    return PayoutDestination(
      id: id,
      kind: readChoice(map['kind'], const <String>['bank', 'ewallet'], 'bank'),
      providerName: readString(map['providerName']),
      accountName: readString(map['accountName']),
      accountNumberMasked: readString(map['accountNumberMasked']),
      status: readString(map['status'], 'active'),
      createdAt: readDate(map['createdAt']),
    );
  }

  final String id;

  /// `bank` or `ewallet`.
  final String kind;
  final String providerName;
  final String accountName;
  final String accountNumberMasked;
  final String status;
  final DateTime? createdAt;

  bool get isActive => status == 'active';

  String get summary => '$providerName $accountNumberMasked';

  String get kindLabel => kind == 'ewallet' ? 'E-wallet' : 'Bank account';
}

/// Common Philippine payout providers offered as suggestions in the form. Free text is still accepted.
const List<String> kBankSuggestions = <String>['BDO', 'BPI', 'Metrobank', 'Landbank', 'UnionBank', 'Security Bank', 'PNB', 'RCBC'];

const List<String> kEwalletSuggestions = <String>['GCash', 'Maya', 'GrabPay', 'ShopeePay'];
