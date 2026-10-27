'use strict';

const { toDate } = require('../util');
const { applyDepositResult, closeDeposit } = require('../handlers/deposits');

/**
 * Safety net for deposits whose webhook never arrived (or failed): asks the provider about every pending deposit,
 * credits the paid ones, expires stale ones. Idempotent: the same code path as /sync and the webhook.
 */
async function reconcilePendingDeposits(deps) {
  const { store, clock, config, provider, logger } = deps;
  const now = clock.now();
  const summary = { examined: 0, credited: 0, expired: 0, errors: 0 };
  const pending = await store.walletTxs().where('kind', '==', 'deposit').where('status', '==', 'pending').limit(200).get();

  for (const doc of pending.docs) {
    summary.examined += 1;
    const t = doc.data();
    const ageMinutes = (now.getTime() - toDate(t.createdAt).getTime()) / 60000;
    try {
      if (!t.providerRef) {
        if (ageMinutes >= config.depositStaleMinutes) {
          await closeDeposit(deps, doc.id, { status: 'expired', reason: 'no_checkout', notify: false, by: 'system' });
          summary.expired += 1;
        }
        continue;
      }
      if (ageMinutes < 2) continue;
      const result = await provider.fetchPayment(t.providerRef);
      let outcome = await applyDepositResult(deps, doc.id, result, 'system');
      if (outcome.data.status === 'completed' && outcome.changed) summary.credited += 1;
      if (outcome.data.status === 'expired' && outcome.changed) summary.expired += 1;
      if (outcome.data.status === 'pending' && ageMinutes >= config.depositExpireHours * 60) {
        try {
          await provider.expireCheckout(t.providerRef);
        } catch (error) {
          logger.warn('Could not expire an old checkout at the provider', { txId: doc.id });
        }
        outcome = await closeDeposit(deps, doc.id, { status: 'expired', reason: 'expired', notify: true, by: 'system' });
        if (outcome.changed) summary.expired += 1;
      }
    } catch (error) {
      summary.errors += 1;
      logger.error('Could not reconcile a pending deposit', { txId: doc.id, code: error && error.code, message: error && error.message });
    }
  }
  return summary;
}

/** Deletes rate-limit, idempotency, webhook-dedupe and daily-limit documents past their expiresAt. */
async function cleanupExpired(deps) {
  const { store, clock } = deps;
  const now = clock.now();
  const targets = {
    rateLimits: store.rateLimits(),
    idempotency: store.idempotencies(),
    providerEvents: store.providerEvents(),
    walletDaily: store.dailies(),
  };
  const deleted = {};
  for (const [name, collection] of Object.entries(targets)) {
    deleted[name] = 0;
    for (let round = 0; round < 20; round += 1) {
      const snapshot = await collection.where('expiresAt', '<', now).limit(300).get();
      if (snapshot.empty) break;
      const batch = store.db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted[name] += snapshot.size;
      if (snapshot.size < 300) break;
    }
  }
  return deleted;
}

module.exports = { reconcilePendingDeposits, cleanupExpired };
