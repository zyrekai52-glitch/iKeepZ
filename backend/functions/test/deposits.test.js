'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ok, fails } = require('./helpers/harness');
const { assertInvariants } = require('./helpers/invariants');
const { createFakePaymongo } = require('./helpers/fake-paymongo');
const { createPaymongoProvider } = require('../src/providers/paymongo');

const AMOUNT = 50000; // PHP 500.00

async function startDeposit(h, user, amountMinor = AMOUNT, extra = {}) {
  const data = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor, idempotencyKey: h.key(), ...extra } }));
  return { ...data, id: data.tx.id, providerRef: h.db.read(`walletTx/${data.tx.id}`).providerRef };
}

// Every step happens a second after the previous one so that event timestamps order deterministically.
const later = (h) => h.clock.advance(1000);
const sync = (h, user, id) => (later(h), h.call('POST', `/wallet/deposits/${id}/sync`, { token: user.token }));
const cancel = (h, user, id) => (later(h), h.call('POST', `/wallet/deposits/${id}/cancel`, { token: user.token }));
const hook = (h, delivery) => (later(h), h.call('POST', '/webhooks/paymongo', delivery));
const events = (h, id) => h.db.list(`walletTx/${id}/events`).map((e) => e.data).sort((a, b) => a.at - b.at);
const ledger = (h, uid) => h.db.list(`wallets/${uid}/ledger`).map((e) => e.data);

test('creating a deposit reserves a pending amount and returns a checkout link', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { tx, checkoutUrl, providerRef } = await startDeposit(h, user);

  assert.equal(tx.kind, 'deposit');
  assert.equal(tx.status, 'pending');
  assert.equal(tx.amountMinor, AMOUNT);
  assert.equal(tx.feeMinor, 0);
  assert.equal(tx.totalMinor, AMOUNT);
  assert.equal(tx.currency, 'PHP');
  assert.equal(tx.ownerUid, 'u1');
  assert.equal(tx.checkoutUrl, checkoutUrl);
  assert.match(checkoutUrl, /^https:\/\/pay\.test\/checkout\/cs_fake_1$/);
  assert.match(tx.reference, /^DEP-/);
  assert.equal(tx.reference, tx.id);
  assert.ok(!('dailyKey' in tx), 'internal fields are not exposed');

  const wallet = h.wallet('u1');
  assert.equal(wallet.availableMinor, 0, 'nothing is credited before the provider confirms');
  assert.equal(wallet.pendingDepositMinor, AMOUNT);
  assert.equal(ledger(h, 'u1').length, 0, 'a pending deposit writes no ledger entry');

  const [call] = h.provider.calls;
  assert.equal(call[0], 'createCheckout');
  assert.equal(call[1].reference, tx.id);
  assert.equal(call[1].amountMinor, AMOUNT);
  assert.equal(call[1].currency, 'PHP');
  assert.equal(call[1].returnUrl, 'https://ikeepz-test.web.app/payment-return.html');
  assert.equal(providerRef, 'cs_fake_1');
  assert.deepEqual(events(h, tx.id).map((e) => [e.from, e.to, e.by]), [[null, 'pending', 'user']]);
  assertInvariants(h);
});

test('deposit input is validated', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const post = (body) => h.call('POST', '/wallet/deposits', { token: user.token, body });
  const key = h.key();
  for (const amountMinor of [0, -100, 1.5, '50000', null, undefined, 10 ** 13 + 1, Number.NaN]) {
    fails(await post({ amountMinor, idempotencyKey: key }), 'invalid_argument', { field: 'amountMinor' });
  }
  for (const idempotencyKey of [undefined, '', 'short', 'x'.repeat(65), 'has spaces in it!!', 12345678901234567]) {
    fails(await post({ amountMinor: AMOUNT, idempotencyKey }), 'invalid_argument', { field: 'idempotencyKey' });
  }
  fails(await post({ amountMinor: AMOUNT, idempotencyKey: key, note: 'x' }), 'invalid_argument', { field: 'note' });
  fails(await post(undefined), 'invalid_argument');
  assert.equal(h.provider.calls.length, 0, 'nothing reaches the provider');
  assert.equal(h.db.list('walletTx').length, 0);
});

