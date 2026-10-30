import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

/// The signed-in person, as far as the app cares.
@immutable
class AuthUser {
  const AuthUser({
    required this.uid,
    required this.email,
    required this.displayName,
    required this.emailVerified,
  });

  final String uid;
  final String email;
  final String? displayName;
  final bool emailVerified;

  @override
  bool operator ==(Object other) {
    return other is AuthUser &&
        other.uid == uid &&
        other.email == email &&
        other.displayName == displayName &&
        other.emailVerified == emailVerified;
  }

  @override
  int get hashCode => Object.hash(uid, email, displayName, emailVerified);
}

/// Identity operations. [FirebaseAuthService] is the real implementation; tests use a fake.
abstract class AuthService {
  AuthUser? get currentUser;

  /// Emits the current user (or null) first, then every sign-in, sign-out and profile or token change.
  Stream<AuthUser?> userChanges();

  Future<void> signIn({required String email, required String password});

  /// Creates the account, sets the display name and sends the verification email.
  Future<void> register({required String email, required String password, required String displayName});

  Future<void> sendVerificationEmail();

  /// Reloads the user from the server and refreshes the ID token (so `email_verified` is current).
  Future<void> reloadUser();

  Future<void> sendPasswordReset(String email);

  Future<void> signOut();

  /// Confirms the password of the signed-in user and refreshes the token's `auth_time`.
  Future<void> reauthenticate(String password);

  Future<void> changePassword({required String currentPassword, required String newPassword});

  Future<String?> idToken(bool forceRefresh);

  /// True when the ID token carries the `admin` custom claim.
  Future<bool> isAdmin({bool forceRefresh = false});
}

class FirebaseAuthService implements AuthService {
  FirebaseAuthService(this._auth);

  final FirebaseAuth _auth;

  static AuthUser? _map(User? user) {
    if (user == null) return null;
    return AuthUser(
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName,
      emailVerified: user.emailVerified,
    );
  }

  @override
  AuthUser? get currentUser => _map(_auth.currentUser);

  @override
  Stream<AuthUser?> userChanges() => _auth.userChanges().map(_map);

  @override
  Future<void> signIn({required String email, required String password}) async {
    await _auth.signInWithEmailAndPassword(email: email.trim(), password: password);
  }

  @override
  Future<void> register({required String email, required String password, required String displayName}) async {
    final UserCredential credential = await _auth.createUserWithEmailAndPassword(email: email.trim(), password: password);
    final User? user = credential.user;
    if (user == null) return;
    await user.updateDisplayName(displayName.trim());
    try {
      await user.sendEmailVerification();
    } on FirebaseAuthException catch (error) {
      // The verification screen offers "Resend email", so a failed first send must not fail the registration.
      debugPrint('Verification email was not sent: ${error.code}');
    }
  }

  @override
  Future<void> sendVerificationEmail() async {
    final User? user = _auth.currentUser;
    if (user == null) throw FirebaseAuthException(code: 'no-current-user', message: 'Please sign in again.');
    await user.sendEmailVerification();
  }

  @override
  Future<void> reloadUser() async {
    final User? user = _auth.currentUser;
    if (user == null) return;
    await user.reload();
    await _auth.currentUser?.getIdToken(true);
  }

  @override
  Future<void> sendPasswordReset(String email) async {
    await _auth.sendPasswordResetEmail(email: email.trim());
  }

  @override
  Future<void> signOut() => _auth.signOut();

  @override
  Future<void> reauthenticate(String password) async {
    final User? user = _auth.currentUser;
    final String? email = user?.email;
    if (user == null || email == null) {
      throw FirebaseAuthException(code: 'no-current-user', message: 'Please sign in again.');
    }
    await user.reauthenticateWithCredential(EmailAuthProvider.credential(email: email, password: password));
    await _auth.currentUser?.getIdToken(true);
  }

  @override
  Future<void> changePassword({required String currentPassword, required String newPassword}) async {
    await reauthenticate(currentPassword);
    final User? user = _auth.currentUser;
    if (user == null) throw FirebaseAuthException(code: 'no-current-user', message: 'Please sign in again.');
    await user.updatePassword(newPassword);
  }

  @override
  Future<String?> idToken(bool forceRefresh) async {
    return _auth.currentUser?.getIdToken(forceRefresh);
  }

  @override
  Future<bool> isAdmin({bool forceRefresh = false}) async {
    final User? user = _auth.currentUser;
    if (user == null) return false;
    final IdTokenResult result = await user.getIdTokenResult(forceRefresh);
    final Map<String, dynamic>? claims = result.claims;
    return claims != null && claims['admin'] == true;
  }
}
