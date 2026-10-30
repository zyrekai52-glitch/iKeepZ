import '../core/utils/json.dart';

/// `users/{uid}/notifications/{id}`: created by the backend; the app can mark one read or delete it.
class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.type,
    required this.group,
    required this.title,
    required this.body,
    required this.txId,
    required this.readAt,
    required this.createdAt,
  });

  factory NotificationItem.fromMap(String id, Map<String, dynamic> map) {
    final Map<String, dynamic> data = readMap(map['data']);
    return NotificationItem(
      id: id,
      type: readString(map['type']),
      group: readChoice(map['group'], const <String>['wallet', 'security'], 'wallet'),
      title: readString(map['title']),
      body: readString(map['body']),
      txId: readStringOrNull(data['txId']),
      readAt: readDate(map['readAt']),
      createdAt: readDate(map['createdAt']),
    );
  }

  final String id;
  final String type;

  /// `wallet` or `security` (security notifications cannot be switched off).
  final String group;
  final String title;
  final String body;
  final String? txId;
  final DateTime? readAt;
  final DateTime? createdAt;

  bool get isRead => readAt != null;
  bool get isSecurity => group == 'security';
}

/// `users/{uid}/activity/{id}`: the append-only account activity log.
class ActivityItem {
  const ActivityItem({
    required this.id,
    required this.type,
    required this.summary,
    required this.entityType,
    required this.entityId,
    required this.source,
    required this.createdAt,
  });

  factory ActivityItem.fromMap(String id, Map<String, dynamic> map) {
    return ActivityItem(
      id: id,
      type: readString(map['type']),
      summary: readString(map['summary']),
      entityType: readStringOrNull(map['entityType']),
      entityId: readStringOrNull(map['entityId']),
      source: readString(map['source'], 'client'),
      createdAt: readDate(map['createdAt']),
    );
  }

  final String id;
  final String type;
  final String summary;
  final String? entityType;
  final String? entityId;

  /// `client` (written by this app) or `server`.
  final String source;
  final DateTime? createdAt;
}
