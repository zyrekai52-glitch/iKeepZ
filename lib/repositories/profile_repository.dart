import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

import '../models/preferences.dart';
import '../models/user_profile.dart';

/// `users/{uid}` (profile fields the app may change) and the profile photo in Firebase Storage.
class ProfileRepository {
  ProfileRepository(this._db, this._storage);

  final FirebaseFirestore _db;
  final FirebaseStorage _storage;

  DocumentReference<Map<String, dynamic>> _doc(String uid) => _db.collection('users').doc(uid);

  Stream<UserProfile?> watch(String uid) {
    return _doc(uid).snapshots().map((DocumentSnapshot<Map<String, dynamic>> snapshot) {
      final Map<String, dynamic>? data = snapshot.data();
      if (!snapshot.exists || data == null) return null;
      return UserProfile.fromMap(uid, data);
    });
  }

  Future<void> updatePreferences(String uid, Preferences preferences) {
    return _doc(uid).update(<String, Object?>{
      'preferences': preferences.toMap(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateDisplayName(String uid, String displayName) {
    return _doc(uid).update(<String, Object?>{
      'displayName': displayName.trim(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updatePhotoUrl(String uid, String? url) {
    return _doc(uid).update(<String, Object?>{'photoUrl': url, 'updatedAt': FieldValue.serverTimestamp()});
  }

  /// Uploads [pngBytes] as the profile photo and returns its download URL. The Storage rules accept only
  /// `users/{uid}/avatar/avatar.png|jpg|webp`, image content types and files under 2 MiB.
  Future<String> uploadAvatar(String uid, Uint8List pngBytes) async {
    final Reference reference = _storage.ref('users/$uid/avatar/avatar.png');
    await reference.putData(pngBytes, SettableMetadata(contentType: 'image/png'));
    return reference.getDownloadURL();
  }

  Future<void> deleteAvatar(String uid) async {
    try {
      await _storage.ref('users/$uid/avatar/avatar.png').delete();
    } on FirebaseException catch (error) {
      if (error.code != 'object-not-found') rethrow;
    }
  }
}
