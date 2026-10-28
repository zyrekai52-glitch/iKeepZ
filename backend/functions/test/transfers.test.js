'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ok, fails } = require('./helpers/harness');
const { assertInvariants } = require('./helpers/invariants');

const PIN = '135790';

async function ready(h, uid, { funded = 0, displayName } = {}) {
  const user = await h.signup(uid, displayName ? { displayName } : {});
  await h.setPin(user, PIN);
  if (funded) await h.fund(user, funded);
  return { ...user, pin: PIN, code: h.wallet(uid).walletCode };
}

function send(h, from, to, body = {}) {
  return h.call('POST', '/wallet/transfers', {
    token: from.token,
    body: { walletCode: to.code, amountMinor: 30000, pin: from.pin, idempotencyKey: h.key(), ...body },
  });
}

const lookup = (h, user, walletCode) => h.call('POST', '/wallet/transfers/lookup', { token: user.token, body: { walletCode } });
const ledger = (h, uid) => h.db.list(`wallets/${uid}/ledger`).map((e) => e.data).sort((x, y) => x.seq - y.seq);
const dailyOut = (h, uid) => h.db.list('walletDaily').filter((d) => d.id.startsWith(`${uid}_`)).reduce((sum, d) => sum + d.data.outMinor, 0);

test('lookup shows only a masked name and the currency', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice');
  const bob = await ready(h, 'bob', { displayName: 'Roberto Villanueva' });
  const res = ok(await lookup(h, alice, bob.code));
  assert.deepEqual(res, { walletCode: bob.code, displayName: 'Roberto V.', currency: 'PHP' });

  // Codes are forgiving about case, spaces and dashes.
  for (const variant of [bob.code.toLowerCase(), bob.code.replace(/-/g, ' '), bob.code.replace(/-/g, '').toLowerCase(), `  ${bob.code}  `]) {
    assert.equal(ok(await lookup(h, alice, variant)).walletCode, bob.code, variant);
  }
});

test('lookup answers "not found" identically for unknown codes, your own code, and unusable wallets', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice');
  const bob = await ready(h, 'bob');
  const carol = await ready(h, 'carol');
  h.db.seed('users/carol', { ...h.db.read('users/carol'), status: 'suspended' });
  const dave = await ready(h, 'dave');
  h.db.seed('wallets/dave', { ...h.wallet('dave'), status: 'frozen' });

  const messages = new Set();
  for (const code of ['IKZ-AAAA-BBBB', alice.code, carol.code, dave.code]) {
    const res = await lookup(h, alice, code);
    assert.equal(res.status, 404, code);
    messages.add(fails(res, 'not_found').message);
  }
  assert.equal(messages.size, 1, 'the responses cannot be told apart');
  ok(await lookup(h, alice, bob.code));

  for (const bad of ['', 'x', 'IKZ-1234', 'ABC-DEFG-HJKM', 'IKZ-0O1I-LLLL', 12345, null]) {
    const res = await lookup(h, alice, bad);
    assert.equal(res.body.error.code, 'invalid_argument', String(bad));
  }
});

test('lookups are rate limited so wallet codes cannot be enumerated', async () => {
  const h = createHarness({ relaxRateLimits: false });
  const alice = await ready(h, 'alice');
  for (let i = 0; i < 20; i += 1) assert.equal((await lookup(h, alice, 'IKZ-AAAA-BBBB')).status, 404);
  const blocked = await lookup(h, alice, 'IKZ-AAAA-BBBB');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.body.error.details.retryAfterSeconds > 0);
  h.clock.advance(10 * 60 * 1000);
  assert.equal((await lookup(h, alice, 'IKZ-AAAA-BBBB')).status, 404);
});

