'use strict';

const { err } = require('../errors');
const { parse, str } = require('../validation');
const { newReference } = require('../util');
const { formatDisplay } = require('../money');
const { applyLedger } = require('../ledger');
const { queueNotification, queueActivity, queueEvent, queueAudit } = require('../effects');
const common = require('./common');
const { transitionWithdrawal } = require('./withdrawals');

const WITHDRAWAL_STATUSES = ['pending_review', 'approved', 'completed', 'rejected', 'cancelled', 'failed'];

function intQuery(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw err('invalid_argument', `limit must be a whole number between ${min} and ${max}`, { field: 'limit' });
  }
  return parsed;
}

/** The review queue. Admins see the full payout details (the account number is never sent to ordinary clients). */
async function listWithdrawals(ctx) {
  const { deps, user, query } = ctx;
  const { store } = deps;
  const status = query.status === undefined || query.status === '' ? null : String(query.status);
  if (status !== null && !WITHDRAWAL_STATUSES.includes(status)) {
    throw err('invalid_argument', 'status is not valid', { field: 'status' });
  }
  const limit = intQuery(query.limit, 50, 1, 100);
  let q = store.walletTxs().where('kind', '==', 'withdrawal');
  if (status) q = q.where('status', '==', status);
  const snapshot = await q.orderBy('createdAt', 'desc').limit(limit).get();
  const items = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const t = doc.data();
      const owner = await store.user(t.ownerUid).get();
      const secret = t.destinationId ? await store.destinationSecret(t.destinationId).get() : null;
      const payout = secret && secret.exists ? secret.data() : null;
      return {
        tx: common.toApiTx(doc.id, t, user.uid),
        userEmail: owner.exists ? owner.data().email : null,
        destination: payout
          ? {
              kind: payout.kind,
              providerName: payout.providerName,
              accountName: payout.accountName,
              accountNumber: payout.accountNumber,
            }
          : null,
      };
    }),
  );
  return { items };
}

const BODY_SCHEMAS = {
  approve: {},
  reject: { reason: str({ min: 3, max: 200 }) },
  fail: { reason: str({ min: 3, max: 200 }) },
  complete: { payoutReference: str({ min: 3, max: 80 }) },
};

function withdrawalAction(action) {
  return async (ctx) => {
    const { deps, user, params } = ctx;
    const input = parse(BODY_SCHEMAS[action], ctx.body, { allowEmpty: true });
    const result = await transitionWithdrawal(deps, {
      txId: params.id,
      action,
      actorUid: user.uid,
      actorRole: 'admin',
      reason: input.reason || null,
      payoutReference: input.payoutReference || null,
    });
    return { tx: common.toApiTx(result.id, result.data, user.uid) };
  };
}

/**
 * Reverses a completed deposit or transfer with compensating ledger entries (nothing is edited or deleted).
 * Reversing a deposit does NOT refund the customer's card/e-wallet payment; do that in the provider dashboard.
 */
