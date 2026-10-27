'use strict';

const { err } = require('./errors');
const { MAX_BALANCE_MINOR } = require('./money');

const LEDGER_TYPES = new Set([
  'deposit_credit',
  'withdrawal_hold',
  'withdrawal_release',
  'withdrawal_settle',
  'transfer_out',
  'transfer_in',
  'reversal_debit',
  'reversal_credit',
]);

/**
 * Applies a balance change to one wallet and appends the matching immutable ledger entry, inside the caller's
 * Firestore transaction. `wallet` must be the wallet data read earlier in the SAME transaction.
 *
 * Invariants enforced here (see docs/ARCHITECTURE.md):
 *   available >= 0, held >= 0, pendingDeposit >= 0, available <= MAX_BALANCE;
 *   a ledger entry is written whenever available or held changes, never otherwise.
 *
 * Returns the new wallet data so a caller can chain further changes in the same transaction.
 */
function applyLedger(tx, store, uid, wallet, change) {
  const { txId, type, deltaAvailableMinor = 0, deltaHeldMinor = 0, deltaPendingDepositMinor = 0, now } = change;
  for (const [name, value] of Object.entries({ deltaAvailableMinor, deltaHeldMinor, deltaPendingDepositMinor })) {
    if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  }
  const writesLedger = deltaAvailableMinor !== 0 || deltaHeldMinor !== 0;
  if (writesLedger && !LEDGER_TYPES.has(type)) throw new Error(`Unknown ledger type ${type}`);

  const availableMinor = wallet.availableMinor + deltaAvailableMinor;
  const heldMinor = wallet.heldMinor + deltaHeldMinor;
  const pendingDepositMinor = wallet.pendingDepositMinor + deltaPendingDepositMinor;

  if (availableMinor < 0) {
    throw err('insufficient_funds', 'Your available balance is too low for this.', {
      availableMinor: wallet.availableMinor,
      neededMinor: -deltaAvailableMinor,
    });
  }
  if (heldMinor < 0 || pendingDepositMinor < 0) {
    // Not reachable through the API: it would mean a status guard was bypassed. Fail the whole transaction.
    throw new Error(`Ledger invariant violated for ${uid}: held=${heldMinor} pending=${pendingDepositMinor}`);
  }
  if (availableMinor > MAX_BALANCE_MINOR) {
    throw err('limit_exceeded', 'This would exceed the maximum wallet balance.', { reason: 'wallet_limit' });
  }

  const version = (wallet.version || 0) + 1;
  const next = { ...wallet, availableMinor, heldMinor, pendingDepositMinor, version, updatedAt: now };
  tx.update(store.wallet(uid), { availableMinor, heldMinor, pendingDepositMinor, version, updatedAt: now });

  if (writesLedger) {
    tx.create(store.ledger(uid).doc(), {
      txId,
      type,
      deltaAvailableMinor,
      deltaHeldMinor,
      balanceAvailableAfterMinor: availableMinor,
      balanceHeldAfterMinor: heldMinor,
      currency: wallet.currency,
      seq: version,
      createdAt: now,
    });
  }
  return next;
}

module.exports = { LEDGER_TYPES, applyLedger };
