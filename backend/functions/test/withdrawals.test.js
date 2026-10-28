'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ok, fails } = require('./helpers/harness');
const { assertInvariants } = require('./helpers/invariants');
const { maskName } = require('../src/util');

const PIN = '135790';

/** A signed-up user with a PIN, some money and one payout destination. */
async function ready(h, uid, { funded = 200000, name } = {}) {
  const user = await h.signup(uid, name ? { displayName: name } : {});
  await h.setPin(user, PIN);
  if (funded) await h.fund(user, funded);
  const destination = await h.addDestination(user);
  return { ...user, destination, pin: PIN };
}

function withdraw(h, u, body = {}) {
  return h.call('POST', '/wallet/withdrawals', {
    token: u.token,
    body: { destinationId: u.destination.id, amountMinor: 50000, pin: u.pin, idempotencyKey: h.key(), ...body },
  });
}

async function admin(h) {
  return h.signup('admin1', { admin: true, bootstrap: false });
}

const act = (h, a, id, action, body) => h.call('POST', `/admin/withdrawals/${id}/${action}`, { token: a.token, body });
const later = (h) => h.clock.advance(1000);
const events = (h, id) => h.db.list(`walletTx/${id}/events`).map((e) => e.data).sort((x, y) => x.at - y.at);
const ledger = (h, uid) => h.db.list(`wallets/${uid}/ledger`).map((e) => e.data).sort((x, y) => x.seq - y.seq);
const dailyOut = (h, uid) => h.db.list('walletDaily').filter((d) => d.id.startsWith(`${uid}_`)).reduce((sum, d) => sum + d.data.outMinor, 0);

// ---------------------------------------------------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------------------------------------------------

test('a destination is shown masked; the full number stays on the server', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const res = ok(await h.call('POST', '/wallet/destinations', {
    token: user.token,
    body: { kind: 'bank', providerName: '  BDO  Unibank ', accountName: 'Juan  Dela Cruz', accountNumber: '0012-3456 7890' },
  }));
  const { destination } = res;
  assert.equal(destination.kind, 'bank');
  assert.equal(destination.providerName, 'BDO Unibank');
  assert.equal(destination.accountName, 'Juan Dela Cruz');
  assert.equal(destination.accountNumberMasked, '••••7890');
  assert.equal(destination.status, 'active');
  assert.ok(!JSON.stringify(res).includes('0012'), 'the response never contains the number');

  const visible = h.db.read(`users/u1/destinations/${destination.id}`);
  assert.ok(!JSON.stringify(visible).includes('00123456'), 'the user-readable document has no number');
  const secret = h.db.read(`destinationSecrets/${destination.id}`);
  assert.equal(secret.accountNumber, '001234567890', 'spaces and dashes are removed');
  assert.equal(secret.ownerUid, 'u1');
  assert.ok(h.db.list('users/u1/activity').some((a) => a.data.type === 'destination_added'));
});

test('destination input is validated', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const good = { kind: 'ewallet', providerName: 'GCash', accountName: 'Juan Dela Cruz', accountNumber: '09171234567' };
  const post = (override) => h.call('POST', '/wallet/destinations', { token: user.token, body: { ...good, ...override } });
  fails(await post({ kind: 'crypto' }), 'invalid_argument', { field: 'kind' });
  fails(await post({ providerName: 'G' }), 'invalid_argument', { field: 'providerName' });
  fails(await post({ providerName: ' \u0007 ' }), 'invalid_argument', { field: 'providerName' });
  fails(await post({ accountName: '' }), 'invalid_argument', { field: 'accountName' });
  fails(await post({ accountNumber: '123' }), 'invalid_argument', { field: 'accountNumber' });
  fails(await post({ accountNumber: '1234;DROP' }), 'invalid_argument', { field: 'accountNumber' });
  fails(await post({ accountNumber: '1'.repeat(35) }), 'invalid_argument', { field: 'accountNumber' });
  fails(await post({ extra: 1 }), 'invalid_argument', { field: 'extra' });
  assert.equal(h.db.list('destinationSecrets').length, 0);
  ok(await post({}));
});

test('at most five destinations; removing one frees a slot', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push((await h.addDestination(user, { accountNumber: `0917000000${i}` })).id);
  const sixth = await h.call('POST', '/wallet/destinations', {
    token: user.token,
    body: { kind: 'ewallet', providerName: 'GCash', accountName: 'Juan', accountNumber: '09179999999' },
  });
  fails(sixth, 'limit_exceeded', { reason: 'max_destinations', max: 5 });
  ok(await h.call('DELETE', `/wallet/destinations/${ids[0]}`, { token: user.token }));
  await h.addDestination(user, { accountNumber: '09178888888' });
  assert.equal(h.db.list('users/u1/destinations').filter((d) => d.data.status === 'active').length, 5);
});

