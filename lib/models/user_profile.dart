import '../core/utils/json.dart';
import 'preferences.dart';

/// "Maria Santos" -> "MS", "maria" -> "M", "" -> "?".
String initialsOf(String name) {
  final List<String> words = name.trim().split(RegExp(r'\s+')).where((String w) => w.isNotEmpty).toList();
  if (words.isEmpty) return '?';
  if (words.length == 1) return words.first.substring(0, 1).toUpperCase();
  return (words.first.substring(0, 1) + words.last.substring(0, 1)).toUpperCase();
}

/// `users/{uid}`. Created by the backend (`POST /bootstrap`); the app may only change the display name,
/// the photo URL and the preferences.
class UserProfile {
  const UserProfile({
    required this.uid,
    required this.email,
    required this.displayName,
    required this.photoUrl,
    required this.walletCurrency,
    required this.status,
    required this.withdrawalsEnabled,
    required this.transfersEnabled,
    required this.kycStatus,
    required this.preferences,
    required this.createdAt,
  });

  factory UserProfile.fromMap(String uid, Map<String, dynamic> map) {
    return UserProfile(
      uid: uid,
      email: readString(map['email']),
      displayName: readString(map['displayName'], 'iKeepZ user'),
      photoUrl: readStringOrNull(map['photoUrl']),
      walletCurrency: readString(map['walletCurrency'], 'PHP'),
      status: readString(map['status'], 'active'),
      withdrawalsEnabled: readBool(map['withdrawalsEnabled'], true),
      transfersEnabled: readBool(map['transfersEnabled'], true),
      kycStatus: readString(map['kycStatus'], 'none'),
      preferences: Preferences.fromMap(map['preferences']),
      createdAt: readDate(map['createdAt']),
    );
  }

  final String uid;
  final String email;
  final String displayName;
  final String? photoUrl;
  final String walletCurrency;
  final String status;
  final bool withdrawalsEnabled;
  final bool transfersEnabled;
  final String kycStatus;
  final Preferences preferences;
  final DateTime? createdAt;

  bool get isActive => status == 'active';

  String get initials => initialsOf(displayName);

  String get kycLabel {
    switch (kycStatus) {
      case 'approved':
        return 'Verified';
      case 'pending':
        return 'Under review';
      case 'rejected':
        return 'Not approved';
      default:
        return 'Not started';
    }
  }
}
