'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ok, fails } = require('./helpers/harness');
const { assertInvariants } = require('./helpers/invariants');

const PIN = '135790';

async function ready(h, uid, { funded = 0 } = {}) {
  const user = await h.signup(uid);
  await h.setPin(user, PIN);
  if (funded) await h.fund(user, funded);
  return { ...user, pin: PIN, code: h.wallet(uid).walletCode };
}

const send = (h, from, to, amountMinor) =>
  h.call('POST', '/wallet/transfers', { token: from.token, body: { walletCode: to.code, amountMinor, pin: from.pin, idempotencyKey: h.key() } });
const reverse = (h, a, id, body = { reason: 'Customer dispute #4411' }) => h.call('POST', `/admin/transactions/${id}/reverse`, { token: a.token, body });
const reconcile = (h, a, query) => h.call('GET', '/admin/reconcile', { token: a.token, query });
const ledger = (h, uid) => h.db.list(`wallets/${uid}/ledger`).map((e) => e.data).sort((x, y) => x.seq - y.seq);

async function setup(params) {
  const h = createHarness({ params });
  const a = await h.signup('admin1', { admin: true, bootstrap: false });
  return { h, a };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reversals
// ---------------------------------------------------------------------------------------------------------------------

test('reversing a deposit takes the credited amount back with a compensating ledger entry', async () => {
  const { h, a } = await setup({ DEPOSIT_FEE_FIXED_MINOR: '1000' });
  const alice = await ready(h, 'alice');
  const deposit = await h.fund(alice, 50000);
  assert.equal(h.wallet('alice').availableMinor, 50000);
  assert.equal(h.revenue(), 1000);

  h.clock.advance(1000);
  const { tx: reversal, original } = ok(await reverse(h, a, deposit.id));
  assert.equal(reversal.kind, 'reversal');
  assert.equal(reversal.status, 'completed');
  assert.equal(reversal.reversesTxId, deposit.id);
  assert.equal(reversal.amountMinor, 50000);
  assert.equal(reversal.note, 'Customer dispute #4411');
  assert.deepEqual(reversal.directions, { alice: 'debit' });
  assert.equal(original.status, 'reversed');
  assert.equal(original.reversedByTxId, reversal.id);
  assert.equal(h.tx(deposit.id).status, 'reversed');

  assert.equal(h.wallet('alice').availableMinor, 0);
  const entry = ledger(h, 'alice').at(-1);
  assert.deepEqual([entry.type, entry.txId, entry.deltaAvailableMinor], ['reversal_debit', reversal.id, -50000]);
  assert.equal(ledger(h, 'alice').length, 2, 'the original credit is untouched, history is append-only');
  assert.equal(h.revenue(), 1000, 'the deposit fee is not touched; refunding the customer happens at the provider');
  const note = h.notifications('alice').find((n) => n.type === 'transaction_reversed');
  assert.match(note.body, /deposit of PHP 500\.00 was reversed: Customer dispute #4411/);
  const [audit] = h.db.list('adminAudit').map((e) => e.data).filter((e) => e.action === 'transaction_reverse');
  assert.deepEqual([audit.adminUid, audit.txId, audit.targetUid, audit.reason, audit.details.reversalId], ['admin1', deposit.id, 'alice', 'Customer dispute #4411', reversal.id]);
  assertInvariants(h);

  // Only once.
  fails(await reverse(h, a, deposit.id), 'invalid_state', { kind: 'deposit', status: 'reversed' });
  assert.equal(h.wallet('alice').availableMinor, 0);
});

test('a deposit cannot be reversed once the money has been spent', async () => {
  const { h, a } = await setup();
  const alice = await ready(h, 'alice');
  const bob = await ready(h, 'bob');
  const deposit = await h.fund(alice, 50000);
  ok(await send(h, alice, bob, 20000));
  const res = await reverse(h, a, deposit.id);
  fails(res, 'insufficient_funds', { availableMinor: 30000, neededMinor: 50000 });
  assert.equal(h.tx(deposit.id).status, 'completed', 'nothing was half done');
  assert.equal(h.db.list('walletTx').filter((t) => t.data.kind === 'reversal').length, 0);
  assert.equal(h.wallet('alice').availableMinor, 30000);
  assertInvariants(h);
});

test('reversing a transfer returns the money, and the fee, to the sender', async () => {
  const { h, a } = await setup({ TRANSFER_FEE_FIXED_MINOR: '500' });
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const { tx } = ok(await send(h, alice, bob, 30000));
  assert.equal(h.wallet('alice').availableMinor, 69500);
  assert.equal(h.revenue(), 500);

  h.clock.advance(1000);
  const reversed = ok(await reverse(h, a, tx.id));
  assert.equal(reversed.original.status, 'reversed');
  assert.equal(reversed.tx.ownerUid, 'alice');
  assert.deepEqual(reversed.tx.directions, { alice: 'credit', bob: 'debit' });
  assert.equal(h.wallet('alice').availableMinor, 100000);
  assert.equal(h.wallet('bob').availableMinor, 0);
  assert.equal(h.revenue(), 0, 'the fee is returned');
  assert.deepEqual(ledger(h, 'alice').at(-1).type, 'reversal_credit');
  assert.deepEqual(ledger(h, 'bob').at(-1).type, 'reversal_debit');
  for (const uid of ['alice', 'bob']) {
    assert.equal(h.notifications(uid).filter((n) => n.type === 'transaction_reversed').length, 1, uid);
    assert.equal(h.db.list(`users/${uid}/activity`).filter((e) => e.data.type === 'transaction_reversed').length, 1, uid);
  }
  assertInvariants(h);
});

test('a transfer cannot be reversed after the recipient spent the money', async () => {
  const { h, a } = await setup();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const carol = await ready(h, 'carol');
  const { tx } = ok(await send(h, alice, bob, 30000));
  ok(await send(h, bob, carol, 25000));
  fails(await reverse(h, a, tx.id), 'insufficient_funds');
  assert.equal(h.tx(tx.id).status, 'completed');
  assert.equal(h.wallet('alice').availableMinor, 70000);
  assert.equal(h.wallet('bob').availableMinor, 5000);
  assertInvariants(h);
});

test('only completed deposits and transfers can be reversed, with a reason', async () => {
  const { h, a } = await setup();
  const alice = await ready(h, 'alice', { funded: 200000 });
  const deposit = await h.fund(alice, 20000);
  alice.destination = await h.addDestination(alice);
  const withdrawal = ok(await h.call('POST', '/wallet/withdrawals', { token: alice.token, body: { destinationId: alice.destination.id, amountMinor: 20000, pin: PIN, idempotencyKey: h.key() } })).tx;
  const pending = ok(await h.call('POST', '/wallet/deposits', { token: alice.token, body: { amountMinor: 20000, idempotencyKey: h.key() } })).tx;

  fails(await reverse(h, a, withdrawal.id), 'invalid_state', { kind: 'withdrawal', status: 'pending_review' });
  fails(await reverse(h, a, pending.id), 'invalid_state', { kind: 'deposit', status: 'pending' });
  fails(await reverse(h, a, 'TRF-NOPE'), 'not_found');
  fails(await reverse(h, a, deposit.id, {}), 'invalid_argument', { field: 'reason' });
  fails(await reverse(h, a, deposit.id, { reason: 'x' }), 'invalid_argument', { field: 'reason' });
  fails(await reverse(h, a, deposit.id, { reason: 'fine reason', force: true }), 'invalid_argument', { field: 'force' });

  ok(await reverse(h, a, deposit.id));
  const reversal = h.db.list('walletTx').find((t) => t.data.kind === 'reversal');
  fails(await reverse(h, a, reversal.id), 'invalid_state', { kind: 'reversal' });
  assertInvariants(h);
});

test('two admins reversing the same transaction at once: only one reversal happens', async () => {
  for (let round = 0; round < 4; round += 1) {
    const { h, a } = await setup();
    const alice = await ready(h, 'alice');
    const deposit = await h.fund(alice, 50000);
    const results = await Promise.all([reverse(h, a, deposit.id), reverse(h, a, deposit.id), reverse(h, a, deposit.id)]);
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body.error || 'ok')));
    for (const res of results) if (res.status !== 200) assert.ok(['invalid_state', 'conflict'].includes(res.body.error.code));
    assert.equal(h.wallet('alice').availableMinor, 0);
    assert.equal(h.db.list('walletTx').filter((t) => t.data.kind === 'reversal').length, 1);
    assertInvariants(h);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------------------------------------------------

test('reconcile is clean on healthy data and reports the platform revenue', async () => {
  const { h, a } = await setup({ TRANSFER_FEE_FIXED_MINOR: '100' });
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  ok(await send(h, alice, bob, 20000));
  alice.destination = await h.addDestination(alice);
  ok(await h.call('POST', '/wallet/withdrawals', { token: alice.token, body: { destinationId: alice.destination.id, amountMinor: 10000, pin: PIN, idempotencyKey: h.key() } }));
  ok(await h.call('POST', '/wallet/deposits', { token: bob.token, body: { amountMinor: 10000, idempotencyKey: h.key() } }));

  const report = ok(await reconcile(h, a));
  assert.deepEqual(report.mismatches, []);
  assert.equal(report.walletsChecked, 2);
  assert.deepEqual(report.platformRevenue, { PHP: 100 });
  assert.equal(report.next, null);
});

test('reconcile finds every kind of tampering', async () => {
  const { h, a } = await setup();
  await ready(h, 'alice', { funded: 100000 });
  await ready(h, 'bob', { funded: 50000 });
  const carol = await ready(h, 'carol', { funded: 20000 });
  ok(await h.call('POST', '/wallet/deposits', { token: carol.token, body: { amountMinor: 10000, idempotencyKey: h.key() } }));

  h.db.seed('wallets/alice', { ...h.wallet('alice'), availableMinor: 100001 }); // money printed by hand
  h.db.seed('wallets/bob', { ...h.wallet('bob'), heldMinor: 5 });
  h.db.seed('wallets/carol', { ...h.wallet('carol'), pendingDepositMinor: 0 }); // forgot an open deposit

  const report = ok(await reconcile(h, a));
  const found = report.mismatches.map((m) => [m.uid, m.field, m.expected, m.actual]).sort();
  assert.deepEqual(found, [
    ['alice', 'availableMinor', 100000, 100001],
    ['bob', 'heldMinor', 0, 5],
    ['carol', 'pendingDepositMinor', 10000, 0],
  ]);

  // A deleted ledger entry is noticed too.
  h.db.seed('wallets/alice', { ...h.wallet('alice'), availableMinor: 100000 });
  h.db.seed('wallets/bob', { ...h.wallet('bob'), heldMinor: 0 });
  h.db.seed('wallets/carol', { ...h.wallet('carol'), pendingDepositMinor: 10000 });
  assert.deepEqual(ok(await reconcile(h, a)).mismatches, []);
  const entry = h.db.list('wallets/bob/ledger')[0];
  h.db._docs.delete(entry.path);
  const afterDelete = ok(await reconcile(h, a)).mismatches;
  assert.deepEqual(afterDelete.map((m) => [m.uid, m.field, m.expected, m.actual]), [['bob', 'availableMinor', 0, 50000]]);
});

test('reconcile flags negative balances', async () => {
  const { h, a } = await setup();
  await ready(h, 'alice');
  h.db.seed('wallets/alice', { ...h.wallet('alice'), availableMinor: -5 });
  const fields = ok(await reconcile(h, a)).mismatches.map((m) => m.field);
  assert.ok(fields.includes('availableMinor'));
  assert.ok(fields.filter((f) => f === 'availableMinor').length >= 1);
});

test('reconcile pages through the wallets', async () => {
  const { h, a } = await setup();
  for (const uid of ['u1', 'u2', 'u3', 'u4', 'u5']) await ready(h, uid);
  const seen = [];
  let after;
  for (let page = 0; page < 5; page += 1) {
    const res = ok(await reconcile(h, a, { limit: '2', ...(after ? { after } : {}) }));
    seen.push(res.walletsChecked);
    if (!res.next) break;
    after = res.next;
  }
  assert.deepEqual(seen, [2, 2, 1]);
  fails(await reconcile(h, a, { after: 'nobody' }), 'invalid_argument', { field: 'after' });
  fails(await reconcile(h, a, { limit: '0' }), 'invalid_argument', { field: 'limit' });
  fails(await reconcile(h, a, { limit: '501' }), 'invalid_argument', { field: 'limit' });
});
