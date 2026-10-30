import '../core/errors/api_exception.dart';
import '../core/utils/json.dart';
import '../models/admin_models.dart';
import '../models/payout_destination.dart';
import '../models/server_info.dart';
import '../models/wallet_tx.dart';
import 'api_client.dart';
import 'secure_store.dart';

/// A deposit that was created: the pending transaction and the provider's checkout page to open.
class DepositStart {
  const DepositStart({required this.tx, required this.checkoutUrl});

  final WalletTx tx;
  final String? checkoutUrl;
}

/// What the recipient lookup found: a masked name and the wallet currency.
class WalletLookup {
  const WalletLookup({required this.walletCode, required this.displayName, required this.currency});

  final String walletCode;
  final String displayName;
  final String currency;
}

/// Every privileged operation of the app goes through here. Money-moving calls carry an idempotency key that is
/// kept (in secure storage) until the server has given a definitive answer, so a retry after a dropped connection
/// or an app restart cannot debit or credit twice.
class WalletApi {
  WalletApi(this._client, this._idempotency);

  final ApiClient _client;
  final IdempotencyStore _idempotency;

  // ----------------------------------------------------------------- server
  Future<ServerCapabilities> health() async {
    return ServerCapabilities.fromMap(await _client.get('/health', auth: false));
  }

  /// Creates the profile, wallet and default categories on first sign-in (idempotent).
  Future<void> bootstrap({String? displayName}) async {
    final Map<String, dynamic> body = <String, dynamic>{};
    if (displayName != null && displayName.trim().isNotEmpty) body['displayName'] = displayName.trim();
    await _client.post('/bootstrap', body: body);
  }

  Future<Quote> quote({required String kind, required int amountMinor}) async {
    final Map<String, dynamic> data = await _client.post(
      '/wallet/quote',
      body: <String, dynamic>{'kind': kind, 'amountMinor': amountMinor},
    );
    return Quote.fromMap(data);
  }

  // --------------------------------------------------------------- deposits
  Future<DepositStart> createDeposit({required int amountMinor}) async {
    final Map<String, dynamic> data = await _idempotent(
      operation: 'deposit',
      fingerprint: '$amountMinor',
      call: (String key) => _client.post(
        '/wallet/deposits',
        body: <String, dynamic>{'amountMinor': amountMinor, 'idempotencyKey': key},
      ),
    );
    final Map<String, dynamic> tx = readMap(data['tx']);
    return DepositStart(
      tx: WalletTx.fromMap(readString(tx['id']), tx),
      checkoutUrl: readStringOrNull(data['checkoutUrl']),
    );
  }

  /// Asks the server to re-check the payment with the provider (it credits the wallet only if it was really paid).
  Future<WalletTx> syncDeposit(String txId) async => _txFrom(await _client.post('/wallet/deposits/$txId/sync'));

  Future<WalletTx> cancelDeposit(String txId) async => _txFrom(await _client.post('/wallet/deposits/$txId/cancel'));

  // ----------------------------------------------------------- destinations
  Future<PayoutDestination> addDestination({
    required String kind,
    required String providerName,
    required String accountName,
    required String accountNumber,
  }) async {
    final Map<String, dynamic> data = await _client.post(
      '/wallet/destinations',
      body: <String, dynamic>{
        'kind': kind,
        'providerName': providerName.trim(),
        'accountName': accountName.trim(),
        'accountNumber': accountNumber.trim(),
      },
    );
    final Map<String, dynamic> destination = readMap(data['destination']);
    return PayoutDestination.fromMap(readString(destination['id']), destination);
  }

  Future<void> removeDestination(String id) async {
    await _client.delete('/wallet/destinations/$id');
  }

  // ------------------------------------------------------------ withdrawals
  Future<WalletTx> createWithdrawal({required String destinationId, required int amountMinor, required String pin}) async {
    final Map<String, dynamic> data = await _idempotent(
      operation: 'withdrawal',
      fingerprint: '$destinationId|$amountMinor',
      call: (String key) => _client.post(
        '/wallet/withdrawals',
        body: <String, dynamic>{
          'destinationId': destinationId,
          'amountMinor': amountMinor,
          'pin': pin,
          'idempotencyKey': key,
        },
      ),
    );
    return _txFrom(data);
  }

  Future<WalletTx> cancelWithdrawal(String txId) async => _txFrom(await _client.post('/wallet/withdrawals/$txId/cancel'));