test('deposit amount limits', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const post = (amountMinor) => h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor, idempotencyKey: h.key() } });
  fails(await post(9999), 'limit_exceeded', { reason: 'below_min', minMinor: 10000, maxMinor: 5000000 });
  fails(await post(5000001), 'limit_exceeded', { reason: 'above_max' });
  ok(await post(10000));
  ok(await post(5000000));
  assertInvariants(h);
});

test('deposit fees are added to what the user pays, and only the amount is credited', async () => {
  const h = createHarness({ params: { DEPOSIT_FEE_BPS: '250', DEPOSIT_FEE_FIXED_MINOR: '1000' } });
  const user = await h.signup('u1');
  const { tx, providerRef } = await startDeposit(h, user, 100000);
  assert.equal(tx.feeMinor, 3500);
  assert.equal(tx.totalMinor, 103500);
  assert.equal(h.provider.calls[0][1].amountMinor, 103500, 'the checkout charges amount + fee');
  assert.equal(h.wallet('u1').pendingDepositMinor, 100000);

  h.provider.pay(providerRef);
  const done = ok(await sync(h, user, tx.id)).tx;
  assert.equal(done.status, 'completed');
  assert.equal(h.wallet('u1').availableMinor, 100000);
  assert.equal(h.wallet('u1').pendingDepositMinor, 0);
  assert.equal(h.revenue(), 3500);
  assertInvariants(h);
});

test('deposits are unavailable until the provider is configured', async () => {
  for (const make of [
    () => createHarness({ provider: false }),
    () => {
      const h = createHarness();
      h.provider.configured = false;
      return h;
    },
    () => createHarness({ params: { PUBLIC_RETURN_URL: '' } }),
  ]) {
    const h = make();
    const user = await h.signup('u1');
    const res = await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } });
    assert.equal(res.status, 503);
    fails(res, 'not_configured');
    assert.equal(h.db.list('walletTx').length, 0);
    assert.equal(h.wallet('u1').pendingDepositMinor, 0);
    const health = ok(await h.call('GET', '/health'));
    assert.equal(health.capabilities.deposits, false);
    assert.equal(health.capabilities.provider, null);
  }
});

test('a suspended user or frozen wallet cannot deposit; an un-bootstrapped user is told to finish setup', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const body = () => ({ amountMinor: AMOUNT, idempotencyKey: h.key() });
  h.db.seed('users/u1', { ...h.db.read('users/u1'), status: 'suspended' });
  fails(await h.call('POST', '/wallet/deposits', { token: user.token, body: body() }), 'account_suspended');
  h.db.seed('users/u1', { ...h.db.read('users/u1'), status: 'active' });
  h.db.seed('wallets/u1', { ...h.wallet('u1'), status: 'frozen' });
  fails(await h.call('POST', '/wallet/deposits', { token: user.token, body: body() }), 'account_suspended', { reason: 'wallet_frozen' });

  const fresh = await h.signup('u2', { bootstrap: false });
  fails(await h.call('POST', '/wallet/deposits', { token: fresh.token, body: body() }), 'not_found', { reason: 'not_bootstrapped' });
  const unverified = await h.signup('u3', { emailVerified: false, bootstrap: false });
  fails(await h.call('POST', '/wallet/deposits', { token: unverified.token, body: body() }), 'email_not_verified');
  assert.equal(h.provider.calls.length, 0);
});

