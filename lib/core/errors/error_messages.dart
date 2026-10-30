import 'dart:async';

import 'package:firebase_core/firebase_core.dart' show FirebaseException;
import 'package:firebase_auth/firebase_auth.dart' show FirebaseAuthException;

import '../money/money.dart';
import 'api_exception.dart';

/// Turns any error into a short sentence that is safe and useful to show to the person using the app.
String friendlyError(Object error) {
  if (error is ApiException) return _apiMessage(error);
  if (error is FirebaseAuthException) return _authMessage(error);
  if (error is FirebaseException) return _firebaseMessage(error);
  if (error is TimeoutException) return 'The request took too long. Check your connection and try again.';
  if (error is FormatException) return 'The server sent an answer the app could not read.';
  return 'Something went wrong. Please try again.';
}

String _apiMessage(ApiException error) {
  switch (error.code) {
    case 'network':
      return 'Could not reach the server. Check your connection and try again.';
    case 'bad_response':
      return 'The server sent an answer the app could not read.';
    case 'not_configured':
      return 'This feature is not set up on the server yet.';
    case 'pin_incorrect':
      final int? left = error.attemptsRemaining;
      return left == null ? 'That PIN is not correct.' : 'That PIN is not correct. $left attempt${left == 1 ? '' : 's'} left.';
    case 'pin_locked':
      final DateTime? until = error.lockedUntil;
      if (until == null) return 'PIN entry is locked for a while. Try again later.';
      final int minutes = until.difference(DateTime.now()).inMinutes + 1;
      return 'PIN entry is locked. Try again in ${minutes < 1 ? 1 : minutes} min.';
    case 'conflict':
      return error.isRetryable ? 'Your account is busy right now. Please try again in a moment.' : error.message;
    case 'limit_exceeded':
      return error.message;
    default:
      return error.message.isEmpty ? 'The request failed (${error.code}).' : error.message;
  }
}

String _authMessage(FirebaseAuthException error) {
  switch (error.code) {
    case 'invalid-email':
      return 'That email address is not valid.';
    case 'user-disabled':
      return 'This account has been disabled.';
    case 'user-not-found':
    case 'wrong-password':
    case 'invalid-credential':
    case 'invalid-login-credentials':
      return 'The email or password is not correct.';
    case 'email-already-in-use':
      return 'An account with this email already exists.';
    case 'weak-password':
      return 'Choose a stronger password (at least 8 characters).';
    case 'too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'network-request-failed':
      return 'Could not reach the server. Check your connection and try again.';
    case 'requires-recent-login':
      return 'Please confirm your password again to continue.';
    case 'operation-not-allowed':
      return 'Email and password sign-in is not enabled for this project.';
    default:
      return error.message == null || error.message!.isEmpty ? 'Sign-in failed (${error.code}).' : error.message!;
  }
}

String _firebaseMessage(FirebaseException error) {
  switch (error.code) {
    case 'permission-denied':
      return 'You do not have permission to do that.';
    case 'unavailable':
    case 'network-request-failed':
      return 'Could not reach the server. Check your connection and try again.';
    case 'not-found':
      return 'That item no longer exists.';
    case 'unauthenticated':
      return 'Please sign in again.';
    case 'object-not-found':
      return 'The file no longer exists.';
    case 'quota-exceeded':
      return 'The storage quota was reached.';
    default:
      return error.message == null || error.message!.isEmpty ? 'The request failed (${error.code}).' : error.message!;
  }
}

/// Reason texts for `problem` values of `/wallet/quote` and `limit_exceeded.details.reason`.
String describeLimit(String reason, {required String currency, int? minMinor, int? maxMinor, int? remainingMinor}) {
  switch (reason) {
    case 'below_min':
      return minMinor == null ? 'That amount is below the minimum.' : 'The minimum is ${formatMoney(minMinor, currency)}.';
    case 'above_max':
      return maxMinor == null ? 'That amount is above the maximum.' : 'The maximum is ${formatMoney(maxMinor, currency)}.';
    case 'daily_limit':
      return remainingMinor == null
          ? 'This would go over your daily limit.'
          : 'This would go over your daily limit. You can still send ${formatMoney(remainingMinor, currency)} today.';
    case 'insufficient_funds':
      return 'Your available balance is not enough for this amount and its fee.';
    case 'unavailable':
      return 'This is not available right now.';
    case 'wallet_limit':
      return 'This would push a wallet over its balance limit.';
    case 'max_destinations':
      return 'You can save up to 5 payout destinations. Remove one first.';
    default:
      return 'This amount cannot be used.';
  }
}
