import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;

/// Tolerant readers for data coming from Firestore documents or from the HTTP API (where timestamps are
/// ISO-8601 strings). They never throw: a missing or mistyped field falls back to a safe default.

String readString(Object? value, [String fallback = '']) {
  return value is String ? value : fallback;
}

String? readStringOrNull(Object? value) {
  return value is String ? value : null;
}

int readInt(Object? value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return fallback;
}

int? readIntOrNull(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return null;
}

bool readBool(Object? value, [bool fallback = false]) {
  return value is bool ? value : fallback;
}

DateTime? readDate(Object? value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

List<String> readStringList(Object? value) {
  if (value is! List) return <String>[];
  final List<String> out = <String>[];
  for (final Object? item in value) {
    if (item is String) out.add(item);
  }
  return out;
}

Map<String, dynamic> readMap(Object? value) {
  if (value is Map) {
    final Map<String, dynamic> out = <String, dynamic>{};
    value.forEach((Object? key, Object? item) {
      if (key is String) out[key] = item;
    });
    return out;
  }
  return <String, dynamic>{};
}

/// [value] if it is one of [allowed], otherwise [fallback].
String readChoice(Object? value, List<String> allowed, String fallback) {
  if (value is String && allowed.contains(value)) return value;
  return fallback;
}

int clampInt(int value, int low, int high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}
