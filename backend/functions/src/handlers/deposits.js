'use strict';

const { err } = require('../errors');
const { parse, int, IDEMPOTENCY_KEY } = require('../validation');
const { MAX_MINOR, formatDisplay } = require('../money');
const { newReference } = require('../util');
const { applyLedger } = require('../ledger');
const { idempotencyId, requestHash, inspect } = require('../idempotency');
const rateLimit = require('../ratelimit');
const { queueNotification, queueActivity, queueEvent, queueAudit } = require('../effects');
const common = require('./common');
const { depositsReady } = require('./health');

// A deposit that was closed locally (expired / cancelled) can still turn out to have been paid at the provider.
// Such a late payment is credited, because the user really paid.
const CREDITABLE = ['pending', 'expired', 'cancelled'];

const REASON_TEXT = {
  expired: 'the checkout expired',
  cancelled: 'you cancelled it',
  payment_mismatch: 'we could not verify the payment, contact support with your reference',
  provider_error: 'the payment provider could not start the checkout',
  no_checkout: 'the checkout could not be started',
};

function outcome(id, data, changed, extra = {}) {
  return { id, data, changed, ...extra };
}

async function peek(deps, txId) {
  const snapshot = await deps.store.walletTx(txId).get();
  if (!snapshot.exists) throw err('not_found', 'Transaction not found.');
  return outcome(txId, snapshot.data(), false);
}

async function replayDeposit(deps, txId, uid) {
  const snapshot = await deps.store.walletTx(txId).get();
  if (!snapshot.exists) throw new Error(`Idempotency record points at missing transaction ${txId}`);
  const data = snapshot.data();
  if (data.status === 'pending' && !data.checkoutUrl) {
    throw err('conflict', 'This deposit is still being set up. Try again in a moment.');
  }
  return { tx: common.toApiTx(txId, data, uid), checkoutUrl: data.status === 'pending' ? data.checkoutUrl : null };
}

/** Moves a deposit out of `pending` without crediting it and releases the pending-deposit tracking. */
async function closeDeposit(deps, txId, { status, reason, notify, by }) {
  const { store, clock } = deps;
  return store.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(store.walletTx(txId));
    if (!snapshot.exists) throw err('not_found', 'Transaction not found.');
    const t = snapshot.data();
    if (t.kind !== 'deposit') throw err('invalid_state', 'This is not a deposit.');
    if (t.status !== 'pending') return outcome(txId, t, false);
    const walletSnapshot = await tx.get(store.wallet(t.ownerUid));
    const userSnapshot = await tx.get(store.user(t.ownerUid));
    const now = clock.now();
    applyLedger(tx, store, t.ownerUid, walletSnapshot.data(), { deltaPendingDepositMinor: -t.amountMinor, now });
    const patch = { status, failureReason: reason, checkoutUrl: null, updatedAt: now };
    tx.update(store.walletTx(txId), patch);
    queueEvent(tx, store, txId, { from: 'pending', to: status, by, note: reason, now });
    if (notify) {
      queueNotification(tx, store, {
        uid: t.ownerUid,
        userData: userSnapshot.data(),
        type: 'deposit_failed',
        params: { amountMinor: t.amountMinor, currency: t.currency, reason: REASON_TEXT[reason] || reason, txId },
        now,
      });
    }
    return outcome(txId, { ...t, ...patch }, true);
  });
}

/**
 * Applies what the provider reports for a deposit. The ONLY place that credits a deposit.
 * `result` comes from provider.fetchPayment() (a server-to-server read), never from a client or from a webhook body.
 */