test('removing a destination: soft delete, idempotent, owner only, blocked while a withdrawal is open', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  const other = await h.signup('u2');
  const del = (user, id) => h.call('DELETE', `/wallet/destinations/${id}`, { token: user.token });

  fails(await del(other, u.destination.id), 'not_found');
  fails(await del(u, 'nope'), 'not_found');
  fails(await del(u, 'a'.repeat(10)), 'not_found');
  fails(await del(u, '../../x'), 'not_found');

  const placed = ok(await withdraw(h, u)).tx;
  fails(await del(u, u.destination.id), 'invalid_state', { reason: 'open_withdrawal' });
  const a = await admin(h);
  ok(await act(h, a, placed.id, 'approve'));
  fails(await del(u, u.destination.id), 'invalid_state', { reason: 'open_withdrawal' });
  ok(await act(h, a, placed.id, 'complete', { payoutReference: 'GCASH-123' }));

  ok(await del(u, u.destination.id));
  ok(await del(u, u.destination.id));
  assert.equal(h.db.read(`users/u1/destinations/${u.destination.id}`).status, 'removed');
  assert.equal(h.db.read(`destinationSecrets/${u.destination.id}`).status, 'removed');
  assert.equal(h.db.read(`destinationSecrets/${u.destination.id}`).accountNumber, '09171234567', 'kept for the audit trail of the earlier payout');
  fails(await withdraw(h, u), 'not_found', { field: 'destinationId' });
  assertInvariants(h);
});

test('destination creation is rate limited', async () => {
  const h = createHarness({ relaxRateLimits: false });
  const user = await h.signup('u1');
  for (let i = 0; i < 10; i += 1) {
    const res = await h.call('POST', '/wallet/destinations', {
      token: user.token,
      body: { kind: 'ewallet', providerName: 'GCash', accountName: 'Juan', accountNumber: `0917000000${i}` },
    });
    if (i < 5) assert.equal(res.status, 200);
    else fails(res, 'limit_exceeded');
  }
  fails(await h.call('POST', '/wallet/destinations', { token: user.token, body: { kind: 'ewallet', providerName: 'GCash', accountName: 'Juan', accountNumber: '09170000099' } }), 'resource_exhausted');
});

// ---------------------------------------------------------------------------------------------------------------------
// Creating a withdrawal
// ---------------------------------------------------------------------------------------------------------------------

test('a withdrawal holds the funds and waits for review', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1', { funded: 200000 });
  const { tx } = ok(await withdraw(h, u));
  assert.equal(tx.kind, 'withdrawal');
  assert.equal(tx.status, 'pending_review');
  assert.equal(tx.amountMinor, 50000);
  assert.equal(tx.feeMinor, 0);
  assert.equal(tx.totalMinor, 50000);
  assert.equal(tx.destinationId, u.destination.id);
  assert.equal(tx.destinationSummary, 'GCash ••••4567');
  assert.equal(tx.ownerDisplay, maskName('u1'));
  assert.equal(tx.checkoutUrl, null);
  assert.ok(!('dailyKey' in tx));

  const wallet = h.wallet('u1');
  assert.equal(wallet.availableMinor, 150000);
  assert.equal(wallet.heldMinor, 50000);
  const hold = ledger(h, 'u1').at(-1);
  assert.deepEqual([hold.type, hold.deltaAvailableMinor, hold.deltaHeldMinor, hold.txId], ['withdrawal_hold', -50000, 50000, tx.id]);
  assert.equal(dailyOut(h, 'u1'), 50000);
  assert.deepEqual(events(h, tx.id).map((e) => [e.from, e.to, e.by]), [[null, 'pending_review', 'user']]);
  const [note] = h.notifications('u1').filter((n) => n.type === 'withdrawal_requested');
  assert.match(note.body, /PHP 500\.00 to GCash ••••4567/);
  assertInvariants(h);
});

test('withdrawal fees are held on top of the amount', async () => {
  const h = createHarness({ params: { WITHDRAW_FEE_BPS: '100', WITHDRAW_FEE_FIXED_MINOR: '500' } });
  const u = await ready(h, 'u1', { funded: 100000 });
  const { tx } = ok(await withdraw(h, u, { amountMinor: 50000 }));
  assert.equal(tx.feeMinor, 1000);
  assert.equal(tx.totalMinor, 51000);
  assert.equal(h.wallet('u1').heldMinor, 51000);
  assert.equal(h.wallet('u1').availableMinor, 49000);
  // The whole balance can be withdrawn when amount + fee fit exactly: 48020 + (1% = 480 + 500) = 49000.
  const rest = ok(await withdraw(h, u, { amountMinor: 48020 })).tx;
  assert.equal(rest.feeMinor, 980);
  assert.equal(rest.totalMinor, 49000);
  assert.equal(h.wallet('u1').availableMinor, 0);
  assertInvariants(h);
});