test('a transfer moves money atomically, with matching ledger entries and notifications on both sides', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000, displayName: 'Alice Santos' });
  const bob = await ready(h, 'bob', { displayName: 'Bob Reyes' });
  const { tx } = ok(await send(h, alice, bob, { amountMinor: 30000, note: '  Rent   share\n' }));

  assert.equal(tx.kind, 'transfer');
  assert.equal(tx.status, 'completed');
  assert.equal(tx.amountMinor, 30000);
  assert.equal(tx.feeMinor, 0);
  assert.equal(tx.totalMinor, 30000);
  assert.equal(tx.ownerUid, 'alice');
  assert.equal(tx.counterpartyUid, 'bob');
  assert.deepEqual(tx.participants, ['alice', 'bob']);
  assert.deepEqual(tx.directions, { alice: 'debit', bob: 'credit' });
  assert.equal(tx.ownerDisplay, 'Alice S.');
  assert.equal(tx.counterpartyDisplay, 'Bob R.');
  assert.equal(tx.note, 'Rent share');
  assert.ok(tx.completedAt);

  assert.equal(h.wallet('alice').availableMinor, 70000);
  assert.equal(h.wallet('bob').availableMinor, 30000);
  const out = ledger(h, 'alice').at(-1);
  const into = ledger(h, 'bob').at(-1);
  assert.deepEqual([out.type, out.txId, out.deltaAvailableMinor, out.balanceAvailableAfterMinor], ['transfer_out', tx.id, -30000, 70000]);
  assert.deepEqual([into.type, into.txId, into.deltaAvailableMinor, into.balanceAvailableAfterMinor], ['transfer_in', tx.id, 30000, 30000]);

  const sent = h.notifications('alice').find((n) => n.type === 'transfer_sent');
  const received = h.notifications('bob').find((n) => n.type === 'transfer_received');
  assert.match(sent.body, /You sent PHP 300\.00 to Bob R\./);
  assert.match(received.body, /Alice S\. sent you PHP 300\.00/);
  assert.equal(h.db.list('users/alice/activity').filter((a) => a.data.type === 'transfer_sent').length, 1);
  assert.equal(h.db.list('users/bob/activity').filter((a) => a.data.type === 'transfer_received').length, 1);
  assert.equal(dailyOut(h, 'alice'), 30000);
  assert.equal(dailyOut(h, 'bob'), 0);
  assertInvariants(h);
});

test('the sender pays the fee on top, the recipient gets the full amount, the platform keeps the fee', async () => {
  const h = createHarness({ params: { TRANSFER_FEE_BPS: '100', TRANSFER_FEE_FIXED_MINOR: '100' } });
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const { tx } = ok(await send(h, alice, bob, { amountMinor: 30000 }));
  assert.equal(tx.feeMinor, 400);
  assert.equal(tx.totalMinor, 30400);
  assert.equal(h.wallet('alice').availableMinor, 69600);
  assert.equal(h.wallet('bob').availableMinor, 30000);
  assert.equal(h.revenue(), 400);
  assertInvariants(h);
});

test('a transfer can use the entire balance but never more', async () => {
  const h = createHarness({ params: { TRANSFER_FEE_FIXED_MINOR: '100' } });
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const short = await send(h, alice, bob, { amountMinor: 100000 }); // needs 100100
  fails(short, 'insufficient_funds', { availableMinor: 100000, neededMinor: 100100 });
  assert.equal(h.wallet('bob').availableMinor, 0);
  assert.equal(h.notifications('bob').filter((n) => n.type === 'transfer_received').length, 0);
  ok(await send(h, alice, bob, { amountMinor: 99900 }));
  assert.equal(h.wallet('alice').availableMinor, 0);
  assert.equal(h.wallet('bob').availableMinor, 99900);
  assertInvariants(h);
});

