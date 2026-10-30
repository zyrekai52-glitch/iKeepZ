import 'package:cloud_firestore/cloud_firestore.dart';

/// Field map for a client-written entry in `users/{uid}/activity` (the rules accept exactly these keys).
Map<String, Object?> clientActivity({
  required String type,
  required String summary,
  String? entityType,
  String? entityId,
}) {
  final String trimmed = summary.length > 200 ? '${summary.substring(0, 197)}...' : summary;
  return <String, Object?>{
    'type': type,
    'summary': trimmed,
    'entityType': entityType,
    'entityId': entityId,
    'source': 'client',
    'createdAt': FieldValue.serverTimestamp(),
  };
}

CollectionReference<Map<String, dynamic>> userCollection(FirebaseFirestore db, String uid, String name) {
  return db.collection('users').doc(uid).collection(name);
}
