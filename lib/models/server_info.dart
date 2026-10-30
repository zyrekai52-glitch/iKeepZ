import '../core/utils/json.dart';
import '../core/money/money.dart';

/// `{bps, fixedMinor}` fee rule from `GET /health`.
class FeeRule {
  const FeeRule({required this.bps, required this.fixedMinor});

  factory FeeRule.fromMap(Object? raw) {
    final Map<String, dynamic> map = readMap(raw);
    return FeeRule(bps: readInt(map['bps']), fixedMinor: readInt(map['fixedMinor']));
  }

  static const FeeRule none = FeeRule(bps: 0, fixedMinor: 0);

  final int bps;
  final int fixedMinor;

  int feeFor(int amountMinor) => computeFee(amountMinor, bps: bps, fixedMinor: fixedMinor);

  bool get isFree => bps == 0 && fixedMinor == 0;
}

/// What the backend says it can do right now (`GET /health`). Used to enable or disable wallet actions honestly.
class ServerCapabilities {
  const ServerCapabilities({
    required this.version,
    required this.deposits,
    required this.withdrawals,
    required this.transfers,
    required this.provider,
    required this.walletCurrencies,
    required this.depositMin,
    required this.depositMax,
    required this.withdrawMin,
    required this.withdrawMax,
    required this.transferMin,
    required this.transferMax,
    required this.dailyOut,
    required this.depositFee,
    required this.withdrawalFee,
    required this.transferFee,
    required this.requireKyc,
  });

  factory ServerCapabilities.fromMap(Map<String, dynamic> map) {
    final Map<String, dynamic> caps = readMap(map['capabilities']);
    final Map<String, dynamic> limits = readMap(caps['limits']);
    final Map<String, dynamic> fees = readMap(caps['fees']);
    return ServerCapabilities(
      version: readString(map['version']),
      deposits: readBool(caps['deposits']),
      withdrawals: readBool(caps['withdrawals']),
      transfers: readBool(caps['transfers']),
      provider: readStringOrNull(caps['provider']),
      walletCurrencies: readStringList(caps['walletCurrencies']),
      depositMin: readInt(limits['depositMin']),
      depositMax: readInt(limits['depositMax']),
      withdrawMin: readInt(limits['withdrawMin']),
      withdrawMax: readInt(limits['withdrawMax']),
      transferMin: readInt(limits['transferMin']),
      transferMax: readInt(limits['transferMax']),
      dailyOut: readInt(limits['dailyOut']),
      depositFee: FeeRule.fromMap(fees['deposit']),
      withdrawalFee: FeeRule.fromMap(fees['withdrawal']),
      transferFee: FeeRule.fromMap(fees['transfer']),
      requireKyc: readBool(caps['requireKyc']),
    );
  }

  final String version;

  /// True only when the payment provider keys and the return page are configured on the server.
  final bool deposits;
  final bool withdrawals;
  final bool transfers;
  final String? provider;
  final List<String> walletCurrencies;
  final int depositMin;
  final int depositMax;
  final int withdrawMin;
  final int withdrawMax;
  final int transferMin;
  final int transferMax;
  final int dailyOut;
  final FeeRule depositFee;
  final FeeRule withdrawalFee;
  final FeeRule transferFee;
  final bool requireKyc;
}

/// Answer of `POST /wallet/quote`.
class Quote {
  const Quote({
    required this.amountMinor,
    required this.feeMinor,
    required this.totalMinor,
    required this.currency,
    required this.minMinor,
    required this.maxMinor,
    required this.remainingDailyMinor,
    required this.problem,
  });

  factory Quote.fromMap(Map<String, dynamic> map) {
    return Quote(
      amountMinor: readInt(map['amountMinor']),
      feeMinor: readInt(map['feeMinor']),
      totalMinor: readInt(map['totalMinor']),
      currency: readString(map['currency'], 'PHP'),
      minMinor: readInt(map['minMinor']),
      maxMinor: readInt(map['maxMinor']),
      remainingDailyMinor: readIntOrNull(map['remainingDailyMinor']),
      problem: readStringOrNull(map['problem']),
    );
  }

  final int amountMinor;
  final int feeMinor;

  /// Deposit: what is paid at checkout. Withdrawal and transfer: what leaves the wallet.
  final int totalMinor;
  final String currency;
  final int minMinor;
  final int maxMinor;
  final int? remainingDailyMinor;

  /// `below_min`, `above_max`, `daily_limit`, `insufficient_funds`, `unavailable` or null.
  final String? problem;

  bool get isUsable => problem == null;
}

/// Answer of `GET /security/status`.
class SecurityStatus {
  const SecurityStatus({
    required this.pinSet,
    required this.pinLockedUntil,
    required this.emailVerified,
    required this.authTime,
  });

  factory SecurityStatus.fromMap(Map<String, dynamic> map) {
    return SecurityStatus(
      pinSet: readBool(map['pinSet']),
      pinLockedUntil: readDate(map['pinLockedUntil']),
      emailVerified: readBool(map['emailVerified']),
      authTime: readDate(map['authTime']),
    );
  }

  final bool pinSet;
  final DateTime? pinLockedUntil;
  final bool emailVerified;
  final DateTime? authTime;

  bool isPinLocked(DateTime now) => pinLockedUntil != null && pinLockedUntil!.isAfter(now);
}
