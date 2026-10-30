import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/payout_destination.dart';
import '../models/wallet.dart';
import '../models/wallet_tx.dart';
import 'activity_log.dart';

/// Read-only views of the wallet. All of these documents are written by the backend only; the Firestore rules
/// give the app read access (own wallet, own ledger, own destinations, transactions it took part in).
class WalletRepository {
  WalletRepository(this._db);

  final FirebaseFirestore _db;

  Stream<Wallet?> watchWallet(String uid) {
    return _db.collection('wallets').doc(uid).snapshots().map((DocumentSnapshot<Map<String, dynamic>> snapshot) {
      final Map<String, dynamic>? data = snapshot.data();
      if (!snapshot.exists || data == null) return null;
      return Wallet.fromMap(uid, data);
    });
  }

  /// Newest first. The query filters on `participants` as the rules require.
  Stream<List<WalletTx>> watchTransactions(String uid, {int limit = 200}) {
    return _db
        .collection('walletTx')
        .where('participants', arrayContains: uid)
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((QuerySnapshot<Map<String, dynamic>> snapshot) {
      return snapshot.docs
          .map((QueryDocumentSnapshot<Map<String, dynamic>> doc) => WalletTx.fromMap(doc.id, doc.data()))
          .toList();
    });
  }

  Stream<List<LedgerEntry>> watchLedger(String uid, {int limit = 200}) {
    return _db
        .collection('wallets')
        .doc(uid)
        .collection('ledger')
        .orderBy('seq', descending: true)
        .limit(limit)
        .snapshots()
        .map((QuerySnapshot<Map<String, dynamic>> snapshot) {
      return snapshot.docs
          .map((QueryDocumentSnapshot<Map<String, dynamic>> doc) => LedgerEntry.fromMap(doc.id, doc.data()))
          .toList();
    });
  }

  Stream<List<PayoutDestination>> watchDestinations(String uid) {
    return userCollection(_db, uid, 'destinations')
        .where('status', isEqualTo: 'active')
        .snapshots()
        .map((QuerySnapshot<Map<String, dynamic>> snapshot) {
      final List<PayoutDestination> list = snapshot.docs
          .map((QueryDocumentSnapshot<Map<String, dynamic>> doc) => PayoutDestination.fromMap(doc.id, doc.data()))
          .toList();
      list.sort((PayoutDestination a, PayoutDestination b) {
        final DateTime left = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        final DateTime right = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        return left.compareTo(right);
      });
      return list;
    });
  }
}