test('the same idempotency key replays the same deposit; a different payload is a conflict', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const key = h.key();
  const first = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: key } }));
  const again = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: key } }));
  assert.equal(again.tx.id, first.tx.id);
  assert.equal(again.checkoutUrl, first.checkoutUrl);
  assert.equal(h.db.list('walletTx').length, 1);
  assert.equal(h.provider.calls.filter((c) => c[0] === 'createCheckout').length, 1);
  assert.equal(h.wallet('u1').pendingDepositMinor, AMOUNT, 'pending is counted once');

  fails(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT + 1, idempotencyKey: key } }), 'idempotency_conflict');

  // The same key belongs to the user: someone else can use it for their own deposit.
  const other = await h.signup('u2');
  const theirs = ok(await h.call('POST', '/wallet/deposits', { token: other.token, body: { amountMinor: AMOUNT, idempotencyKey: key } }));
  assert.notEqual(theirs.tx.id, first.tx.id);

  // Once paid, a replay shows the finished deposit and no checkout link.
  h.provider.pay(h.db.read(`walletTx/${first.tx.id}`).providerRef);
  ok(await sync(h, user, first.tx.id));
  const replay = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: key } }));
  assert.equal(replay.tx.status, 'completed');
  assert.equal(replay.checkoutUrl, null);
  assert.equal(replay.tx.checkoutUrl, null);
  assert.equal(h.wallet('u1').availableMinor, AMOUNT, 'a replay never credits twice');
  assertInvariants(h);
});

test('concurrent requests with one key create a single deposit', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const key = h.key();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: key } })),
  );
  const ids = new Set();
  for (const res of results) {
    // A request that arrives while the first one is still talking to the provider is told to retry; the rest see the deposit.
    if (res.status === 200) ids.add(res.body.data.tx.id);
    else fails(res, 'conflict');
  }
  assert.equal(ids.size, 1);
  assert.equal(h.db.list('walletTx').length, 1);
  assert.equal(h.provider.calls.filter((c) => c[0] === 'createCheckout').length, 1);
  assert.equal(h.wallet('u1').pendingDepositMinor, AMOUNT);
  assertInvariants(h);
});

test('if the provider cannot start the checkout the deposit fails cleanly', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  h.provider.failNextCreate = true;
  const key = h.key();
  const res = await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: key } });
  assert.equal(res.status, 502);
  fails(res, 'provider_error');

  const [only] = h.db.list('walletTx');
  assert.equal(only.data.status, 'failed');
  assert.equal(only.data.failureReason, 'provider_error');
  assert.equal(only.data.checkoutUrl, null);
  assert.equal(h.wallet('u1').pendingDepositMinor, 0, 'the reservation is released');
  assert.equal(h.notifications('u1').filter((n) => n.type === 'deposit_failed').length, 0, 'no confusing notification for a request that never started');

  // The key is spent: retrying with it shows the failed attempt; a new key starts afresh.
  const replay = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: key } }));
  assert.equal(replay.tx.status, 'failed');
  assert.equal(replay.checkoutUrl, null);
  const fresh = await startDeposit(h, user);
  assert.equal(fresh.tx.status, 'pending');
  assertInvariants(h);
});

test('deposit creation is rate limited, but replays are not', async () => {
  const h = createHarness({ relaxRateLimits: false });
  const user = await h.signup('u1');
  const first = { amountMinor: AMOUNT, idempotencyKey: h.key() };
  ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: first }));
  for (let i = 1; i < 10; i += 1) ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } }));
  const blocked = await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } });
  assert.equal(blocked.status, 429);
  fails(blocked, 'resource_exhausted');
  assert.ok(blocked.body.error.details.retryAfterSeconds > 0);
  ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: first }));
  h.clock.advance(3600 * 1000);
  ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } }));
});

// ---------------------------------------------------------------------------------------------------------------------
// Settling (sync)
// ---------------------------------------------------------------------------------------------------------------------

test('sync: unpaid leaves the deposit pending', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id } = await startDeposit(h, user);
  const result = ok(await sync(h, user, id)).tx;
  assert.equal(result.status, 'pending');
  assert.equal(h.wallet('u1').availableMinor, 0);
  assert.equal(h.wallet('u1').pendingDepositMinor, AMOUNT);
  assert.equal(result.checkoutUrl !== null, true, 'the owner can still open the checkout');
  assertInvariants(h);
});