test('transfer input is validated', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  for (const amountMinor of [0, -5, 1.5, '300', null, 10 ** 13 + 1]) {
    fails(await send(h, alice, bob, { amountMinor }), 'invalid_argument', { field: 'amountMinor' });
  }
  for (const pin of ['12345', 'abcdef', 135790, undefined]) {
    fails(await send(h, alice, bob, { pin }), 'invalid_argument', { field: 'pin' });
  }
  fails(await send(h, alice, bob, { walletCode: 'nope' }), 'invalid_argument', { field: 'walletCode' });
  fails(await send(h, alice, bob, { note: 'x'.repeat(141) }), 'invalid_argument', { field: 'note' });
  fails(await send(h, alice, bob, { note: 12 }), 'invalid_argument', { field: 'note' });
  fails(await send(h, alice, bob, { idempotencyKey: 'tiny' }), 'invalid_argument', { field: 'idempotencyKey' });
  fails(await send(h, alice, bob, { toUid: 'bob' }), 'invalid_argument', { field: 'toUid' });
  assert.equal(h.wallet('alice').availableMinor, 100000);
  const noNote = ok(await send(h, alice, bob, { note: null })).tx;
  assert.equal(noNote.note, null);
  assert.equal(ok(await send(h, alice, bob, { note: '   ' })).tx.note, null);
});

test('transfer amount limits', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 1000000 });
  const bob = await ready(h, 'bob');
  fails(await send(h, alice, bob, { amountMinor: 99 }), 'limit_exceeded', { reason: 'below_min' });
  fails(await send(h, alice, bob, { amountMinor: 5000001 }), 'limit_exceeded', { reason: 'above_max' });
  ok(await send(h, alice, bob, { amountMinor: 100 }));
});

test('you cannot send to yourself, to strangers, or to wallets that are not usable', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  fails(await send(h, alice, alice), 'not_found');
  fails(await send(h, alice, { code: 'IKZ-AAAA-BBBB' }), 'not_found');
  h.db.seed('users/bob', { ...h.db.read('users/bob'), status: 'suspended' });
  fails(await send(h, alice, bob), 'not_found');
  h.db.seed('users/bob', { ...h.db.read('users/bob'), status: 'active' });
  h.db.seed('wallets/bob', { ...h.wallet('bob'), status: 'frozen' });
  fails(await send(h, alice, bob), 'not_found');
  h.db.seed('wallets/bob', { ...h.wallet('bob'), status: 'active' });
  assert.equal(h.wallet('alice').availableMinor, 100000);
  ok(await send(h, alice, bob));
  assertInvariants(h);
});

test('the sender must be allowed to transfer', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  h.db.seed('users/alice', { ...h.db.read('users/alice'), transfersEnabled: false });
  fails(await send(h, alice, bob), 'feature_disabled');
  h.db.seed('users/alice', { ...h.db.read('users/alice'), transfersEnabled: true, status: 'suspended' });
  fails(await send(h, alice, bob), 'account_suspended');
  h.db.seed('users/alice', { ...h.db.read('users/alice'), status: 'active' });
  const unverified = await h.signup('eve', { emailVerified: false, bootstrap: false });
  fails(await h.call('POST', '/wallet/transfers', { token: unverified.token, body: { walletCode: bob.code, amountMinor: 1000, pin: PIN, idempotencyKey: h.key() } }), 'email_not_verified');
  ok(await send(h, alice, bob));
});

test('wallets in different currencies cannot exchange money', async () => {
  const h = createHarness({ params: { WALLET_CURRENCIES: 'PHP,USD' } });
  const alice = await ready(h, 'alice', { funded: 100000 });
  const usd = await h.signup('usd', { bootstrap: false });
  ok(await h.call('POST', '/bootstrap', { token: usd.token, body: { currency: 'USD' } }));
  const target = { code: h.wallet('usd').walletCode };
  assert.equal(ok(await lookup(h, alice, target.code)).currency, 'USD');
  fails(await send(h, alice, target), 'invalid_state', { reason: 'currency_mismatch' });
  assert.equal(h.wallet('alice').availableMinor, 100000);
  assert.equal(h.wallet('usd').availableMinor, 0);
  fails(await h.call('POST', '/bootstrap', { token: (await h.signup('jpy', { bootstrap: false })).token, body: { currency: 'JPY' } }), 'invalid_argument', { field: 'currency' });
});