async function reverseTransaction(ctx) {
  const { deps, user, params } = ctx;
  const { store, clock } = deps;
  const input = parse({ reason: str({ min: 3, max: 200 }) }, ctx.body);
  const reversalId = newReference('REV');

  const result = await store.db.runTransaction(async (tx) => {
    const originalSnapshot = await tx.get(store.walletTx(params.id));
    if (!originalSnapshot.exists) throw err('not_found', 'Transaction not found.');
    const t = originalSnapshot.data();
    if (!['deposit', 'transfer'].includes(t.kind) || t.status !== 'completed') {
      throw err('invalid_state', 'Only completed deposits and transfers can be reversed.', { kind: t.kind, status: t.status });
    }
    const uids = [...new Set(t.participants)].sort();
    const wallets = {};
    const users = {};
    for (const uid of uids) {
      wallets[uid] = await tx.get(store.wallet(uid));
      users[uid] = await tx.get(store.user(uid));
    }
    const revenueSnapshot = await tx.get(store.platformRevenue(t.currency));
    const now = clock.now();

    let reversal;
    if (t.kind === 'deposit') {
      applyLedger(tx, store, t.ownerUid, wallets[t.ownerUid].data(), {
        txId: reversalId,
        type: 'reversal_debit',
        deltaAvailableMinor: -t.amountMinor,
        now,
      });
      reversal = {
        ownerUid: t.ownerUid,
        counterpartyUid: null,
        participants: [t.ownerUid],
        directions: { [t.ownerUid]: 'debit' },
        amountMinor: t.amountMinor,
        feeMinor: 0,
        totalMinor: t.amountMinor,
        ownerDisplay: t.ownerDisplay,
        counterpartyDisplay: null,
      };
    } else {
      const sender = t.ownerUid;
      const recipient = t.counterpartyUid;
      applyLedger(tx, store, recipient, wallets[recipient].data(), {
        txId: reversalId,
        type: 'reversal_debit',
        deltaAvailableMinor: -t.amountMinor,
        now,
      });
      applyLedger(tx, store, sender, wallets[sender].data(), {
        txId: reversalId,
        type: 'reversal_credit',
        deltaAvailableMinor: t.totalMinor,
        now,
      });
      common.addRevenue(tx, store, revenueSnapshot, t.currency, -t.feeMinor, now);
      reversal = {
        ownerUid: sender,
        counterpartyUid: recipient,
        participants: [sender, recipient],
        directions: { [sender]: 'credit', [recipient]: 'debit' },
        amountMinor: t.amountMinor,
        feeMinor: t.feeMinor,
        totalMinor: t.totalMinor,
        ownerDisplay: t.ownerDisplay,
        counterpartyDisplay: t.counterpartyDisplay,
      };
    }

    const doc = common.newTxDoc({
      ...reversal,
      reference: reversalId,
      kind: 'reversal',
      status: 'completed',
      currency: t.currency,
      note: input.reason,
      reversesTxId: params.id,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    tx.create(store.walletTx(reversalId), doc);
    tx.update(store.walletTx(params.id), { status: 'reversed', reversedByTxId: reversalId, updatedAt: now });
    queueEvent(tx, store, params.id, { from: 'completed', to: 'reversed', by: 'admin', note: input.reason, now });
    queueEvent(tx, store, reversalId, { from: null, to: 'completed', by: 'admin', note: input.reason, now });
    for (const uid of t.participants) {
      queueNotification(tx, store, {
        uid,
        userData: users[uid].exists ? users[uid].data() : null,
        type: 'transaction_reversed',
        params: { kind: t.kind, amountMinor: t.amountMinor, currency: t.currency, reason: input.reason, txId: reversalId },
        now,
      });
      queueActivity(tx, store, uid, {
        type: 'transaction_reversed',
        summary: `${t.kind} of ${formatDisplay(t.amountMinor, t.currency)} reversed`,
        entityType: 'walletTx',
        entityId: reversalId,
        now,
      });
    }
    queueAudit(tx, store, {
      adminUid: user.uid,
      action: 'transaction_reverse',
      txId: params.id,
      targetUid: t.ownerUid,
      reason: input.reason,
      details: { reversalId, kind: t.kind },
      now,
    });
    return { original: { ...t, status: 'reversed', reversedByTxId: reversalId, updatedAt: now }, reversal: doc };
  });

  return {
    tx: common.toApiTx(reversalId, result.reversal, user.uid),
    original: common.toApiTx(params.id, result.original, user.uid),
  };
}

/** Recomputes every wallet from its immutable ledger and reports any disagreement. Paged by wallet id. */
async function reconcile(ctx) {
  const { deps, query } = ctx;
  const { store } = deps;
  const limit = intQuery(query.limit, 200, 1, 500);
  let q = store.wallets();
  if (query.after) {
    const after = await store.wallet(String(query.after)).get();
    if (!after.exists) throw err('invalid_argument', 'after is not a known wallet id', { field: 'after' });
    q = q.startAfter(after);
  }
  const page = await q.limit(limit).get();

  const mismatches = [];
  const report = (uid, field, expected, actual) => {
    if (expected !== actual) mismatches.push({ uid, field, expected, actual });
  };
  for (const doc of page.docs) {
    const wallet = doc.data();
    const ledger = await store.ledger(doc.id).get();
    let available = 0;
    let held = 0;
    for (const entry of ledger.docs) {
      available += entry.data().deltaAvailableMinor;
      held += entry.data().deltaHeldMinor;
    }
    report(doc.id, 'availableMinor', available, wallet.availableMinor);
    report(doc.id, 'heldMinor', held, wallet.heldMinor);
    const pending = await store
      .walletTxs()
      .where('ownerUid', '==', doc.id)
      .where('kind', '==', 'deposit')
      .where('status', '==', 'pending')
      .get();
    report(
      doc.id,
      'pendingDepositMinor',
      pending.docs.reduce((sum, entry) => sum + entry.data().amountMinor, 0),
      wallet.pendingDepositMinor,
    );
    for (const field of ['availableMinor', 'heldMinor', 'pendingDepositMinor']) {
      if (wallet[field] < 0) mismatches.push({ uid: doc.id, field, expected: '>= 0', actual: wallet[field] });
    }
  }

  const revenue = {};
  const revenueSnapshot = await store.platformRevenues().get();
  revenueSnapshot.docs.forEach((doc) => {
    revenue[doc.id] = doc.data().collectedMinor;
  });
  return {
    walletsChecked: page.size,
    mismatches,
    platformRevenue: revenue,
    next: page.size === limit ? page.docs[page.size - 1].id : null,
  };
}

module.exports = { listWithdrawals, withdrawalAction, reverseTransaction, reconcile, WITHDRAWAL_STATUSES };
