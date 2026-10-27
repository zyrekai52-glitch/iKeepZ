'use strict';

const { err } = require('../errors');
const { serialize, dayKey } = require('../util');
const { computeFee } = require('../money');

const DAY_MS = 86400000;

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Reads the caller's user + wallet documents (outside a transaction, for pre-checks only). */
async function loadAccount(deps, uid) {
  const userSnapshot = await deps.store.user(uid).get();
  const walletSnapshot = await deps.store.wallet(uid).get();
  if (!userSnapshot.exists || !walletSnapshot.exists) {
    throw err('not_found', 'Your wallet is not set up yet. Open the app again to finish setup.', { reason: 'not_bootstrapped' });
  }
  return { user: userSnapshot.data(), wallet: walletSnapshot.data() };
}

/** feature: 'deposits' | 'withdrawals' | 'transfers' */
function assertUsable(account, config, feature) {
  const { user, wallet } = account;
  if (user.status !== 'active') throw err('account_suspended', 'Your account is suspended. Please contact support.');
  if (wallet.status !== 'active') {
    throw err('account_suspended', 'Your wallet is frozen. Please contact support.', { reason: 'wallet_frozen' });
  }
  if (feature === 'withdrawals') {
    if (user.withdrawalsEnabled === false) throw err('feature_disabled', 'Withdrawals are turned off for your account.');
    if (config.requireKycForWithdrawal && user.kycStatus !== 'approved') {
      throw err('kyc_required', 'Identity verification is required before you can withdraw.');
    }
  }
  if (feature === 'transfers' && user.transfersEnabled === false) {
    throw err('feature_disabled', 'Transfers are turned off for your account.');
  }
}

function limitsFor(config, kind) {
  const limits = config.limits[kind];
  if (!limits || typeof limits.min !== 'number') throw new Error(`No limits for ${kind}`);
  return limits;
}

function assertAmountInRange(config, kind, amountMinor) {
  const { min, max } = limitsFor(config, kind);
  if (amountMinor < min || amountMinor > max) {
    throw err('limit_exceeded', 'This amount is outside the allowed range.', {
      reason: amountMinor < min ? 'below_min' : 'above_max',
      minMinor: min,
      maxMinor: max,
    });
  }
}

/** amount + fee. Deposits: what the user pays at checkout. Withdrawals/transfers: what leaves the wallet. */
function priceOf(config, kind, amountMinor) {
  const { min, max } = limitsFor(config, kind);
  const feeMinor = computeFee(amountMinor, config.fees[kind]);
  return { minMinor: min, maxMinor: max, feeMinor, totalMinor: amountMinor + feeMinor };
}

function dailyFor(deps, uid, now) {
  const day = dayKey(now, deps.config.limitTzOffsetMinutes);
  const key = `${uid}_${day}`;
  return { key, day, ref: deps.store.daily(key) };
}

function assertDailyRoom(config, usedMinor, totalMinor) {
  if (usedMinor + totalMinor > config.limits.dailyOutMinor) {
    throw err('limit_exceeded', 'This would go over your daily limit.', {
      reason: 'daily_limit',
      remainingMinor: Math.max(0, config.limits.dailyOutMinor - usedMinor),
    });
  }
}

const TX_DEFAULTS = {
  counterpartyUid: null,
  counterpartyDisplay: null,
  destinationId: null,
  destinationSummary: null,
  provider: null,
  providerRef: null,
  providerPaymentId: null,
  checkoutUrl: null,
  note: null,
  failureReason: null,
  payoutReference: null,
  reversesTxId: null,
  reversedByTxId: null,
  dailyKey: null,
  completedAt: null,
};

/** Wallet transaction document with every field present (null when unused) so clients and rules see one shape. */
function newTxDoc(fields) {
  return { ...TX_DEFAULTS, ...fields };
}

/** API view of a wallet transaction. Only the owner of a still-pending deposit gets the checkout URL. */
function toApiTx(id, data, viewerUid) {
  const out = serialize({ id, ...data });
  delete out.dailyKey;
  if (data.ownerUid !== viewerUid || data.status !== 'pending') out.checkoutUrl = null;
  return out;
}

async function loadTxFor(deps, txId, viewerUid) {
  const snapshot = await deps.store.walletTx(txId).get();
  const data = snapshot.exists ? snapshot.data() : null;
  if (!data || !Array.isArray(data.participants) || !data.participants.includes(viewerUid)) {
    throw err('not_found', 'Transaction not found.');
  }
  return toApiTx(txId, data, viewerUid);
}

/** Adds (or, when negative, removes) platform revenue. `snapshot` must have been read earlier in the transaction. */
function addRevenue(tx, store, snapshot, currency, deltaMinor, now) {
  if (deltaMinor === 0) return;
  const previous = snapshot.exists ? snapshot.data().collectedMinor : 0;
  const next = previous + deltaMinor;
  if (next < 0) throw err('invalid_state', 'Platform revenue would become negative.');
  tx.set(store.platformRevenue(currency), { currency, collectedMinor: next, updatedAt: now });
}

function summaryOfDestination(destination) {
  return `${destination.providerName} ${destination.accountNumberMasked}`;
}

module.exports = {
  addDays,
  loadAccount,
  assertUsable,
  assertAmountInRange,
  priceOf,
  dailyFor,
  assertDailyRoom,
  newTxDoc,
  toApiTx,
  loadTxFor,
  addRevenue,
  summaryOfDestination,
};