async function applyDepositResult(deps, txId, result, by) {
  const { store, clock } = deps;
  if (result.status === 'expired') {
    return closeDeposit(deps, txId, { status: 'expired', reason: 'expired', notify: true, by });
  }
  if (result.status !== 'paid') return peek(deps, txId);

  const txRef = store.walletTx(txId);
  return store.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(txRef);
    if (!snapshot.exists) throw err('not_found', 'Transaction not found.');
    const t = snapshot.data();
    if (t.kind !== 'deposit') throw err('invalid_state', 'This is not a deposit.');
    if (!CREDITABLE.includes(t.status)) return outcome(txId, t, false);

    const walletSnapshot = await tx.get(store.wallet(t.ownerUid));
    const userSnapshot = await tx.get(store.user(t.ownerUid));
    const revenueSnapshot = await tx.get(store.platformRevenue(t.currency));
    const now = clock.now();
    const wasPending = t.status === 'pending';
    const verified =
      result.amountMinor === t.totalMinor &&
      result.currency === t.currency &&
      (!result.referenceNumber || result.referenceNumber === t.reference);

    if (!verified) {
      queueAudit(tx, store, {
        adminUid: 'system',
        action: 'deposit_payment_mismatch',
        txId,
        targetUid: t.ownerUid,
        reason: 'The provider reported a paid session that does not match the deposit',
        details: {
          expectedMinor: t.totalMinor,
          reportedMinor: result.amountMinor === undefined ? null : result.amountMinor,
          expectedCurrency: t.currency,
          reportedCurrency: result.currency === undefined ? null : result.currency,
          providerPaymentId: result.providerPaymentId || null,
        },
        now,
      });
      if (!wasPending) return outcome(txId, t, false, { mismatch: true });
      applyLedger(tx, store, t.ownerUid, walletSnapshot.data(), { deltaPendingDepositMinor: -t.amountMinor, now });
      const patch = { status: 'failed', failureReason: 'payment_mismatch', checkoutUrl: null, updatedAt: now };
      tx.update(txRef, patch);
      queueEvent(tx, store, txId, { from: 'pending', to: 'failed', by, note: 'payment_mismatch', now });
      queueNotification(tx, store, {
        uid: t.ownerUid,
        userData: userSnapshot.data(),
        type: 'deposit_failed',
        params: { amountMinor: t.amountMinor, currency: t.currency, reason: REASON_TEXT.payment_mismatch, txId },
        now,
      });
      return outcome(txId, { ...t, ...patch }, true, { mismatch: true });
    }

    applyLedger(tx, store, t.ownerUid, walletSnapshot.data(), {
      txId,
      type: 'deposit_credit',
      deltaAvailableMinor: t.amountMinor,
      deltaPendingDepositMinor: wasPending ? -t.amountMinor : 0,
      now,
    });
    common.addRevenue(tx, store, revenueSnapshot, t.currency, t.feeMinor, now);
    const patch = {
      status: 'completed',
      failureReason: null,
      checkoutUrl: null,
      providerPaymentId: result.providerPaymentId || null,
      completedAt: now,
      updatedAt: now,
    };
    tx.update(txRef, patch);
    queueEvent(tx, store, txId, { from: t.status, to: 'completed', by, note: wasPending ? null : 'late payment', now });
    queueNotification(tx, store, {
      uid: t.ownerUid,
      userData: userSnapshot.data(),
      type: 'deposit_completed',
      params: { amountMinor: t.amountMinor, currency: t.currency, txId },
      now,
    });
    queueActivity(tx, store, t.ownerUid, {
      type: 'deposit_completed',
      summary: `Deposit of ${formatDisplay(t.amountMinor, t.currency)} completed`,
      entityType: 'walletTx',
      entityId: txId,
      now,
    });
    return outcome(txId, { ...t, ...patch }, true);
  });
}

/** Asks the provider about a deposit and applies the answer. Used by /sync, the webhook and the scheduler. */
async function settleDepositFromProvider(deps, txId, by) {
  const snapshot = await deps.store.walletTx(txId).get();
  if (!snapshot.exists) throw err('not_found', 'Transaction not found.');
  const t = snapshot.data();
  if (t.kind !== 'deposit') throw err('invalid_state', 'This is not a deposit.');
  if (!CREDITABLE.includes(t.status) || !t.providerRef) return outcome(txId, t, false);
  const result = await deps.provider.fetchPayment(t.providerRef);
  return applyDepositResult(deps, txId, result, by);
}

