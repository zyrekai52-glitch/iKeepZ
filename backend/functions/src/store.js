'use strict';

/** Collection / document references in one place so paths cannot drift between modules. */
function createStore(db) {
  const col = (path) => db.collection(path);
  return {
    db,
    user: (uid) => col('users').doc(uid),
    records: (uid) => col('users').doc(uid).collection('records'),
    categories: (uid) => col('users').doc(uid).collection('categories'),
    activity: (uid) => col('users').doc(uid).collection('activity'),
    notifications: (uid) => col('users').doc(uid).collection('notifications'),
    destinations: (uid) => col('users').doc(uid).collection('destinations'),
    wallets: () => col('wallets'),
    wallet: (uid) => col('wallets').doc(uid),
    ledger: (uid) => col('wallets').doc(uid).collection('ledger'),
    walletTxs: () => col('walletTx'),
    walletTx: (id) => col('walletTx').doc(id),
    walletTxEvents: (id) => col('walletTx').doc(id).collection('events'),
    walletCode: (code) => col('walletCodes').doc(code),
    security: (uid) => col('walletSecurity').doc(uid),
    destinationSecret: (id) => col('destinationSecrets').doc(id),
    idempotency: (hash) => col('idempotency').doc(hash),
    idempotencies: () => col('idempotency'),
    rateLimit: (key) => col('rateLimits').doc(key),
    rateLimits: () => col('rateLimits'),
    daily: (key) => col('walletDaily').doc(key),
    dailies: () => col('walletDaily'),
    providerEvent: (id) => col('providerEvents').doc(id),
    providerEvents: () => col('providerEvents'),
    platformRevenue: (currency) => col('platformRevenue').doc(currency),
    platformRevenues: () => col('platformRevenue'),
    adminAudit: () => col('adminAudit'),
  };
}

module.exports = { createStore };