test('sync: a verified payment credits the wallet exactly once, with ledger, notification, activity and audit trail', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);

  const done = ok(await sync(h, user, id)).tx;
  assert.equal(done.status, 'completed');
  assert.equal(done.checkoutUrl, null);
  assert.equal(done.providerPaymentId, `pay_${providerRef}`);
  assert.ok(done.completedAt);

  const wallet = h.wallet('u1');
  assert.equal(wallet.availableMinor, AMOUNT);
  assert.equal(wallet.pendingDepositMinor, 0);
  const [entry] = ledger(h, 'u1');
  assert.equal(entry.type, 'deposit_credit');
  assert.equal(entry.txId, id);
  assert.equal(entry.deltaAvailableMinor, AMOUNT);
  assert.equal(entry.balanceAvailableAfterMinor, AMOUNT);

  const notes = h.notifications('u1').filter((n) => n.type === 'deposit_completed');
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /PHP 500\.00/);
  assert.deepEqual(notes[0].data, { txId: id });
  const activity = h.db.list('users/u1/activity').map((a) => a.data).filter((a) => a.type === 'deposit_completed');
  assert.equal(activity.length, 1);
  assert.equal(activity[0].entityId, id);
  assert.deepEqual(events(h, id).map((e) => [e.from, e.to, e.by]), [[null, 'pending', 'user'], ['pending', 'completed', 'user']]);

  // Syncing again changes nothing.
  const again = ok(await sync(h, user, id)).tx;
  assert.equal(again.status, 'completed');
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assert.equal(ledger(h, 'u1').length, 1);
  assert.equal(h.notifications('u1').filter((n) => n.type === 'deposit_completed').length, 1);
  assertInvariants(h);
});

test('sync: wallet notifications can be switched off, the credit still happens', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const doc = h.db.read('users/u1');
  doc.preferences.notifications.wallet = false;
  h.db.seed('users/u1', doc);
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  ok(await sync(h, user, id));
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assert.equal(h.notifications('u1').length, 0);
});

test('sync: concurrent syncs and webhooks credit once', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  const results = await Promise.all([
    sync(h, user, id),
    sync(h, user, id),
    sync(h, user, id),
    hook(h, h.provider.webhookFor(providerRef, { eventId: 'evt_a' })),
    hook(h, h.provider.webhookFor(providerRef, { eventId: 'evt_b' })),
    sync(h, user, id),
  ]);
  for (const res of results) assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assert.equal(ledger(h, 'u1').length, 1);
  assert.equal(h.tx(id).status, 'completed');
  assert.equal(h.notifications('u1').filter((n) => n.type === 'deposit_completed').length, 1);
  assertInvariants(h);
});

test('sync: a payment that does not match the deposit is never credited', async () => {
  const cases = [
    ['a different amount', (h, ref) => h.provider.pay(ref, { amountMinor: AMOUNT - 1 })],
    ['a larger amount', (h, ref) => h.provider.pay(ref, { amountMinor: AMOUNT + 1 })],
    ['no amount', (h, ref) => h.provider.pay(ref, { amountMinor: null })],
    ['a different currency', (h, ref) => h.provider.pay(ref, { currency: 'USD' })],
    [
      'a different reference',
      (h, ref) => {
        h.provider.pay(ref);
        h.provider.sessions.get(ref).reference = 'DEP-SOMEONE-ELSES';
      },
    ],
  ];
  for (const [label, tamper] of cases) {
    const h = createHarness();
    const user = await h.signup('u1');
    const { id, providerRef } = await startDeposit(h, user);
    tamper(h, providerRef);
    const result = ok(await sync(h, user, id)).tx;
    assert.equal(result.status, 'failed', label);
    assert.equal(result.failureReason, 'payment_mismatch', label);
    assert.equal(h.wallet('u1').availableMinor, 0, label);
    assert.equal(h.wallet('u1').pendingDepositMinor, 0, label);
    assert.equal(ledger(h, 'u1').length, 0, label);
    assert.equal(h.revenue(), 0, label);
    const [audit] = h.db.list('adminAudit').map((a) => a.data);
    assert.equal(audit.action, 'deposit_payment_mismatch', label);
    assert.equal(audit.txId, id, label);
    assert.equal(audit.details.expectedMinor, AMOUNT, label);
    assert.equal(h.notifications('u1').filter((n) => n.type === 'deposit_failed').length, 1, label);
    assertInvariants(h);
  }
});