test('a withdrawal can use the entire balance, but not one minor unit more', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1', { funded: 100000 });
  const res = await withdraw(h, u, { amountMinor: 100001 });
  const error = fails(res, 'insufficient_funds');
  assert.equal(res.status, 409);
  assert.equal(error.details.availableMinor, 100000);
  assert.equal(error.details.neededMinor, 100001);
  assert.equal(h.wallet('u1').heldMinor, 0);
  assert.equal(ledger(h, 'u1').length, 1, 'nothing was written');
  ok(await withdraw(h, u, { amountMinor: 100000 }));
  assert.equal(h.wallet('u1').availableMinor, 0);
  assert.equal(h.wallet('u1').heldMinor, 100000);
  fails(await withdraw(h, u, { amountMinor: 10000 }), 'insufficient_funds');
  assertInvariants(h);
});

test('withdrawal input is validated', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  for (const amountMinor of [0, -1, 1.5, '50000', null, 10 ** 13 + 1]) {
    fails(await withdraw(h, u, { amountMinor }), 'invalid_argument', { field: 'amountMinor' });
  }
  for (const pin of ['12345', '1234567', 'abcdef', '12 456', 135790, null]) {
    fails(await withdraw(h, u, { pin }), 'invalid_argument', { field: 'pin' });
  }
  for (const destinationId of ['', 'a/b', '../x', 'x'.repeat(41), 7]) {
    fails(await withdraw(h, u, { destinationId }), 'invalid_argument', { field: 'destinationId' });
  }
  fails(await withdraw(h, u, { idempotencyKey: 'short' }), 'invalid_argument', { field: 'idempotencyKey' });
  fails(await withdraw(h, u, { extra: true }), 'invalid_argument', { field: 'extra' });
  assert.equal(h.wallet('u1').heldMinor, 0);
});

test('withdrawal amount limits', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1', { funded: 1000000 });
  fails(await withdraw(h, u, { amountMinor: 9999 }), 'limit_exceeded', { reason: 'below_min' });
  fails(await withdraw(h, u, { amountMinor: 5000001 }), 'limit_exceeded', { reason: 'above_max' });
  ok(await withdraw(h, u, { amountMinor: 10000 }));
});

test('the wallet PIN is checked on the server for every withdrawal', async () => {
  const h = createHarness();
  const noPin = await h.signup('nopin');
  await h.fund(noPin, 100000);
  noPin.destination = await h.addDestination(noPin);
  noPin.pin = PIN;
  fails(await withdraw(h, noPin), 'pin_required');

  const u = await ready(h, 'u1');
  const wrong = fails(await withdraw(h, u, { pin: '000001' }), 'pin_incorrect');
  assert.equal(wrong.details.attemptsRemaining, 4);
  assert.equal(h.wallet('u1').heldMinor, 0, 'nothing moves without the right PIN');
  assert.equal(h.db.list('walletTx').filter((t) => t.data.kind === 'withdrawal').length, 0);

  for (let i = 0; i < 3; i += 1) fails(await withdraw(h, u, { pin: '000001' }), 'pin_incorrect');
  const locked = await withdraw(h, u, { pin: '000001' });
  assert.equal(locked.status, 423);
  fails(locked, 'pin_locked');
  const refused = await withdraw(h, u); // right PIN, but the account is locked
  assert.equal(refused.status, 423);
  assert.equal(h.wallet('u1').heldMinor, 0);

  h.clock.advance(16 * 60 * 1000);
  ok(await withdraw(h, u));
  assertInvariants(h);
});

test('a correct PIN resets earlier failures', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  for (let i = 0; i < 4; i += 1) fails(await withdraw(h, u, { pin: '000001' }), 'pin_incorrect');
  ok(await withdraw(h, u));
  assert.equal(h.db.read('walletSecurity/u1').failedAttempts, 0);
  fails(await withdraw(h, u, { pin: '000001' }), 'pin_incorrect', { attemptsRemaining: 4 });
});

