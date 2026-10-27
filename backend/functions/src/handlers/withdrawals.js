'use strict';

const { err } = require('../errors');
const { parse, int, str, IDEMPOTENCY_KEY } = require('../validation');
const { MAX_MINOR, formatDisplay } = require('../money');
const { newReference, maskName } = require('../util');
const { applyLedger } = require('../ledger');
const { idempotencyId, requestHash, inspect } = require('../idempotency');
const rateLimit = require('../ratelimit');
const { verifyPin } = require('../pin');
const { queueNotification, queueActivity, queueEvent, queueAudit } = require('../effects');
const common = require('./common');

const TRANSITIONS = {
  approve: { from: ['pending_review'], to: 'approved', verb: 'approved', notification: 'withdrawal_approved' },
  reject: { from: ['pending_review'], to: 'rejected', verb: 'rejected', release: true, notification: 'withdrawal_rejected' },
  complete: { from: ['approved'], to: 'completed', verb: 'completed', settle: true, notification: 'withdrawal_completed' },
  fail: { from: ['approved'], to: 'failed', verb: 'marked as failed', release: true, notification: 'withdrawal_failed' },
  cancel: { from: ['pending_review'], to: 'cancelled', verb: 'cancelled', release: true, notification: 'withdrawal_cancelled' },
};

async function createWithdrawal(ctx) {
  const { deps, user } = ctx;
  const { store, clock, config } = deps;
  const input = parse(
    {
      destinationId: str({ min: 1, max: 40, pattern: /^[A-Za-z0-9]+$/ }),
      amountMinor: int({ min: 1, max: MAX_MINOR }),
      pin: str({ pattern: /^\d{6}$/, min: 6, max: 6, trim: false }),
      idempotencyKey: IDEMPOTENCY_KEY,
    },
    ctx.body,
  );
  const account = await common.loadAccount(deps, user.uid);
  common.assertUsable(account, config, 'withdrawals');
  common.assertAmountInRange(config, 'withdrawal', input.amountMinor);
  const { feeMinor, totalMinor } = common.priceOf(config, 'withdrawal', input.amountMinor);

  const idempotencyRef = store.idempotency(idempotencyId(user.uid, 'withdrawal', input.idempotencyKey));
  const hash = requestHash({ destinationId: input.destinationId, amountMinor: input.amountMinor });
  const earlier = inspect(await idempotencyRef.get(), hash);
  if (earlier) return { tx: await common.loadTxFor(deps, earlier.txId, user.uid) };

  const destinationRef = store.destinations(user.uid).doc(input.destinationId);
  const destinationSnapshot = await destinationRef.get();
  if (!destinationSnapshot.exists || destinationSnapshot.data().status !== 'active') {
    throw err('not_found', 'Choose one of your saved payout destinations.', { field: 'destinationId' });
  }

  await verifyPin(deps, user.uid, input.pin);
  await rateLimit.consume(deps, user.uid, 'withdrawal');

  const txId = newReference('WDR');
  const daily = common.dailyFor(deps, user.uid, clock.now());
  const result = await store.db.runTransaction(async (tx) => {
    const idempotencySnapshot = await tx.get(idempotencyRef);
    const existing = inspect(idempotencySnapshot, hash);
    if (existing) return { replayId: existing.txId };
    const userSnapshot = await tx.get(store.user(user.uid));
    const walletSnapshot = await tx.get(store.wallet(user.uid));
    const currentDestination = await tx.get(destinationRef);
    const dailySnapshot = await tx.get(daily.ref);
    const now = clock.now();
    const current = { user: userSnapshot.data(), wallet: walletSnapshot.data() };
    common.assertUsable(current, config, 'withdrawals');
    if (!currentDestination.exists || currentDestination.data().status !== 'active') {
      throw err('not_found', 'Choose one of your saved payout destinations.', { field: 'destinationId' });
    }
    const used = dailySnapshot.exists ? dailySnapshot.data().outMinor : 0;
    common.assertDailyRoom(config, used, totalMinor);

    applyLedger(tx, store, user.uid, current.wallet, {
      txId,
      type: 'withdrawal_hold',
      deltaAvailableMinor: -totalMinor,
      deltaHeldMinor: totalMinor,
      now,
    });
    tx.set(daily.ref, {
      uid: user.uid,
      day: daily.day,
      outMinor: used + totalMinor,
      updatedAt: now,
      expiresAt: common.addDays(now, config.retention.dailyDays),
    });
    const summary = common.summaryOfDestination(currentDestination.data());
    const doc = common.newTxDoc({
      reference: txId,
      kind: 'withdrawal',
      status: 'pending_review',
      amountMinor: input.amountMinor,
      feeMinor,
      totalMinor,
      currency: current.wallet.currency,
      ownerUid: user.uid,
      participants: [user.uid],
      directions: { [user.uid]: 'debit' },
      ownerDisplay: maskName(current.user.displayName),
      destinationId: input.destinationId,
      destinationSummary: summary,
      dailyKey: daily.key,
      createdAt: now,
      updatedAt: now,
    });
    tx.create(store.walletTx(txId), doc);
    queueEvent(tx, store, txId, { from: null, to: 'pending_review', by: 'user', now });
    queueNotification(tx, store, {
      uid: user.uid,
      userData: current.user,
      type: 'withdrawal_requested',
      params: { amountMinor: input.amountMinor, currency: doc.currency, destination: summary, txId },
      now,
    });
    queueActivity(tx, store, user.uid, {
      type: 'withdrawal_requested',
      summary: `Requested withdrawal of ${formatDisplay(input.amountMinor, doc.currency)} to ${summary}`,
      entityType: 'walletTx',
      entityId: txId,
      now,
    });
    tx.create(idempotencyRef, {
      uid: user.uid,
      op: 'withdrawal',
      requestHash: hash,
      txId,
      createdAt: now,
      expiresAt: common.addDays(now, config.retention.idempotencyDays),
    });
    return { replayId: null, doc };
  });
  if (result.replayId) return { tx: await common.loadTxFor(deps, result.replayId, user.uid) };
  return { tx: common.toApiTx(txId, result.doc, user.uid) };
}

