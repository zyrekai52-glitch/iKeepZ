import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/errors/api_exception.dart';

/// Supplies the Firebase ID token; [forceRefresh] asks for a freshly minted one.
typedef TokenProvider = Future<String?> Function(bool forceRefresh);

/// Thin JSON client for the iKeepZ HTTPS API (see docs/ARCHITECTURE.md section 4).
///
/// Success bodies are `{"data": {...}}`, failures `{"error": {"code", "message", "details"?}}`. Every failure is
/// surfaced as an [ApiException]; a missing answer (offline, timeout) becomes code `network`, which means the
/// outcome of a write is unknown and the same idempotency key should be reused when retrying.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required TokenProvider tokenProvider,
    http.Client? httpClient,
    Duration timeout = const Duration(seconds: 30),
  })  : _baseUrl = baseUrl,
        _tokenProvider = tokenProvider,
        _http = httpClient ?? http.Client(),
        _timeout = timeout;

  final String _baseUrl;
  final TokenProvider _tokenProvider;
  final http.Client _http;
  final Duration _timeout;

  bool get isConfigured => _baseUrl.isNotEmpty;

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query, bool auth = true}) {
    return _send('GET', path, query: query, auth: auth);
  }

  Future<Map<String, dynamic>> post(String path, {Map<String, dynamic>? body, bool auth = true}) {
    return _send('POST', path, body: body ?? <String, dynamic>{}, auth: auth);
  }

  Future<Map<String, dynamic>> delete(String path) {
    return _send('DELETE', path);
  }

  void close() => _http.close();

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
    bool auth = true,
  }) async {
    if (!isConfigured) {
      throw const ApiException(
        code: 'not_configured_client',
        message: 'The app has no API address. Set API_BASE_URL in config/app_config.json and rebuild.',
      );
    }
    try {
      final http.Response first = await _once(method, path, query, body, auth, false);
      if (first.statusCode == 401 && auth) {
        // The cached ID token may have expired or been revoked: ask for a fresh one once.
        final http.Response second = await _once(method, path, query, body, auth, true);
        return _unwrap(second);
      }
      return _unwrap(first);
    } on TimeoutException {
      throw const ApiException(code: 'network', message: 'The server did not answer in time.');
    } on http.ClientException {
      throw const ApiException(code: 'network', message: 'Could not reach the server.');
    }
  }

  Future<http.Response> _once(
    String method,
    String path,
    Map<String, String>? query,
    Map<String, dynamic>? body,
    bool auth,
    bool forceRefresh,
  ) async {
    final Uri uri = Uri.parse('$_baseUrl$path').replace(
      queryParameters: query == null || query.isEmpty ? null : query,
    );
    final Map<String, String> headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (auth) {
      final String? token = await _tokenProvider(forceRefresh);
      if (token == null || token.isEmpty) {
        throw const ApiException(code: 'unauthenticated', message: 'Please sign in again.', statusCode: 401);
      }
      headers['Authorization'] = 'Bearer $token';
    }
    final http.Request request = http.Request(method, uri);
    request.headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);
    final http.StreamedResponse streamed = await _http.send(request).timeout(_timeout);
    return http.Response.fromStream(streamed).timeout(_timeout);
  }

  Map<String, dynamic> _unwrap(http.Response response) {
    Object? decoded;
    try {
      decoded = response.body.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw ApiException(
        code: 'bad_response',
        message: 'The server sent an answer the app could not read.',
        statusCode: response.statusCode,
      );
    }
    final Map<String, dynamic> map = decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{};
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final Object? data = map['data'];
      if (data is Map) return Map<String, dynamic>.from(data);
      throw ApiException(
        code: 'bad_response',
        message: 'The server sent an answer the app could not read.',
        statusCode: response.statusCode,
      );
    }
    final Object? error = map['error'];
    if (error is Map) {
      final Object? code = error['code'];
      final Object? message = error['message'];
      final Object? details = error['details'];
      throw ApiException(
        code: code is String ? code : 'internal',
        message: message is String ? message : 'The request failed.',
        statusCode: response.statusCode,
        details: details is Map ? Map<String, dynamic>.from(details) : const <String, dynamic>{},
      );
    }
    throw ApiException(
      code: response.statusCode == 401 ? 'unauthenticated' : 'internal',
      message: response.statusCode == 401 ? 'Please sign in again.' : 'The server answered with an error (${response.statusCode}).',
      statusCode: response.statusCode,
    );
  }
}