async function createDeposit(ctx) {
  const { deps, user } = ctx;
  const { store, clock, config, provider } = deps;
  const input = parse({ amountMinor: int({ min: 1, max: MAX_MINOR }), idempotencyKey: IDEMPOTENCY_KEY }, ctx.body);
  if (!depositsReady(deps)) {
    throw err('not_configured', 'Deposits are not available yet because the payment provider has not been set up.');
  }
  const account = await common.loadAccount(deps, user.uid);
  common.assertUsable(account, config, 'deposits');
  common.assertAmountInRange(config, 'deposit', input.amountMinor);
  const { feeMinor, totalMinor } = common.priceOf(config, 'deposit', input.amountMinor);

  const idempotencyRef = store.idempotency(idempotencyId(user.uid, 'deposit', input.idempotencyKey));
  const hash = requestHash({ amountMinor: input.amountMinor });
  const earlier = inspect(await idempotencyRef.get(), hash);
  if (earlier) return replayDeposit(deps, earlier.txId, user.uid);
  await rateLimit.consume(deps, user.uid, 'deposit');

  const txId = newReference('DEP');
  const created = await store.db.runTransaction(async (tx) => {
    const idempotencySnapshot = await tx.get(idempotencyRef);
    const existing = inspect(idempotencySnapshot, hash);
    if (existing) return { replayId: existing.txId };
    const userSnapshot = await tx.get(store.user(user.uid));
    const walletSnapshot = await tx.get(store.wallet(user.uid));
    const now = clock.now();
    const current = { user: userSnapshot.data(), wallet: walletSnapshot.data() };
    common.assertUsable(current, config, 'deposits');
    applyLedger(tx, store, user.uid, current.wallet, { deltaPendingDepositMinor: input.amountMinor, now });
    tx.create(
      store.walletTx(txId),
      common.newTxDoc({
        reference: txId,
        kind: 'deposit',
        status: 'pending',
        amountMinor: input.amountMinor,
        feeMinor,
        totalMinor,
        currency: current.wallet.currency,
        ownerUid: user.uid,
        participants: [user.uid],
        directions: { [user.uid]: 'credit' },
        ownerDisplay: current.user.displayName,
        provider: provider.name,
        createdAt: now,
        updatedAt: now,
      }),
    );
    queueEvent(tx, store, txId, { from: null, to: 'pending', by: 'user', now });
    tx.create(idempotencyRef, {
      uid: user.uid,
      op: 'deposit',
      requestHash: hash,
      txId,
      createdAt: now,
      expiresAt: common.addDays(now, config.retention.idempotencyDays),
    });
    return { replayId: null };
  });
  if (created.replayId) return replayDeposit(deps, created.replayId, user.uid);

  let checkout;
  try {
    checkout = await provider.createCheckout({
      reference: txId,
      amountMinor: totalMinor,
      currency: account.wallet.currency,
      description: `iKeepZ wallet deposit ${txId}`,
      returnUrl: config.publicReturnUrl,
    });
  } catch (error) {
    await closeDeposit(deps, txId, { status: 'failed', reason: 'provider_error', notify: false, by: 'system' });
    throw error;
  }
  await store.walletTx(txId).update({
    provider: provider.name,
    providerRef: checkout.providerRef,
    checkoutUrl: checkout.checkoutUrl,
    updatedAt: clock.now(),
  });
  const saved = await store.walletTx(txId).get();
  return { tx: common.toApiTx(txId, saved.data(), user.uid), checkoutUrl: checkout.checkoutUrl };
}

async function loadOwnedDeposit(deps, txId, uid) {
  const snapshot = await deps.store.walletTx(txId).get();
  const data = snapshot.exists ? snapshot.data() : null;
  if (!data || data.kind !== 'deposit' || data.ownerUid !== uid) throw err('not_found', 'Deposit not found.');
  return data;
}

async function syncDeposit(ctx) {
  const { deps, user, params } = ctx;
  await loadOwnedDeposit(deps, params.id, user.uid);
  const result = await settleDepositFromProvider(deps, params.id, 'user');
  return { tx: common.toApiTx(params.id, result.data, user.uid) };
}

async function cancelDeposit(ctx) {
  const { deps, user, params } = ctx;
  const { provider } = deps;
  const t = await loadOwnedDeposit(deps, params.id, user.uid);
  if (t.status !== 'pending') {
    throw err('invalid_state', 'Only a pending deposit can be cancelled.', { status: t.status });
  }
  if (t.providerRef) {
    const result = await provider.fetchPayment(t.providerRef);
    if (result.status === 'paid') {
      const settled = await applyDepositResult(deps, params.id, result, 'user');
      return { tx: common.toApiTx(params.id, settled.data, user.uid) };
    }
    try {
      await provider.expireCheckout(t.providerRef);
    } catch (error) {
      deps.logger.warn('Could not expire the checkout at the provider; a late payment will still be credited', {
        txId: params.id,
        code: error && error.code,
      });
    }
  }
  const closed = await closeDeposit(deps, params.id, { status: 'cancelled', reason: 'cancelled', notify: false, by: 'user' });
  return { tx: common.toApiTx(params.id, closed.data, user.uid) };
}

module.exports = {
  createDeposit,
  syncDeposit,
  cancelDeposit,
  applyDepositResult,
  settleDepositFromProvider,
  closeDeposit,
  REASON_TEXT,
};
