/// An error answered by (or on the way to) the iKeepZ HTTPS API.
///
/// [code] is one of the snake_case codes in docs/ARCHITECTURE.md (`insufficient_funds`, `pin_locked`, ...) or a
/// client-side code: `network` (no answer, the outcome of a write is unknown), `bad_response`, `not_configured_client`.
class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.message,
    this.statusCode,
    this.details = const <String, dynamic>{},
  });

  final String code;
  final String message;
  final int? statusCode;
  final Map<String, dynamic> details;

  /// The request may or may not have been processed. Retrying with the same idempotency key is safe.
  bool get outcomeUnknown => code == 'network' || code == 'internal' || code == 'provider_error' || (statusCode != null && statusCode! >= 500);

  /// `details.retry == true`: the account was busy, trying again shortly will usually work.
  bool get isRetryable => details['retry'] == true;

  int? get attemptsRemaining {
    final Object? value = details['attemptsRemaining'];
    return value is int ? value : null;
  }

  DateTime? get lockedUntil {
    final Object? value = details['lockedUntil'];
    return value is String ? DateTime.tryParse(value)?.toLocal() : null;
  }

  String? get limitReason {
    final Object? value = details['reason'];
    return value is String ? value : null;
  }

  @override
  String toString() => 'ApiException($code, $message)';
}