test('withdrawals are refused for suspended, frozen, disabled or unverified accounts', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  const user = () => h.db.read('users/u1');
  h.db.seed('users/u1', { ...user(), withdrawalsEnabled: false });
  fails(await withdraw(h, u), 'feature_disabled');
  h.db.seed('users/u1', { ...user(), withdrawalsEnabled: true, status: 'suspended' });
  fails(await withdraw(h, u), 'account_suspended');
  h.db.seed('users/u1', { ...user(), status: 'active' });
  h.db.seed('wallets/u1', { ...h.wallet('u1'), status: 'frozen' });
  fails(await withdraw(h, u), 'account_suspended', { reason: 'wallet_frozen' });
  h.db.seed('wallets/u1', { ...h.wallet('u1'), status: 'active' });
  h.auth.setVerified('u1', false);
  fails(await h.call('POST', '/wallet/withdrawals', { token: h.auth.issue('u1'), body: { destinationId: u.destination.id, amountMinor: 50000, pin: PIN, idempotencyKey: h.key() } }), 'email_not_verified');
  h.auth.setVerified('u1', true);
  ok(await withdraw(h, { ...u, token: h.auth.issue('u1') }));
  assert.equal(h.wallet('u1').heldMinor, 50000);
});

test('identity verification can be required before withdrawing', async () => {
  const h = createHarness({ params: { REQUIRE_KYC_FOR_WITHDRAWAL: 'true' } });
  const u = await ready(h, 'u1');
  assert.equal(ok(await h.call('GET', '/health')).capabilities.requireKyc, true);
  fails(await withdraw(h, u), 'kyc_required');
  h.db.seed('users/u1', { ...h.db.read('users/u1'), kycStatus: 'approved' });
  ok(await withdraw(h, u));
});

test('only the user\'s own active destinations can be used', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice');
  const bob = await ready(h, 'bob');
  fails(await withdraw(h, alice, { destinationId: bob.destination.id }), 'not_found', { field: 'destinationId' });
  fails(await withdraw(h, alice, { destinationId: 'doesnotexist1' }), 'not_found', { field: 'destinationId' });
  assert.equal(h.wallet('alice').heldMinor, 0);
  assert.equal(h.wallet('bob').heldMinor, 0);
});

test('the daily outgoing limit counts holds, and is given back when a withdrawal is cancelled', async () => {
  const h = createHarness({ params: { DAILY_OUT_LIMIT_MINOR: '100000' } });
  const u = await ready(h, 'u1', { funded: 400000 });
  const first = ok(await withdraw(h, u)).tx;
  ok(await withdraw(h, u));
  const blocked = fails(await withdraw(h, u), 'limit_exceeded', { reason: 'daily_limit', remainingMinor: 0 });
  assert.ok(blocked);
  assert.equal(dailyOut(h, 'u1'), 100000);

  ok(await h.call('POST', `/wallet/withdrawals/${first.id}/cancel`, { token: u.token }));
  assert.equal(dailyOut(h, 'u1'), 50000);
  ok(await withdraw(h, u));
  fails(await withdraw(h, u, { amountMinor: 10000 }), 'limit_exceeded', { reason: 'daily_limit' });

  // The limit is per local day (UTC+8): after midnight in Manila there is room again.
  h.clock.advance(15 * 3600 * 1000);
  ok(await withdraw(h, u, { amountMinor: 100000 }));
  assertInvariants(h);
});

test('quote reports the daily limit and balance problems for withdrawals', async () => {
  const h = createHarness({ params: { DAILY_OUT_LIMIT_MINOR: '60000' } });
  const u = await ready(h, 'u1', { funded: 100000 });
  const quote = async (amountMinor) => ok(await h.call('POST', '/wallet/quote', { token: u.token, body: { kind: 'withdrawal', amountMinor } }));
  assert.equal((await quote(50000)).problem, null);
  assert.equal((await quote(70000)).problem, 'daily_limit');
  ok(await withdraw(h, u, { amountMinor: 50000 }));
  const afterwards = await quote(20000);
  assert.equal(afterwards.problem, 'daily_limit');
  assert.equal(afterwards.remainingDailyMinor, 10000);
});