test('the PIN is verified on the server for every transfer', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const nopin = await h.signup('nopin');
  await h.fund(nopin, 50000);
  fails(await send(h, { ...nopin, pin: PIN }, bob), 'pin_required');

  const wrong = fails(await send(h, alice, bob, { pin: '000001' }), 'pin_incorrect');
  assert.equal(wrong.details.attemptsRemaining, 4);
  assert.equal(h.wallet('alice').availableMinor, 100000);
  for (let i = 0; i < 4; i += 1) await send(h, alice, bob, { pin: '000001' });
  assert.equal((await send(h, alice, bob)).status, 423, 'locked even for the right PIN');
  assert.equal(h.wallet('bob').availableMinor, 0);
  h.clock.advance(16 * 60 * 1000);
  ok(await send(h, alice, bob));
  assertInvariants(h);
});

test('a bad wallet code does not cost a PIN attempt', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  fails(await send(h, alice, { code: 'IKZ-AAAA-BBBB' }, { pin: '000001' }), 'not_found');
  assert.equal(h.db.read('walletSecurity/alice').failedAttempts, 0);
});

test('transfers and withdrawals share one daily outgoing limit', async () => {
  const h = createHarness({ params: { DAILY_OUT_LIMIT_MINOR: '100000' } });
  const alice = await ready(h, 'alice', { funded: 400000 });
  const bob = await ready(h, 'bob');
  alice.destination = await h.addDestination(alice);
  ok(await h.call('POST', '/wallet/withdrawals', { token: alice.token, body: { destinationId: alice.destination.id, amountMinor: 50000, pin: PIN, idempotencyKey: h.key() } }));
  ok(await send(h, alice, bob, { amountMinor: 50000 }));
  fails(await send(h, alice, bob, { amountMinor: 100 }), 'limit_exceeded', { reason: 'daily_limit', remainingMinor: 0 });
  assert.equal(h.wallet('bob').availableMinor, 50000);
  h.clock.advance(15 * 3600 * 1000);
  ok(await send(h, alice, bob, { amountMinor: 100000 }));
  // Receiving money is never limited by the daily outgoing limit.
  const back = await send(h, bob, alice, { amountMinor: 100000 });
  ok(back);
  assertInvariants(h);
});

test('the same idempotency key never moves money twice', async () => {
  const h = createHarness({ params: { TRANSFER_FEE_FIXED_MINOR: '100' } });
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const carol = await ready(h, 'carol');
  const key = h.key();
  const first = ok(await send(h, alice, bob, { idempotencyKey: key })).tx;
  const again = ok(await send(h, alice, bob, { idempotencyKey: key })).tx;
  assert.equal(again.id, first.id);
  assert.equal(h.wallet('alice').availableMinor, 100000 - 30100);
  assert.equal(h.wallet('bob').availableMinor, 30000);
  assert.equal(h.revenue(), 100);
  assert.equal(h.notifications('bob').filter((n) => n.type === 'transfer_received').length, 1);

  fails(await send(h, alice, bob, { idempotencyKey: key, amountMinor: 30001 }), 'idempotency_conflict');
  fails(await send(h, alice, carol, { idempotencyKey: key }), 'idempotency_conflict');
  fails(await send(h, alice, bob, { idempotencyKey: key, note: 'different' }), 'idempotency_conflict');
  assert.equal(h.db.list('walletTx').filter((t) => t.data.kind === 'transfer').length, 1);
  assertInvariants(h);
});

test('parallel transfers with one key move the money once', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const key = h.key();
  const results = await Promise.all(Array.from({ length: 5 }, () => send(h, alice, bob, { idempotencyKey: key })));
  const ids = new Set();
  for (const res of results) {
    if (res.status === 200) ids.add(res.body.data.tx.id);
    else fails(res, 'conflict');
  }
  assert.equal(ids.size, 1);
  assert.equal(h.wallet('bob').availableMinor, 30000);
  assertInvariants(h);
});