test('sync: an expired checkout closes the deposit and tells the user', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.expire(providerRef);
  const result = ok(await sync(h, user, id)).tx;
  assert.equal(result.status, 'expired');
  assert.equal(result.failureReason, 'expired');
  assert.equal(result.checkoutUrl, null);
  assert.equal(h.wallet('u1').pendingDepositMinor, 0);
  const [note] = h.notifications('u1').filter((n) => n.type === 'deposit_failed');
  assert.match(note.body, /checkout expired/);
  // Syncing an already-closed deposit is a no-op.
  assert.equal(ok(await sync(h, user, id)).tx.status, 'expired');
  assert.equal(h.notifications('u1').filter((n) => n.type === 'deposit_failed').length, 1);
  assertInvariants(h);
});

test('sync: a payment that arrives after the deposit was closed locally is still credited', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  h.provider.failExpire = true; // the provider could not be told to close the checkout...
  const { id, providerRef } = await startDeposit(h, user);
  const cancelled = ok(await cancel(h, user, id)).tx;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(h.wallet('u1').pendingDepositMinor, 0);

  h.provider.pay(providerRef); // ...so the customer could still pay it
  const late = ok(await sync(h, user, id)).tx;
  assert.equal(late.status, 'completed');
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assert.equal(h.wallet('u1').pendingDepositMinor, 0, 'pending is not decremented twice');
  assert.equal(events(h, id).at(-1).note, 'late payment');
  assert.equal(ledger(h, 'u1').length, 1);
  assertInvariants(h);
});

test('sync: a mismatched late payment is not credited and the deposit stays closed', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  h.provider.failExpire = true;
  const { id, providerRef } = await startDeposit(h, user);
  ok(await cancel(h, user, id));
  h.provider.pay(providerRef, { amountMinor: 1 });
  const result = ok(await sync(h, user, id)).tx;
  assert.equal(result.status, 'cancelled');
  assert.equal(h.wallet('u1').availableMinor, 0);
  assert.equal(h.db.list('adminAudit').length, 1);
  assertInvariants(h);
});

test('sync: provider outages change nothing and can be retried', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  h.provider.failFetch = true;
  const res = await sync(h, user, id);
  assert.equal(res.status, 502);
  fails(res, 'provider_error');
  assert.equal(h.tx(id).status, 'pending');
  assert.equal(h.wallet('u1').availableMinor, 0);
  h.provider.failFetch = false;
  assert.equal(ok(await sync(h, user, id)).tx.status, 'completed');
  assertInvariants(h);
});

test('sync and cancel only work on the caller\'s own deposits', async () => {
  const h = createHarness();
  const alice = await h.signup('alice');
  const bob = await h.signup('bob');
  const { id, providerRef } = await startDeposit(h, alice);
  h.provider.pay(providerRef);
  fails(await sync(h, bob, id), 'not_found');
  fails(await cancel(h, bob, id), 'not_found');
  fails(await sync(h, alice, 'DEP-DOES-NOT-EXIST'), 'not_found');
  assert.equal(h.tx(id).status, 'pending', 'bob could not settle alice\'s payment');

  // Other kinds of transaction are not deposits.
  await h.fund(alice, AMOUNT);
  await h.addDestination(alice);
  h.db.seed('walletTx/WDR-X', { ...h.db.read(`walletTx/${id}`), kind: 'withdrawal', reference: 'WDR-X' });
  fails(await sync(h, alice, 'WDR-X'), 'not_found');
});

// ---------------------------------------------------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------------------------------------------------

test('cancel: closes the checkout at the provider and releases the reservation', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  const result = ok(await cancel(h, user, id)).tx;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.checkoutUrl, null);
  assert.equal(h.wallet('u1').pendingDepositMinor, 0);
  assert.deepEqual(h.provider.calls.map((c) => c[0]), ['createCheckout', 'fetchPayment', 'expireCheckout']);
  assert.equal(h.provider.sessions.get(providerRef).status, 'expired');
  assert.equal(h.notifications('u1').length, 0, 'the user did this themselves, no notification');
  fails(await cancel(h, user, id), 'invalid_state', { status: 'cancelled' });
  assertInvariants(h);
});

