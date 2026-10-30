import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/notification_item.dart';
import 'activity_log.dart';

/// `users/{uid}/notifications` (created by the backend; the app marks them read or deletes them)
/// and `users/{uid}/activity` (the append-only log).
class NotificationsRepository {
  NotificationsRepository(this._db);

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> _notifications(String uid) => userCollection(_db, uid, 'notifications');

  Stream<List<NotificationItem>> watch(String uid, {int limit = 100}) {
    return _notifications(uid).orderBy('createdAt', descending: true).limit(limit).snapshots().map(
      (QuerySnapshot<Map<String, dynamic>> snapshot) {
        return snapshot.docs
            .map((QueryDocumentSnapshot<Map<String, dynamic>> doc) => NotificationItem.fromMap(doc.id, doc.data()))
            .toList();
      },
    );
  }

  Future<void> markRead(String uid, String id) {
    return _notifications(uid).doc(id).update(<String, Object?>{'readAt': FieldValue.serverTimestamp()});
  }

  /// Marks the given notifications read (only unread ones are accepted by the rules).
  Future<void> markAllRead(String uid, List<String> unreadIds) async {
    const int chunk = 400;
    for (int start = 0; start < unreadIds.length; start += chunk) {
      final int end = start + chunk > unreadIds.length ? unreadIds.length : start + chunk;
      final WriteBatch batch = _db.batch();
      for (final String id in unreadIds.sublist(start, end)) {
        batch.update(_notifications(uid).doc(id), <String, Object?>{'readAt': FieldValue.serverTimestamp()});
      }
      await batch.commit();
    }
  }

  Future<void> delete(String uid, String id) => _notifications(uid).doc(id).delete();

  Stream<List<ActivityItem>> watchActivity(String uid, {int limit = 100}) {
    return userCollection(_db, uid, 'activity').orderBy('createdAt', descending: true).limit(limit).snapshots().map(
      (QuerySnapshot<Map<String, dynamic>> snapshot) {
        return snapshot.docs
            .map((QueryDocumentSnapshot<Map<String, dynamic>> doc) => ActivityItem.fromMap(doc.id, doc.data()))
            .toList();
      },
    );
  }

  /// Adds an entry to the activity log (for example "Exported records as CSV").
  Future<void> logActivity(String uid, {required String type, required String summary}) {
    return userCollection(_db, uid, 'activity').doc().set(clientActivity(type: type, summary: summary));
  }
}
