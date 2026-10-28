'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ok } = require('./helpers/harness');
const { assertInvariants } = require('./helpers/invariants');
const { reconcilePendingDeposits, cleanupExpired } = require('../src/scheduled/reconcile');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function pendingDeposit(h, user, amountMinor = 50000) {
  const { tx } = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor, idempotencyKey: h.key() } }));
  return { id: tx.id, providerRef: h.tx(tx.id).providerRef };
}

test('a paid deposit whose webhook never arrived is credited by the scheduler', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const { id, providerRef } = await pendingDeposit(h, alice);
  h.provider.pay(providerRef);
  h.clock.advance(5 * MINUTE);

  const summary = await reconcilePendingDeposits(h.deps);
  assert.deepEqual(summary, { examined: 1, credited: 1, expired: 0, errors: 0 });
  assert.equal(h.tx(id).status, 'completed');
  assert.equal(h.wallet('alice').availableMinor, 50000);
  assert.equal(h.db.list(`walletTx/${id}/events`).filter((e) => e.data.by === 'system').length, 1);

  // Running again (or racing with the user) changes nothing.
  assert.deepEqual(await reconcilePendingDeposits(h.deps), { examined: 0, credited: 0, expired: 0, errors: 0 });
  assert.equal(h.wallet('alice').availableMinor, 50000);
  assertInvariants(h);
});

test('brand-new deposits are left alone so the customer can finish paying', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  await pendingDeposit(h, alice);
  h.clock.advance(60 * 1000);
  const before = h.provider.calls.length;
  assert.deepEqual(await reconcilePendingDeposits(h.deps), { examined: 1, credited: 0, expired: 0, errors: 0 });
  assert.equal(h.provider.calls.length, before, 'the provider is not asked yet');
});

test('unpaid deposits stay pending until they are old enough, then they are expired with a notice', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const { id, providerRef } = await pendingDeposit(h, alice);
  h.clock.advance(10 * MINUTE);
  assert.deepEqual(await reconcilePendingDeposits(h.deps), { examined: 1, credited: 0, expired: 0, errors: 0 });
  assert.equal(h.tx(id).status, 'pending');
  assert.equal(h.wallet('alice').pendingDepositMinor, 50000);

  h.clock.advance(26 * HOUR);
  const summary = await reconcilePendingDeposits(h.deps);
  assert.deepEqual(summary, { examined: 1, credited: 0, expired: 1, errors: 0 });
  assert.equal(h.tx(id).status, 'expired');
  assert.equal(h.provider.sessions.get(providerRef).status, 'expired', 'the checkout is closed at the provider too');
  assert.equal(h.wallet('alice').pendingDepositMinor, 0);
  assert.equal(h.notifications('alice').filter((n) => n.type === 'deposit_failed').length, 1);
  assertInvariants(h);
});

test('a checkout the provider already expired is closed', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const { id, providerRef } = await pendingDeposit(h, alice);
  h.provider.expire(providerRef);
  h.clock.advance(5 * MINUTE);
  assert.deepEqual(await reconcilePendingDeposits(h.deps), { examined: 1, credited: 0, expired: 1, errors: 0 });
  assert.equal(h.tx(id).status, 'expired');
  assertInvariants(h);
});

test('a deposit that never got a checkout is closed after 30 minutes', async () => {
  const h = createHarness();
  await h.signup('alice');
  const now = h.clock.now();
  h.db.seed('walletTx/DEP-ORPHAN', {
    reference: 'DEP-ORPHAN', kind: 'deposit', status: 'pending', amountMinor: 20000, feeMinor: 0, totalMinor: 20000, currency: 'PHP',
    ownerUid: 'alice', counterpartyUid: null, participants: ['alice'], directions: { alice: 'credit' }, ownerDisplay: 'alice',
    counterpartyDisplay: null, destinationId: null, destinationSummary: null, provider: 'paymongo', providerRef: null,
    providerPaymentId: null, checkoutUrl: null, note: null, failureReason: null, payoutReference: null, reversesTxId: null,
    reversedByTxId: null, dailyKey: null, completedAt: null, createdAt: now, updatedAt: now,
  });
  h.db.seed('wallets/alice', { ...h.wallet('alice'), pendingDepositMinor: 20000, version: 1 });

  h.clock.advance(20 * MINUTE);
  assert.deepEqual(await reconcilePendingDeposits(h.deps), { examined: 1, credited: 0, expired: 0, errors: 0 });
  assert.equal(h.tx('DEP-ORPHAN').status, 'pending');
  h.clock.advance(11 * MINUTE);
  assert.deepEqual(await reconcilePendingDeposits(h.deps), { examined: 1, credited: 0, expired: 1, errors: 0 });
  assert.equal(h.tx('DEP-ORPHAN').status, 'expired');
  assert.equal(h.tx('DEP-ORPHAN').failureReason, 'no_checkout');
  assert.equal(h.wallet('alice').pendingDepositMinor, 0);
  assert.equal(h.notifications('alice').length, 0, 'the user never saw this deposit');
  assertInvariants(h);
});