test('cancel: a payment that already went through wins over the cancellation', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  const result = ok(await cancel(h, user, id)).tx;
  assert.equal(result.status, 'completed');
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  fails(await cancel(h, user, id), 'invalid_state', { status: 'completed' });
  assertInvariants(h);
});

test('cancel: if the provider cannot be asked, the deposit stays pending so no payment is lost', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id } = await startDeposit(h, user);
  h.provider.failFetch = true;
  const res = await cancel(h, user, id);
  assert.equal(res.status, 502);
  assert.equal(h.tx(id).status, 'pending');
  assert.equal(h.wallet('u1').pendingDepositMinor, AMOUNT);
  assertInvariants(h);
});

test('cancel: when the provider cannot close the checkout the deposit is still cancelled and a warning is logged', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id } = await startDeposit(h, user);
  h.provider.failExpire = true;
  assert.equal(ok(await cancel(h, user, id)).tx.status, 'cancelled');
  assert.ok(h.logs.some((entry) => entry[0] === 'warn' && /Could not expire/.test(entry[1])));
  assertInvariants(h);
});

// ---------------------------------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------------------------------

test('webhook: a verified paid event credits the deposit and is recorded', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  const res = await hook(h, h.provider.webhookFor(providerRef, { eventId: 'evt_1' }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { received: true, settled: 'completed' });
  assert.equal(h.tx(id).status, 'completed');
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assert.equal(events(h, id).at(-1).by, 'provider');
  const recorded = h.db.read('providerEvents/evt_1');
  assert.equal(recorded.type, 'checkout_session.payment.paid');
  assert.ok(recorded.expiresAt > h.clock.now());
  assertInvariants(h);
});

test('webhook: a redelivered event is acknowledged and does nothing', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  const delivery = h.provider.webhookFor(providerRef, { eventId: 'evt_1' });
  assert.deepEqual((await hook(h, delivery)).body.data, { received: true, settled: 'completed' });
  const callsBefore = h.provider.calls.length;
  assert.deepEqual((await hook(h, delivery)).body.data, { received: true, duplicate: true });
  assert.equal(h.provider.calls.length, callsBefore, 'a duplicate does not even call the provider');
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  // A second, different event for the same payment is also harmless.
  assert.deepEqual((await hook(h, h.provider.webhookFor(providerRef, { eventId: 'evt_2' }))).body.data, { received: true, settled: 'completed' });
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assertInvariants(h);
});

test('webhook: signatures are checked before anything else', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  const good = h.provider.webhookFor(providerRef);
  for (const delivery of [
    { rawBody: good.rawBody, headers: {} },
    { rawBody: good.rawBody, headers: { 'x-test-signature': 'wrong' } },
    { rawBody: undefined, headers: good.headers },
    { rawBody: Buffer.alloc(0), headers: good.headers },
    {},
  ]) {
    const res = await hook(h, delivery);
    assert.equal(res.status, 401);
    fails(res, 'unauthenticated');
  }
  assert.equal(h.tx(id).status, 'pending');
  assert.equal(h.wallet('u1').availableMinor, 0);
  assert.equal(h.db.list('providerEvents').length, 0);
  assert.ok(!h.provider.calls.some((c) => c[0] === 'fetchPayment'), 'the provider is not queried for unauthenticated calls');
});

test('webhook: payments are not configured', async () => {
  for (const provider of [false]) {
    const h = createHarness({ provider });
    const res = await hook(h, { rawBody: Buffer.from('{}'), headers: {} });
    assert.equal(res.status, 503);
    fails(res, 'not_configured');
  }
  const h = createHarness();
  h.provider.configured = false;
  fails(await hook(h, h.provider.webhookFor('cs_x')), 'not_configured');
});

test('webhook: a signed but malformed body is rejected', async () => {
  const h = createHarness();
  const signed = { 'x-test-signature': 'whsec_test' };
  const res = await hook(h, { rawBody: Buffer.from('{not json'), headers: signed });
  assert.equal(res.status, 400);
  fails(res, 'invalid_argument');
  fails(await hook(h, { rawBody: Buffer.from('{"hello":"world"}'), headers: signed }), 'invalid_argument');
  fails(await hook(h, { rawBody: Buffer.from('[]'), headers: signed }), 'invalid_argument');
});