test('the same idempotency key never creates a second withdrawal', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  const key = h.key();
  const first = ok(await withdraw(h, u, { idempotencyKey: key })).tx;
  const again = ok(await withdraw(h, u, { idempotencyKey: key })).tx;
  assert.equal(again.id, first.id);
  assert.equal(h.wallet('u1').heldMinor, 50000, 'held once');
  assert.equal(h.db.list('walletTx').filter((t) => t.data.kind === 'withdrawal').length, 1);
  fails(await withdraw(h, u, { idempotencyKey: key, amountMinor: 60000 }), 'idempotency_conflict');
  const otherDestination = await h.addDestination(u, { accountNumber: '09170000000' });
  fails(await withdraw(h, u, { idempotencyKey: key, destinationId: otherDestination.id }), 'idempotency_conflict');
  // A replay answers from the stored record; it does not need the PIN again and it cannot be abused to probe it.
  const replay = await withdraw(h, u, { idempotencyKey: key, pin: '000001' });
  assert.equal(replay.status, 200);
  assert.equal(h.db.read('walletSecurity/u1').failedAttempts, 0);
  // The record survives later changes to the account.
  ok(await h.call('POST', `/wallet/withdrawals/${first.id}/cancel`, { token: u.token }));
  const afterCancel = ok(await withdraw(h, u, { idempotencyKey: key })).tx;
  assert.equal(afterCancel.status, 'cancelled');
  assert.equal(h.wallet('u1').heldMinor, 0);
  assertInvariants(h);
});

test('parallel requests with one key create a single withdrawal', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  const key = h.key();
  const results = await Promise.all(Array.from({ length: 5 }, () => withdraw(h, u, { idempotencyKey: key })));
  const ids = new Set();
  for (const res of results) {
    if (res.status === 200) ids.add(res.body.data.tx.id);
    else fails(res, 'conflict');
  }
  assert.equal(ids.size, 1);
  assert.equal(h.wallet('u1').heldMinor, 50000);
  assert.equal(h.db.list('walletTx').filter((t) => t.data.kind === 'withdrawal').length, 1);
  assertInvariants(h);
});

test('parallel withdrawals can never spend the same money twice', async () => {
  for (let round = 0; round < 5; round += 1) {
    const h = createHarness();
    const u = await ready(h, 'u1', { funded: 100000 });
    const results = await Promise.all(Array.from({ length: 6 }, () => withdraw(h, u, { amountMinor: 40000 })));
    const succeeded = results.filter((r) => r.status === 200).length;
    for (const res of results) {
      if (res.status !== 200) assert.ok(['insufficient_funds', 'conflict'].includes(res.body.error.code), JSON.stringify(res.body));
    }
    assert.ok(succeeded >= 1 && succeeded <= 2, `succeeded: ${succeeded}`);
    const wallet = h.wallet('u1');
    assert.equal(wallet.heldMinor, succeeded * 40000);
    assert.equal(wallet.availableMinor + wallet.heldMinor, 100000);
    assertInvariants(h);
  }
});

test('withdrawals are rate limited after the PIN check', async () => {
  const h = createHarness({ relaxRateLimits: false, params: { DAILY_OUT_LIMIT_MINOR: '100000000' } });
  const u = await ready(h, 'u1', { funded: 0 });
  // Funding goes through the deposit limiter (10/h) so use direct seeding to keep this test about withdrawals.
  h.db.seed('wallets/u1', { ...h.wallet('u1'), availableMinor: 1000000, version: 1 });
  h.db.seed('wallets/u1/ledger/seed', {
    txId: 'SEED', type: 'deposit_credit', deltaAvailableMinor: 1000000, deltaHeldMinor: 0, balanceAvailableAfterMinor: 1000000,
    balanceHeldAfterMinor: 0, currency: 'PHP', seq: 1, createdAt: h.clock.now(),
  });
  for (let i = 0; i < 5; i += 1) ok(await withdraw(h, u, { amountMinor: 10000 }));
  const limited = await withdraw(h, u, { amountMinor: 10000 });
  assert.equal(limited.status, 429);
  fails(limited, 'resource_exhausted');
  // Wrong PINs are not rate limited by this bucket: they are handled (and locked) by the PIN counter itself.
  fails(await withdraw(h, u, { pin: '000001' }), 'pin_incorrect');
  h.clock.advance(3600 * 1000);
  ok(await withdraw(h, u, { amountMinor: 10000 }));
});

// ---------------------------------------------------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------------------------------------------------

test('a user can cancel a withdrawal that has not been approved', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  const { tx } = ok(await withdraw(h, u));
  later(h);
  const cancelled = ok(await h.call('POST', `/wallet/withdrawals/${tx.id}/cancel`, { token: u.token })).tx;
  assert.equal(cancelled.status, 'cancelled');
  const wallet = h.wallet('u1');
  assert.equal(wallet.availableMinor, 200000);
  assert.equal(wallet.heldMinor, 0);
  const release = ledger(h, 'u1').at(-1);
  assert.deepEqual([release.type, release.deltaAvailableMinor, release.deltaHeldMinor], ['withdrawal_release', 50000, -50000]);
  assert.equal(dailyOut(h, 'u1'), 0);
  assert.deepEqual(events(h, tx.id).map((e) => [e.to, e.by]), [['pending_review', 'user'], ['cancelled', 'user']]);
  assert.equal(h.notifications('u1').filter((n) => n.type === 'withdrawal_cancelled').length, 1);
  fails(await h.call('POST', `/wallet/withdrawals/${tx.id}/cancel`, { token: u.token }), 'invalid_state', { status: 'cancelled' });
  assert.equal(h.wallet('u1').availableMinor, 200000, 'a second cancel releases nothing');
  assertInvariants(h);
});