  // -------------------------------------------------------------- transfers
  Future<WalletLookup> lookupWallet(String walletCode) async {
    final Map<String, dynamic> data = await _client.post(
      '/wallet/transfers/lookup',
      body: <String, dynamic>{'walletCode': walletCode.trim()},
    );
    return WalletLookup(
      walletCode: readString(data['walletCode']),
      displayName: readString(data['displayName']),
      currency: readString(data['currency'], 'PHP'),
    );
  }

  Future<WalletTx> createTransfer({
    required String walletCode,
    required int amountMinor,
    required String pin,
    String? note,
  }) async {
    final String cleanNote = (note ?? '').trim();
    final Map<String, dynamic> data = await _idempotent(
      operation: 'transfer',
      fingerprint: '${walletCode.trim().toUpperCase()}|$amountMinor|$cleanNote',
      call: (String key) => _client.post(
        '/wallet/transfers',
        body: <String, dynamic>{
          'walletCode': walletCode.trim(),
          'amountMinor': amountMinor,
          if (cleanNote.isNotEmpty) 'note': cleanNote,
          'pin': pin,
          'idempotencyKey': key,
        },
      ),
    );
    return _txFrom(data);
  }

  // --------------------------------------------------------------- security
  Future<SecurityStatus> securityStatus() async {
    return SecurityStatus.fromMap(await _client.get('/security/status'));
  }

  /// Sets or changes the 6-digit wallet PIN. The server requires a sign-in within the last five minutes.
  Future<void> setPin({required String newPin, String? currentPin}) async {
    await _client.post(
      '/security/pin',
      body: <String, dynamic>{'newPin': newPin, if (currentPin != null && currentPin.isNotEmpty) 'currentPin': currentPin},
    );
  }

  Future<void> revokeSessions() async {
    await _client.post('/security/revoke-sessions');
  }

  // ------------------------------------------------------------------ admin
  Future<List<AdminWithdrawal>> adminWithdrawals({String? status, int limit = 50}) async {
    final Map<String, dynamic> data = await _client.get(
      '/admin/withdrawals',
      query: <String, String>{if (status != null && status.isNotEmpty) 'status': status, 'limit': '$limit'},
    );
    final Object? items = data['items'];
    final List<AdminWithdrawal> out = <AdminWithdrawal>[];
    if (items is List) {
      for (final Object? item in items) {
        out.add(AdminWithdrawal.fromMap(readMap(item)));
      }
    }
    return out;
  }

  Future<WalletTx> adminApprove(String txId) async => _txFrom(await _client.post('/admin/withdrawals/$txId/approve'));

  Future<WalletTx> adminReject(String txId, String reason) async {
    return _txFrom(await _client.post('/admin/withdrawals/$txId/reject', body: <String, dynamic>{'reason': reason}));
  }

  Future<WalletTx> adminComplete(String txId, String payoutReference) async {
    return _txFrom(
      await _client.post('/admin/withdrawals/$txId/complete', body: <String, dynamic>{'payoutReference': payoutReference}),
    );
  }

  Future<WalletTx> adminFail(String txId, String reason) async {
    return _txFrom(await _client.post('/admin/withdrawals/$txId/fail', body: <String, dynamic>{'reason': reason}));
  }

  Future<WalletTx> adminReverse(String txId, String reason) async {
    return _txFrom(await _client.post('/admin/transactions/$txId/reverse', body: <String, dynamic>{'reason': reason}));
  }

  Future<ReconcileReport> adminReconcile({String? after, int limit = 500}) async {
    final Map<String, dynamic> data = await _client.get(
      '/admin/reconcile',
      query: <String, String>{if (after != null && after.isNotEmpty) 'after': after, 'limit': '$limit'},
    );
    return ReconcileReport.fromMap(data);
  }

  // ---------------------------------------------------------------- helpers
  WalletTx _txFrom(Map<String, dynamic> data) {
    final Map<String, dynamic> tx = readMap(data['tx']);
    return WalletTx.fromMap(readString(tx['id']), tx);
  }

  /// Runs [call] with the stored idempotency key for [operation]. The key is dropped once the server has answered
  /// definitively (success, or a refusal that did not change anything). If the outcome is unknown (no answer,
  /// server error) or the account was merely busy, the key is kept so the next attempt replays the same request.
  Future<Map<String, dynamic>> _idempotent({
    required String operation,
    required String fingerprint,
    required Future<Map<String, dynamic>> Function(String key) call,
  }) async {
    final String key = await _idempotency.keyFor(operation, fingerprint);
    try {
      final Map<String, dynamic> result = await call(key);
      await _idempotency.clear(operation);
      return result;
    } on ApiException catch (error) {
      final bool keep = error.outcomeUnknown || error.isRetryable;
      if (!keep) await _idempotency.clear(operation);
      rethrow;
    }
  }
}