test('webhook: the body is only a hint, the provider decides whether it was paid', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  // A signed "paid" event while the provider still says unpaid (or a replayed old event) credits nothing, and asks for redelivery.
  const res = await hook(h, h.provider.webhookFor(providerRef, { eventId: 'evt_early' }));
  assert.equal(res.status, 409);
  fails(res, 'conflict');
  assert.equal(h.tx(id).status, 'pending');
  assert.equal(h.wallet('u1').availableMinor, 0);
  assert.ok(!h.db.read('providerEvents/evt_early'), 'an unconfirmed event is not marked as handled, so the redelivery is processed');

  h.provider.pay(providerRef);
  assert.deepEqual((await hook(h, h.provider.webhookFor(providerRef, { eventId: 'evt_early' }))).body.data, { received: true, settled: 'completed' });
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assertInvariants(h);
});

test('webhook: other event types and unknown sessions are acknowledged without effect', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  const other = await hook(h, h.provider.webhookFor(providerRef, { eventId: 'evt_other', type: 'payment.failed' }));
  assert.deepEqual(other.body.data, { received: true, settled: null });
  assert.equal(h.tx(id).status, 'pending', 'only checkout_session.payment.paid is acted upon');

  const unknown = await hook(h, h.provider.webhookFor('cs_unknown', { eventId: 'evt_unknown' }));
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body.data, { received: true, settled: null });
  assert.ok(h.logs.some((entry) => entry[0] === 'warn' && /no deposit for/.test(entry[1])));
  assert.equal(h.wallet('u1').availableMinor, 0);
  assertInvariants(h);
});

test('webhook: if the provider cannot be reached the event is not recorded, so the retry succeeds', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef);
  h.provider.failFetch = true;
  const delivery = h.provider.webhookFor(providerRef, { eventId: 'evt_retry' });
  const failed = await hook(h, delivery);
  assert.equal(failed.status, 502);
  assert.ok(!h.db.read('providerEvents/evt_retry'));
  assert.equal(h.tx(id).status, 'pending');
  h.provider.failFetch = false;
  assert.deepEqual((await hook(h, delivery)).body.data, { received: true, settled: 'completed' });
  assertInvariants(h);
});

test('webhook: a paid event with a mismatching amount fails the deposit and alerts the admin trail', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const { id, providerRef } = await startDeposit(h, user);
  h.provider.pay(providerRef, { amountMinor: 100 });
  const res = await hook(h, h.provider.webhookFor(providerRef));
  assert.deepEqual(res.body.data, { received: true, settled: 'failed' });
  assert.equal(h.tx(id).failureReason, 'payment_mismatch');
  assert.equal(h.wallet('u1').availableMinor, 0);
  assert.equal(h.db.list('adminAudit').length, 1);
  assertInvariants(h);
});

// ---------------------------------------------------------------------------------------------------------------------
// End to end through the real PayMongo adapter, a stubbed PayMongo API and genuine HMAC signatures
// ---------------------------------------------------------------------------------------------------------------------

function realProviderHarness(params) {
  const fake = createFakePaymongo();
  const provider = createPaymongoProvider({
    secretKey: fake.secretKey,
    webhookSecret: fake.webhookSecret,
    paymentMethods: ['gcash', 'card'],
    fetchImpl: fake.fetchImpl,
    logger: { warn() {}, info() {}, error() {} },
  });
  const h = createHarness({ provider, params });
  return { h, fake };
}

