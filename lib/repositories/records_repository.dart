import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/money/money.dart';
import '../models/money_record.dart';
import 'activity_log.dart';

/// `users/{uid}/records`. Every write also appends a client activity entry in the same batch.
class RecordsRepository {
  RecordsRepository(this._db);

  final FirebaseFirestore _db;

  /// Most records the app keeps in memory at once (newest first). Older ones stay in Firestore.
  static const int maxLoaded = 5000;

  CollectionReference<Map<String, dynamic>> _records(String uid) => userCollection(_db, uid, 'records');

  Stream<List<MoneyRecord>> watch(String uid) {
    return _records(uid).orderBy('date', descending: true).limit(maxLoaded).snapshots().map(
      (QuerySnapshot<Map<String, dynamic>> snapshot) {
        return snapshot.docs
            .map((QueryDocumentSnapshot<Map<String, dynamic>> doc) => MoneyRecord.fromMap(doc.id, doc.data()))
            .toList();
      },
    );
  }

  Map<String, Object?> _fields(RecordDraft draft) {
    return <String, Object?>{
      'kind': draft.kind,
      'title': draft.title.trim(),
      'amountMinor': draft.amountMinor,
      'currency': draft.currency,
      'categoryId': draft.categoryId,
      'categoryName': draft.categoryName,
      'date': Timestamp.fromDate(draft.date),
      'notes': draft.notes.trim(),
      'tags': draft.tags,
    };
  }

  String _summary(String verb, RecordDraft draft) {
    return '$verb ${draft.kind} "${draft.title.trim()}" (${formatMoney(draft.amountMinor, draft.currency, showCode: true)})';
  }

  Future<String> add(String uid, RecordDraft draft) async {
    final DocumentReference<Map<String, dynamic>> ref = _records(uid).doc();
    final WriteBatch batch = _db.batch();
    batch.set(ref, <String, Object?>{
      ..._fields(draft),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    batch.set(
      userCollection(_db, uid, 'activity').doc(),
      clientActivity(type: 'record_added', summary: _summary('Added', draft), entityType: 'record', entityId: ref.id),
    );
    await batch.commit();
    return ref.id;
  }

  Future<void> update(String uid, String id, RecordDraft draft) async {
    final DocumentReference<Map<String, dynamic>> ref = _records(uid).doc(id);
    final WriteBatch batch = _db.batch();
    batch.update(ref, <String, Object?>{..._fields(draft), 'updatedAt': FieldValue.serverTimestamp()});
    batch.set(
      userCollection(_db, uid, 'activity').doc(),
      clientActivity(type: 'record_updated', summary: _summary('Updated', draft), entityType: 'record', entityId: id),
    );
    await batch.commit();
  }

  Future<void> delete(String uid, MoneyRecord record) async {
    final WriteBatch batch = _db.batch();
    batch.delete(_records(uid).doc(record.id));
    batch.set(
      userCollection(_db, uid, 'activity').doc(),
      clientActivity(
        type: 'record_deleted',
        summary: 'Deleted ${record.kind} "${record.title}" (${formatMoney(record.amountMinor, record.currency, showCode: true)})',
        entityType: 'record',
        entityId: record.id,
      ),
    );
    await batch.commit();
  }

  /// Deletes several records (in batches of 200, each with its own activity entry for the batch).
  Future<void> deleteMany(String uid, List<MoneyRecord> records) async {
    const int chunk = 200;
    for (int start = 0; start < records.length; start += chunk) {
      final int end = start + chunk > records.length ? records.length : start + chunk;
      final WriteBatch batch = _db.batch();
      for (final MoneyRecord record in records.sublist(start, end)) {
        batch.delete(_records(uid).doc(record.id));
      }
      batch.set(
        userCollection(_db, uid, 'activity').doc(),
        clientActivity(type: 'records_deleted', summary: 'Deleted ${end - start} records', entityType: 'record'),
      );
      await batch.commit();
    }
  }
}