test('parallel transfers can never overdraw the sender', async () => {
  for (let round = 0; round < 5; round += 1) {
    const h = createHarness();
    const alice = await ready(h, 'alice', { funded: 100000 });
    const bob = await ready(h, 'bob');
    const results = await Promise.all(Array.from({ length: 8 }, () => send(h, alice, bob, { amountMinor: 30000 })));
    const succeeded = results.filter((r) => r.status === 200).length;
    for (const res of results) if (res.status !== 200) assert.ok(['insufficient_funds', 'conflict'].includes(res.body.error.code), JSON.stringify(res.body));
    assert.ok(succeeded >= 1 && succeeded <= 3, `succeeded ${succeeded}`);
    assert.equal(h.wallet('alice').availableMinor, 100000 - succeeded * 30000);
    assert.equal(h.wallet('bob').availableMinor, succeeded * 30000);
    assertInvariants(h);
  }
});

test('opposite transfers at the same time both complete without deadlock or loss', async () => {
  for (let round = 0; round < 5; round += 1) {
    const h = createHarness({ params: { TRANSFER_FEE_FIXED_MINOR: '50' } });
    const alice = await ready(h, 'alice', { funded: 100000 });
    const bob = await ready(h, 'bob', { funded: 100000 });
    const results = await Promise.all([
      send(h, alice, bob, { amountMinor: 20000 }),
      send(h, bob, alice, { amountMinor: 10000 }),
      send(h, alice, bob, { amountMinor: 5000 }),
      send(h, bob, alice, { amountMinor: 7000 }),
    ]);
    const done = results.filter((r) => r.status === 200).map((r) => r.body.data.tx);
    for (const res of results) if (res.status !== 200) fails(res, 'conflict');
    assert.ok(done.length >= 2);
    const total = h.wallet('alice').availableMinor + h.wallet('bob').availableMinor + h.revenue();
    assert.equal(total, 200000);
    assert.equal(h.revenue(), done.length * 50);
    assertInvariants(h);
  }
});

test('transfers are rate limited', async () => {
  const h = createHarness({ relaxRateLimits: false, params: { DAILY_OUT_LIMIT_MINOR: '1000000000' } });
  const alice = await ready(h, 'alice', { funded: 0 });
  const bob = await ready(h, 'bob');
  h.db.seed('wallets/alice', { ...h.wallet('alice'), availableMinor: 1000000, version: 1 });
  for (let i = 0; i < 20; i += 1) ok(await send(h, alice, bob, { amountMinor: 100 }));
  const blocked = await send(h, alice, bob, { amountMinor: 100 });
  assert.equal(blocked.status, 429);
  fails(blocked, 'resource_exhausted');
  h.clock.advance(3600 * 1000);
  ok(await send(h, alice, bob, { amountMinor: 100 }));
});

test('the recipient\'s notification preference is respected, the sender still gets theirs', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const doc = h.db.read('users/bob');
  doc.preferences.notifications.wallet = false;
  h.db.seed('users/bob', doc);
  ok(await send(h, alice, bob));
  assert.equal(h.notifications('bob').filter((n) => n.type === 'transfer_received').length, 0);
  assert.equal(h.notifications('alice').filter((n) => n.type === 'transfer_sent').length, 1);
  assert.equal(h.wallet('bob').availableMinor, 30000);
});

test('balances are capped at the maximum wallet size', async () => {
  const h = createHarness();
  const alice = await ready(h, 'alice', { funded: 100000 });
  const bob = await ready(h, 'bob');
  const ledgerDoc = { txId: 'SEED', type: 'deposit_credit', deltaAvailableMinor: 10 ** 13 - 10000, deltaHeldMinor: 0, balanceAvailableAfterMinor: 10 ** 13 - 10000, balanceHeldAfterMinor: 0, currency: 'PHP', seq: 1, createdAt: h.clock.now() };
  h.db.seed('wallets/bob', { ...h.wallet('bob'), availableMinor: 10 ** 13 - 10000, version: 1 });
  h.db.seed('wallets/bob/ledger/seed', ledgerDoc);
  const res = await send(h, alice, bob, { amountMinor: 10001 });
  fails(res, 'limit_exceeded', { reason: 'wallet_limit' });
  assert.equal(h.wallet('alice').availableMinor, 100000, 'the sender is not debited');
  ok(await send(h, alice, bob, { amountMinor: 10000 }));
});