test('cancel is for the owner, for withdrawals, and only before approval', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice');
  const bob = await ready(h, 'bob');
  const a = await admin(h);
  const { tx } = ok(await withdraw(h, alice));
  const cancel = (user, id) => h.call('POST', `/wallet/withdrawals/${id}/cancel`, { token: user.token });
  fails(await cancel(bob, tx.id), 'not_found');
  fails(await cancel(alice, 'WDR-NOPE'), 'not_found');
  const deposit = h.db.list('walletTx').find((t) => t.data.kind === 'deposit' && t.data.ownerUid === 'alice');
  fails(await cancel(alice, deposit.id), 'not_found');
  ok(await act(h, a, tx.id, 'approve'));
  fails(await cancel(alice, tx.id), 'invalid_state', { status: 'approved' });
  assert.equal(h.wallet('alice').heldMinor, 50000);
  assertInvariants(h);
});

// ---------------------------------------------------------------------------------------------------------------------
// Review queue (admin)
// ---------------------------------------------------------------------------------------------------------------------

test('admin endpoints reject ordinary users and anonymous callers', async () => {
  const h = createHarness();
  const u = await ready(h, 'u1');
  const { tx } = ok(await withdraw(h, u));
  for (const [method, path, body] of [
    ['GET', '/admin/withdrawals'],
    ['POST', `/admin/withdrawals/${tx.id}/approve`, {}],
    ['POST', `/admin/withdrawals/${tx.id}/complete`, { payoutReference: 'REF-1234' }],
    ['POST', `/admin/transactions/${tx.id}/reverse`, { reason: 'because' }],
    ['GET', '/admin/reconcile'],
  ]) {
    const res = await h.call(method, path, { token: u.token, body });
    assert.equal(res.status, 403, path);
    fails(res, 'permission_denied');
    const anonymous = await h.call(method, path, { body });
    assert.equal(anonymous.status, 401, path);
  }
  assert.equal(h.tx(tx.id).status, 'pending_review');
});

test('the review queue shows payout details to admins only', async () => {
  const h = createHarness();
  const a = await admin(h);
  const alice = await ready(h, 'alice');
  const bob = await ready(h, 'bob');
  const first = ok(await withdraw(h, alice)).tx;
  later(h);
  const second = ok(await withdraw(h, bob, { amountMinor: 20000 })).tx;
  later(h);
  ok(await act(h, a, first.id, 'approve'));

  const all = ok(await h.call('GET', '/admin/withdrawals', { token: a.token })).items;
  assert.deepEqual(all.map((item) => item.tx.id), [second.id, first.id], 'newest first');
  assert.equal(all[0].userEmail, 'bob@example.com');
  assert.deepEqual(all[0].destination, { kind: 'ewallet', providerName: 'GCash', accountName: 'Juan Dela Cruz', accountNumber: '09171234567' });
  const pending = ok(await h.call('GET', '/admin/withdrawals', { token: a.token, query: { status: 'pending_review' } })).items;
  assert.deepEqual(pending.map((item) => item.tx.id), [second.id]);
  const approved = ok(await h.call('GET', '/admin/withdrawals', { token: a.token, query: { status: 'approved', limit: '1' } })).items;
  assert.deepEqual(approved.map((item) => item.tx.id), [first.id]);
  fails(await h.call('GET', '/admin/withdrawals', { token: a.token, query: { status: 'weird' } }), 'invalid_argument', { field: 'status' });
  for (const limit of ['0', '101', 'x', '1.5']) {
    fails(await h.call('GET', '/admin/withdrawals', { token: a.token, query: { limit } }), 'invalid_argument', { field: 'limit' });
  }

  // The transaction itself (what the app can read) never contains the account number.
  assert.ok(!JSON.stringify(h.db.read(`walletTx/${first.id}`)).includes('09171234567'));
});