test('end to end: deposit -> hosted checkout -> signed webhook -> ledger credit', async () => {
  const { h, fake } = realProviderHarness({ DEPOSIT_FEE_BPS: '100' });
  const user = await h.signup('u1');
  const health = ok(await h.call('GET', '/health'));
  assert.equal(health.capabilities.deposits, true);
  assert.equal(health.capabilities.provider, 'paymongo');

  const created = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: 100000, idempotencyKey: h.key() } }));
  assert.equal(created.tx.feeMinor, 1000);
  assert.equal(created.checkoutUrl, 'https://checkout.paymongo.test/cs_test_1');
  const [request] = fake.requests;
  assert.equal(request.body.data.attributes.line_items[0].amount, 101000, 'the customer is charged amount + fee');
  assert.equal(request.body.data.attributes.reference_number, created.tx.id);
  assert.deepEqual(request.body.data.attributes.payment_method_types, ['gcash', 'card']);
  assert.equal(h.wallet('u1').availableMinor, 0);

  // Before the customer pays, a signed event cannot credit anything: PayMongo itself says "unpaid".
  const early = await hook(h, fake.webhook('cs_test_1', { eventId: 'evt_early' }));
  assert.equal(early.status, 409);
  assert.equal(h.wallet('u1').availableMinor, 0);

  fake.pay('cs_test_1');
  const delivery = fake.webhook('cs_test_1', { eventId: 'evt_paid' });
  const res = await hook(h, delivery);
  assert.deepEqual(res.body.data, { received: true, settled: 'completed' });
  assert.equal(h.wallet('u1').availableMinor, 100000);
  assert.equal(h.revenue(), 1000);
  assert.deepEqual((await hook(h, delivery)).body.data, { received: true, duplicate: true });
  assert.equal(h.wallet('u1').availableMinor, 100000);
  const done = ok(await sync(h, user, created.tx.id)).tx;
  assert.equal(done.status, 'completed');
  assertInvariants(h);
});

test('end to end: forged, tampered and mis-signed webhooks are refused', async () => {
  const { h, fake } = realProviderHarness();
  const user = await h.signup('u1');
  const created = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } }));
  fake.pay('cs_test_1');

  const genuine = fake.webhook('cs_test_1');
  const forged = fake.webhook('cs_test_1', { secret: 'not-the-webhook-secret' });
  const tampered = { rawBody: Buffer.from(genuine.rawBody.toString().replace('cs_test_1', 'cs_test_2')), headers: genuine.headers };
  const noHeader = { rawBody: genuine.rawBody, headers: {} };
  for (const delivery of [forged, tampered, noHeader]) {
    const res = await hook(h, delivery);
    assert.equal(res.status, 401);
    fails(res, 'unauthenticated');
  }
  assert.equal(h.tx(created.tx.id).status, 'pending');
  assert.equal(h.wallet('u1').availableMinor, 0);
  assert.equal((await hook(h, genuine)).status, 200);
  assert.equal(h.wallet('u1').availableMinor, AMOUNT);
  assertInvariants(h);
});

test('end to end: a short payment at the provider fails the deposit', async () => {
  const { h, fake } = realProviderHarness();
  const user = await h.signup('u1');
  const created = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } }));
  fake.pay('cs_test_1', { amount: AMOUNT - 100 });
  const res = await hook(h, fake.webhook('cs_test_1'));
  assert.deepEqual(res.body.data, { received: true, settled: 'failed' });
  assert.equal(h.tx(created.tx.id).failureReason, 'payment_mismatch');
  assert.equal(h.wallet('u1').availableMinor, 0);
  assertInvariants(h);
});

test('end to end: cancelling closes the real checkout session; a provider outage surfaces as 502', async () => {
  const { h, fake } = realProviderHarness();
  const user = await h.signup('u1');
  const created = ok(await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } }));
  assert.equal(ok(await cancel(h, user, created.tx.id)).tx.status, 'cancelled');
  assert.equal(fake.sessions.get('cs_test_1').status, 'expired');
  assert.ok(fake.requests.some((r) => r.method === 'POST' && r.url.endsWith('/checkout_sessions/cs_test_1/expire')));

  fake.behaviour.networkDown = true;
  const res = await h.call('POST', '/wallet/deposits', { token: user.token, body: { amountMinor: AMOUNT, idempotencyKey: h.key() } });
  assert.equal(res.status, 502);
  fails(res, 'provider_error');
  assert.equal(h.wallet('u1').pendingDepositMinor, 0);
  assert.ok(!JSON.stringify(h.logs).includes('sk_test_'), 'secrets never reach the logs');
  assertInvariants(h);
});
