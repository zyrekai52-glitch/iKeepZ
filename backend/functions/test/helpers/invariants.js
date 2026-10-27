'use strict';

const assert = require('node:assert/strict');

/**
 * Checks the ledger invariants from docs/ARCHITECTURE.md against everything in the fake database:
 *   1. no negative balances;
 *   2. every wallet equals the sum of its immutable ledger, and each entry carries the correct running balance;
 *   3. pendingDepositMinor equals the sum of that user's pending deposits;
 *   4. money is conserved: wallets + platform revenue == external money in - external money out.
 * Returns a small summary for tests that want to assert on totals.
 */
function assertInvariants(h) {
  let walletTotal = 0;
  for (const { id, data: wallet } of h.db.list('wallets')) {
    for (const field of ['availableMinor', 'heldMinor', 'pendingDepositMinor']) {
      assert.ok(Number.isSafeInteger(wallet[field]) && wallet[field] >= 0, `${id}.${field} = ${wallet[field]}`);
    }
    const entries = h.db.list(`wallets/${id}/ledger`).map((entry) => entry.data).sort((a, b) => a.seq - b.seq);
    let available = 0;
    let held = 0;
    const seen = new Set();
    for (const entry of entries) {
      assert.ok(!seen.has(entry.seq), `${id}: duplicate ledger seq ${entry.seq}`);
      seen.add(entry.seq);
      available += entry.deltaAvailableMinor;
      held += entry.deltaHeldMinor;
      assert.equal(entry.balanceAvailableAfterMinor, available, `${id}: running available at seq ${entry.seq}`);
      assert.equal(entry.balanceHeldAfterMinor, held, `${id}: running held at seq ${entry.seq}`);
      assert.ok(entry.deltaAvailableMinor !== 0 || entry.deltaHeldMinor !== 0, `${id}: empty ledger entry`);
    }
    assert.equal(available, wallet.availableMinor, `${id}: available vs ledger`);
    assert.equal(held, wallet.heldMinor, `${id}: held vs ledger`);

    const pending = h.db
      .list('walletTx')
      .filter((entry) => entry.data.ownerUid === id && entry.data.kind === 'deposit' && entry.data.status === 'pending')
      .reduce((sum, entry) => sum + entry.data.amountMinor, 0);
    assert.equal(pending, wallet.pendingDepositMinor, `${id}: pending deposits vs wallet`);
    walletTotal += wallet.availableMinor + wallet.heldMinor;
  }

  const revenueTotal = h.db.list('platformRevenue').reduce((sum, entry) => sum + entry.data.collectedMinor, 0);
  for (const entry of h.db.list('platformRevenue')) assert.ok(entry.data.collectedMinor >= 0, `revenue ${entry.id} negative`);

  const txs = h.db.list('walletTx').map((entry) => entry.data);
  const byRef = new Map(txs.map((t) => [t.reference, t]));
  let externalIn = 0;
  let externalOut = 0;
  for (const t of txs) {
    if (t.kind === 'deposit' && (t.status === 'completed' || t.status === 'reversed')) externalIn += t.totalMinor;
    if (t.kind === 'withdrawal' && t.status === 'completed') externalOut += t.amountMinor;
    if (t.kind === 'reversal') {
      const original = byRef.get(t.reversesTxId);
      assert.ok(original, `reversal ${t.reference} points at a missing transaction`);
      if (original.kind === 'deposit') externalOut += t.amountMinor;
    }
  }
  assert.equal(walletTotal + revenueTotal, externalIn - externalOut, 'money is conserved');
  return { walletTotal, revenueTotal, externalIn, externalOut };
}

module.exports = { assertInvariants };