/**
 * Moves a withdrawal through its state machine (see docs/ARCHITECTURE.md), doing the matching balance work in the same
 * transaction: reject / fail / cancel release the hold, complete settles it and books the fee as platform revenue.
 */
async function transitionWithdrawal(deps, { txId, action, actorUid, actorRole, ownerOnly = false, reason = null, payoutReference = null }) {
  const { store, clock } = deps;
  const rule = TRANSITIONS[action];
  if (!rule) throw new Error(`Unknown withdrawal action ${action}`);
  const txRef = store.walletTx(txId);

  return store.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(txRef);
    const t = snapshot.exists ? snapshot.data() : null;
    if (!t || t.kind !== 'withdrawal' || (ownerOnly && t.ownerUid !== actorUid)) throw err('not_found', 'Withdrawal not found.');
    if (!rule.from.includes(t.status)) {
      throw err('invalid_state', `A withdrawal that is ${t.status.replace('_', ' ')} cannot be ${rule.verb}.`, { status: t.status });
    }
    const walletSnapshot = await tx.get(store.wallet(t.ownerUid));
    const userSnapshot = await tx.get(store.user(t.ownerUid));
    const dailySnapshot = rule.release && t.dailyKey ? await tx.get(store.daily(t.dailyKey)) : null;
    const revenueSnapshot = rule.settle ? await tx.get(store.platformRevenue(t.currency)) : null;
    const now = clock.now();
    const wallet = walletSnapshot.data();

    if (rule.release) {
      applyLedger(tx, store, t.ownerUid, wallet, {
        txId,
        type: 'withdrawal_release',
        deltaAvailableMinor: t.totalMinor,
        deltaHeldMinor: -t.totalMinor,
        now,
      });
      if (dailySnapshot && dailySnapshot.exists) {
        tx.update(store.daily(t.dailyKey), {
          outMinor: Math.max(0, dailySnapshot.data().outMinor - t.totalMinor),
          updatedAt: now,
        });
      }
    }
    if (rule.settle) {
      applyLedger(tx, store, t.ownerUid, wallet, { txId, type: 'withdrawal_settle', deltaHeldMinor: -t.totalMinor, now });
      common.addRevenue(tx, store, revenueSnapshot, t.currency, t.feeMinor, now);
    }

    const patch = { status: rule.to, updatedAt: now };
    if (action === 'reject' || action === 'fail') patch.failureReason = reason;
    if (action === 'complete') {
      patch.payoutReference = payoutReference;
      patch.completedAt = now;
    }
    tx.update(txRef, patch);
    queueEvent(tx, store, txId, { from: t.status, to: rule.to, by: actorRole, note: reason || payoutReference, now });
    queueNotification(tx, store, {
      uid: t.ownerUid,
      userData: userSnapshot.data(),
      type: rule.notification,
      params: {
        amountMinor: t.amountMinor,
        currency: t.currency,
        destination: t.destinationSummary,
        reason,
        payoutReference,
        txId,
      },
      now,
    });
    queueActivity(tx, store, t.ownerUid, {
      type: `withdrawal_${rule.to}`,
      summary: `Withdrawal of ${formatDisplay(t.amountMinor, t.currency)} ${rule.to.replace('_', ' ')}`,
      entityType: 'walletTx',
      entityId: txId,
      now,
    });
    if (actorRole === 'admin') {
      queueAudit(tx, store, { adminUid: actorUid, action: `withdrawal_${action}`, txId, targetUid: t.ownerUid, reason, details: { payoutReference }, now });
    }
    return { id: txId, data: { ...t, ...patch } };
  });
}

async function cancelWithdrawal(ctx) {
  const { deps, user, params } = ctx;
  const result = await transitionWithdrawal(deps, {
    txId: params.id,
    action: 'cancel',
    actorUid: user.uid,
    actorRole: 'user',
    ownerOnly: true,
  });
  return { tx: common.toApiTx(result.id, result.data, user.uid) };
}

module.exports = { createWithdrawal, cancelWithdrawal, transitionWithdrawal, TRANSITIONS };