test('approve -> complete pays out: held funds leave the wallet and the fee becomes platform revenue', async () => {
  const h = createHarness({ params: { WITHDRAW_FEE_FIXED_MINOR: '2500' } });
  const a = await admin(h);
  const u = await ready(h, 'u1', { funded: 100000 });
  const { tx } = ok(await withdraw(h, u, { amountMinor: 50000 }));
  assert.equal(tx.totalMinor, 52500);

  later(h);
  const approved = ok(await act(h, a, tx.id, 'approve')).tx;
  assert.equal(approved.status, 'approved');
  assert.equal(h.wallet('u1').heldMinor, 52500, 'still held while the payout is made');
  assert.equal(h.notifications('u1').filter((n) => n.type === 'withdrawal_approved').length, 1);

  later(h);
  const done = ok(await act(h, a, tx.id, 'complete', { payoutReference: 'GCASH-77821' })).tx;
  assert.equal(done.status, 'completed');
  assert.equal(done.payoutReference, 'GCASH-77821');
  assert.ok(done.completedAt);
  assert.equal(h.wallet('u1').heldMinor, 0);
  assert.equal(h.wallet('u1').availableMinor, 47500);
  assert.equal(h.revenue(), 2500);
  const settle = ledger(h, 'u1').at(-1);
  assert.deepEqual([settle.type, settle.deltaAvailableMinor, settle.deltaHeldMinor], ['withdrawal_settle', 0, -52500]);
  const [note] = h.notifications('u1').filter((n) => n.type === 'withdrawal_completed');
  assert.match(note.body, /GCASH-77821/);

  const trail = h.db.list('adminAudit').map((e) => e.data).sort((x, y) => x.createdAt - y.createdAt);
  assert.deepEqual(trail.map((e) => [e.action, e.adminUid, e.txId, e.targetUid]), [
    ['withdrawal_approve', 'admin1', tx.id, 'u1'],
    ['withdrawal_complete', 'admin1', tx.id, 'u1'],
  ]);
  assert.deepEqual(events(h, tx.id).map((e) => [e.to, e.by]), [['pending_review', 'user'], ['approved', 'admin'], ['completed', 'admin']]);
  assertInvariants(h);
});

test('reject and fail return the money and the daily allowance', async () => {
  const h = createHarness({ params: { WITHDRAW_FEE_FIXED_MINOR: '1000' } });
  const a = await admin(h);
  const u = await ready(h, 'u1', { funded: 200000 });
  const rejected = ok(await withdraw(h, u, { amountMinor: 50000 })).tx;
  const failed = ok(await withdraw(h, u, { amountMinor: 30000 })).tx;
  assert.equal(h.wallet('u1').heldMinor, 82000);
  assert.equal(dailyOut(h, 'u1'), 82000);

  fails(await act(h, a, rejected.id, 'reject', {}), 'invalid_argument', { field: 'reason' });
  fails(await act(h, a, rejected.id, 'reject', { reason: 'no' }), 'invalid_argument', { field: 'reason' });
  const r = ok(await act(h, a, rejected.id, 'reject', { reason: 'Name does not match the account' })).tx;
  assert.equal(r.status, 'rejected');
  assert.equal(r.failureReason, 'Name does not match the account');
  assert.equal(h.wallet('u1').heldMinor, 31000);
  assert.equal(h.wallet('u1').availableMinor, 169000);
  assert.equal(dailyOut(h, 'u1'), 31000);
  assert.match(h.notifications('u1').find((n) => n.type === 'withdrawal_rejected').body, /Name does not match the account/);

  fails(await act(h, a, failed.id, 'fail', { reason: 'Bank returned the payout' }), 'invalid_state', { status: 'pending_review' });
  ok(await act(h, a, failed.id, 'approve'));
  const f = ok(await act(h, a, failed.id, 'fail', { reason: 'Bank returned the payout' })).tx;
  assert.equal(f.status, 'failed');
  assert.equal(h.wallet('u1').heldMinor, 0);
  assert.equal(h.wallet('u1').availableMinor, 200000);
  assert.equal(dailyOut(h, 'u1'), 0);
  assert.equal(h.revenue(), 0, 'no fee is kept for a payout that did not happen');
  assert.equal(h.db.list('adminAudit').length, 3);
  assertInvariants(h);
});