test('a payment that does not match is failed and flagged, not credited', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const { id, providerRef } = await pendingDeposit(h, alice);
  h.provider.pay(providerRef, { amountMinor: 49999 });
  h.clock.advance(5 * MINUTE);
  await reconcilePendingDeposits(h.deps);
  assert.equal(h.tx(id).status, 'failed');
  assert.equal(h.wallet('alice').availableMinor, 0);
  assert.equal(h.db.list('adminAudit').filter((e) => e.data.action === 'deposit_payment_mismatch').length, 1);
  assertInvariants(h);
});

test('one failing deposit does not stop the others', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const bob = await h.signup('bob');
  const a = await pendingDeposit(h, alice);
  const b = await pendingDeposit(h, bob, 30000);
  h.provider.pay(a.providerRef);
  h.provider.pay(b.providerRef);
  h.clock.advance(5 * MINUTE);
  const original = h.provider.fetchPayment.bind(h.provider);
  h.provider.fetchPayment = async (ref) => {
    if (ref === a.providerRef) throw Object.assign(new Error('boom'), { code: 'provider_error' });
    return original(ref);
  };
  const summary = await reconcilePendingDeposits(h.deps);
  assert.deepEqual(summary, { examined: 2, credited: 1, expired: 0, errors: 1 });
  assert.equal(h.tx(a.id).status, 'pending');
  assert.equal(h.tx(b.id).status, 'completed');
  assert.equal(h.unexpectedErrors().length, 1);

  h.provider.fetchPayment = original;
  assert.deepEqual(await reconcilePendingDeposits(h.deps), { examined: 1, credited: 1, expired: 0, errors: 0 });
  assertInvariants(h);
});

test('the scheduler and the user syncing at the same moment credit once', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const { id, providerRef } = await pendingDeposit(h, alice);
  h.provider.pay(providerRef);
  h.clock.advance(5 * MINUTE);
  const results = await Promise.all([
    reconcilePendingDeposits(h.deps),
    h.call('POST', `/wallet/deposits/${id}/sync`, { token: alice.token }),
    reconcilePendingDeposits(h.deps),
    h.call('POST', `/wallet/deposits/${id}/sync`, { token: alice.token }),
  ]);
  assert.equal(results[1].status, 200);
  assert.equal(h.wallet('alice').availableMinor, 50000);
  assert.equal(h.db.list('wallets/alice/ledger').length, 1);
  assertInvariants(h);
});

// ---------------------------------------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------------------------------------

test('cleanup removes only expired bookkeeping documents', async () => {
  const h = createHarness();
  const now = h.clock.now();
  const past = new Date(now.getTime() - HOUR);
  const future = new Date(now.getTime() + HOUR);
  for (const collection of ['rateLimits', 'idempotency', 'providerEvents', 'walletDaily']) {
    h.db.seed(`${collection}/old1`, { expiresAt: past });
    h.db.seed(`${collection}/old2`, { expiresAt: past });
    h.db.seed(`${collection}/fresh`, { expiresAt: future });
  }
  h.db.seed('wallets/keep', { availableMinor: 5, expiresAt: past }); // money documents are never touched
  const deleted = await cleanupExpired(h.deps);
  assert.deepEqual(deleted, { rateLimits: 2, idempotency: 2, providerEvents: 2, walletDaily: 2 });
  for (const collection of ['rateLimits', 'idempotency', 'providerEvents', 'walletDaily']) {
    assert.deepEqual(h.db.list(collection).map((d) => d.id), ['fresh'], collection);
  }
  assert.ok(h.db.read('wallets/keep'));
  assert.deepEqual(await cleanupExpired(h.deps), { rateLimits: 0, idempotency: 0, providerEvents: 0, walletDaily: 0 });
});

test('cleanup copes with large backlogs', async () => {
  const h = createHarness();
  const past = new Date(h.clock.now().getTime() - HOUR);
  for (let i = 0; i < 650; i += 1) h.db.seed(`rateLimits/r${i}`, { expiresAt: past });
  const deleted = await cleanupExpired(h.deps);
  assert.equal(deleted.rateLimits, 650);
  assert.equal(h.db.list('rateLimits').length, 0);
});

test('real records carry expiry times and are cleaned up on schedule', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const key = h.key();
  const first = ok(await h.call('POST', '/wallet/deposits', { token: alice.token, body: { amountMinor: 50000, idempotencyKey: key } })).tx;
  ok(await h.call('POST', '/wallet/quote', { token: alice.token, body: { kind: 'deposit', amountMinor: 50000 } }));
  h.provider.pay(h.tx(first.id).providerRef);
  await h.call('POST', '/webhooks/paymongo', h.provider.webhookFor(h.tx(first.id).providerRef, { eventId: 'evt_x' }));
  assert.ok(h.db.list('idempotency').length >= 1);
  assert.ok(h.db.list('rateLimits').length >= 1);
  assert.equal(h.db.list('providerEvents').length, 1);

  assert.deepEqual(Object.values(await cleanupExpired(h.deps)), [0, 0, 0, 0], 'nothing is deleted too early');
  h.clock.advance(31 * 24 * HOUR);
  const deleted = await cleanupExpired(h.deps);
  assert.ok(deleted.idempotency >= 1 && deleted.rateLimits >= 1 && deleted.providerEvents === 1);
  assert.equal(h.db.list('idempotency').length, 0);
  assert.equal(h.wallet('alice').availableMinor, 50000, 'balances are unaffected');
  assertInvariants(h);
});
