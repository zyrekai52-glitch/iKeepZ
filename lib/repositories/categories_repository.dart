import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/category.dart';
import 'activity_log.dart';

/// `users/{uid}/categories`.
class CategoriesRepository {
  CategoriesRepository(this._db);

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> _categories(String uid) => userCollection(_db, uid, 'categories');

  Stream<List<Category>> watch(String uid) {
    return _categories(uid).snapshots().map((QuerySnapshot<Map<String, dynamic>> snapshot) {
      final List<Category> list = snapshot.docs
          .map((QueryDocumentSnapshot<Map<String, dynamic>> doc) => Category.fromMap(doc.id, doc.data()))
          .toList();
      list.sort((Category a, Category b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      return list;
    });
  }

  Future<String> add(String uid, CategoryDraft draft) async {
    final DocumentReference<Map<String, dynamic>> ref = _categories(uid).doc();
    final WriteBatch batch = _db.batch();
    batch.set(ref, <String, Object?>{
      'name': draft.name.trim(),
      'kind': draft.kind,
      'color': draft.color,
      'icon': draft.icon,
      'archived': false,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    batch.set(
      userCollection(_db, uid, 'activity').doc(),
      clientActivity(type: 'category_added', summary: 'Added category "${draft.name.trim()}"', entityType: 'category', entityId: ref.id),
    );
    await batch.commit();
    return ref.id;
  }

  Future<void> update(String uid, String id, CategoryDraft draft) async {
    final WriteBatch batch = _db.batch();
    batch.update(_categories(uid).doc(id), <String, Object?>{
      'name': draft.name.trim(),
      'kind': draft.kind,
      'color': draft.color,
      'icon': draft.icon,
      'updatedAt': FieldValue.serverTimestamp(),
    });
    batch.set(
      userCollection(_db, uid, 'activity').doc(),
      clientActivity(type: 'category_updated', summary: 'Updated category "${draft.name.trim()}"', entityType: 'category', entityId: id),
    );
    await batch.commit();
  }

  Future<void> setArchived(String uid, Category category, bool archived) async {
    final WriteBatch batch = _db.batch();
    batch.update(_categories(uid).doc(category.id), <String, Object?>{
      'archived': archived,
      'updatedAt': FieldValue.serverTimestamp(),
    });
    batch.set(
      userCollection(_db, uid, 'activity').doc(),
      clientActivity(
        type: archived ? 'category_archived' : 'category_restored',
        summary: '${archived ? 'Archived' : 'Restored'} category "${category.name}"',
        entityType: 'category',
        entityId: category.id,
      ),
    );
    await batch.commit();
  }

  Future<void> delete(String uid, Category category) async {
    final WriteBatch batch = _db.batch();
    batch.delete(_categories(uid).doc(category.id));
    batch.set(
      userCollection(_db, uid, 'activity').doc(),
      clientActivity(type: 'category_deleted', summary: 'Deleted category "${category.name}"', entityType: 'category', entityId: category.id),
    );
    await batch.commit();
  }
}