test('the state machine only allows the documented moves', async () => {
  const h = createHarness();
  const a = await admin(h);
  const u = await ready(h, 'u1', { funded: 500000 });
  const make = async () => ok(await withdraw(h, u, { amountMinor: 10000 })).tx.id;
  const pending = await make();
  const approved = await make();
  ok(await act(h, a, approved, 'approve'));
  const completed = await make();
  ok(await act(h, a, completed, 'approve'));
  ok(await act(h, a, completed, 'complete', { payoutReference: 'REF-0001' }));
  const rejected = await make();
  ok(await act(h, a, rejected, 'reject', { reason: 'Not allowed' }));

  const bodies = { approve: {}, reject: { reason: 'Not allowed' }, fail: { reason: 'Failed' }, complete: { payoutReference: 'REF-0002' } };
  const allowed = {
    pending_review: ['approve', 'reject'],
    approved: ['complete', 'fail'],
    completed: [],
    rejected: [],
  };
  const byStatus = { pending_review: pending, approved, completed, rejected };
  for (const [status, id] of Object.entries(byStatus)) {
    for (const action of ['approve', 'reject', 'complete', 'fail']) {
      if (allowed[status].includes(action)) continue;
      const res = await act(h, a, id, action, bodies[action]);
      assert.equal(res.status, 409, `${action} on ${status}`);
      fails(res, 'invalid_state', { status });
    }
  }
  assert.equal(h.tx(pending).status, 'pending_review');
  assert.equal(h.tx(approved).status, 'approved');
  assertInvariants(h);
});

test('admin actions validate their input and their target', async () => {
  const h = createHarness();
  const a = await admin(h);
  const u = await ready(h, 'u1');
  const { tx } = ok(await withdraw(h, u));
  fails(await act(h, a, tx.id, 'approve', { reason: 'x' }), 'invalid_argument', { field: 'reason' });
  ok(await act(h, a, tx.id, 'approve'));
  fails(await act(h, a, tx.id, 'complete', {}), 'invalid_argument', { field: 'payoutReference' });
  fails(await act(h, a, tx.id, 'complete', { payoutReference: 'x' }), 'invalid_argument', { field: 'payoutReference' });
  fails(await act(h, a, tx.id, 'complete', { payoutReference: 'REF-1234', amountMinor: 1 }), 'invalid_argument', { field: 'amountMinor' });
  fails(await act(h, a, 'WDR-NOPE', 'approve'), 'not_found');
  const deposit = h.db.list('walletTx').find((t) => t.data.kind === 'deposit');
  fails(await act(h, a, deposit.id, 'approve'), 'not_found');
  assert.equal(h.tx(tx.id).status, 'approved');
});

test('racing admin decisions: exactly one wins and the money is only moved once', async () => {
  for (let round = 0; round < 4; round += 1) {
    const h = createHarness();
    const a = await admin(h);
    const u = await ready(h, 'u1', { funded: 100000 });
    const { tx } = ok(await withdraw(h, u));
    const results = await Promise.all([
      act(h, a, tx.id, 'approve'),
      act(h, a, tx.id, 'reject', { reason: 'Rejected by a second admin' }),
      h.call('POST', `/wallet/withdrawals/${tx.id}/cancel`, { token: u.token }),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)));
    for (const res of results) if (res.status !== 200) assert.ok(['invalid_state', 'conflict'].includes(res.body.error.code));
    const status = h.tx(tx.id).status;
    const wallet = h.wallet('u1');
    if (status === 'approved') assert.deepEqual([wallet.availableMinor, wallet.heldMinor], [50000, 50000]);
    else assert.deepEqual([wallet.availableMinor, wallet.heldMinor], [100000, 0], status);
    assertInvariants(h);
  }
  for (let round = 0; round < 4; round += 1) {
    const h = createHarness();
    const a = await admin(h);
    const u = await ready(h, 'u1', { funded: 100000 });
    const { tx } = ok(await withdraw(h, u));
    ok(await act(h, a, tx.id, 'approve'));
    const results = await Promise.all([
      act(h, a, tx.id, 'complete', { payoutReference: 'REF-AAAA' }),
      act(h, a, tx.id, 'fail', { reason: 'Provider says no' }),
      act(h, a, tx.id, 'complete', { payoutReference: 'REF-BBBB' }),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    const wallet = h.wallet('u1');
    if (h.tx(tx.id).status === 'completed') assert.deepEqual([wallet.availableMinor, wallet.heldMinor], [50000, 0]);
    else assert.deepEqual([wallet.availableMinor, wallet.heldMinor], [100000, 0]);
    assertInvariants(h);
  }
});

test('wallet notifications switched off still allow every withdrawal step', async () => {
  const h = createHarness();
  const a = await admin(h);
  const u = await ready(h, 'u1');
  const doc = h.db.read('users/u1');
  doc.preferences.notifications.wallet = false;
  h.db.seed('users/u1', doc);
  const before = h.notifications('u1').length;
  const { tx } = ok(await withdraw(h, u));
  ok(await act(h, a, tx.id, 'approve'));
  ok(await act(h, a, tx.id, 'complete', { payoutReference: 'REF-0001' }));
  assert.equal(h.notifications('u1').length, before);
  assert.equal(h.tx(tx.id).status, 'completed');
  assertInvariants(h);
});
