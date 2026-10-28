'use strict';

// Randomised end-to-end test: thousands of API calls (some of them concurrent, many of them invalid) against the real
// handlers and an in-memory Firestore, with the ledger invariants checked after every batch. The PRNG is seeded, so a
// failing seed is printed together with the operations that led to it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/harness');
const { assertInvariants } = require('./helpers/invariants');
const { STATUS } = require('../src/errors');
const { reconcilePendingDeposits } = require('../src/scheduled/reconcile');

const PIN = '135790';
// STRESS_SEEDS=200 npm test -- runs a much longer soak (not needed for the default run).
const EXTRA = Number.parseInt(process.env.STRESS_SEEDS || '0', 10);
const SEEDS = EXTRA > 0 ? Array.from({ length: EXTRA }, (_, i) => i + 1) : [1, 2, 3, 7, 11, 42, 97, 2026];
const BATCHES = 70;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runSeed(seed, counters) {
  const rng = mulberry32(seed);
  const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const chance = (p) => rng() < p;
  const pick = (items) => items[int(0, items.length - 1)];
  const trace = [];
  const note = (text) => {
    trace.push(text);
    if (trace.length > 60) trace.shift();
  };

  const h = createHarness({
    params: { DEPOSIT_FEE_BPS: '150', WITHDRAW_FEE_FIXED_MINOR: '500', TRANSFER_FEE_BPS: '50', TRANSFER_FEE_FIXED_MINOR: '25', DAILY_OUT_LIMIT_MINOR: '250000' },
  });
  const internal = [];
  async function api(method, path, options) {
    const res = await h.call(method, path, options);
    if (res.status === 500) internal.push({ method, path, body: res.body });
    if (res.body.error) assert.ok(Object.hasOwn(STATUS, res.body.error.code), `undocumented error ${JSON.stringify(res.body)}`);
    const label = res.status === 200 ? 'ok' : res.body.error.code;
    const key = `${method} ${path.replace(/[A-Z]{3}-[0-9A-Z]+/g, ':id').replace(/\/[A-Za-z0-9]{20}$/, '/:id')} ${label}`;
    counters[key] = (counters[key] || 0) + 1;
    return res;
  }

  const admin = await h.signup('admin', { admin: true, bootstrap: false });
  const users = [];
  for (let i = 0; i < 4; i += 1) {
    const user = await h.signup(`u${i}`, { displayName: `User ${i} Tester` });
    await h.setPin(user, PIN);
    user.pin = PIN;
    user.code = h.wallet(user.uid).walletCode;
    user.destination = await h.addDestination(user, { accountNumber: `0917000000${i}` });
    users.push(user);
  }
  await h.fund(users[0], 300000);
  await h.fund(users[1], 150000);

  const txs = (predicate) => h.db.list('walletTx').filter((t) => predicate(t.data)).map((t) => ({ id: t.id, ...t.data }));

  const OPS = {
    async deposit() {
      const user = pick(users);
      const amountMinor = int(100, 2000) * 100;
      const body = { amountMinor, idempotencyKey: h.key() };
      const created = await api('POST', '/wallet/deposits', { token: user.token, body });
      note(`deposit ${user.uid} ${amountMinor} -> ${created.status}`);
      if (created.status !== 200) return;
      if (chance(0.2)) {
        const again = await api('POST', '/wallet/deposits', { token: user.token, body });
        if (again.status === 200) assert.equal(again.body.data.tx.id, created.body.data.tx.id, 'replay must return the same deposit');
      }
      if (chance(0.15)) {
        const changed = await api('POST', '/wallet/deposits', { token: user.token, body: { ...body, amountMinor: amountMinor + 100 } });
        assert.equal(changed.body.error && changed.body.error.code, 'idempotency_conflict');
      }
      const id = created.body.data.tx.id;
      const ref = h.db.read(`walletTx/${id}`).providerRef;
      const outcome = rng();
      if (outcome < 0.4) {
        h.provider.pay(ref);
        await api('POST', `/wallet/deposits/${id}/sync`, { token: user.token });
      } else if (outcome < 0.6) {
        h.provider.pay(ref);
        await api('POST', '/webhooks/paymongo', h.provider.webhookFor(ref, { eventId: `evt_${seed}_${trace.length}_${int(0, 1e9)}` }));
      } else if (outcome < 0.7) {
        h.provider.pay(ref, { amountMinor: amountMinor - 1 });
        await api('POST', `/wallet/deposits/${id}/sync`, { token: user.token });
      } else if (outcome < 0.8) {
        await api('POST', `/wallet/deposits/${id}/cancel`, { token: user.token });
      } else if (outcome < 0.9) {
        h.provider.expire(ref);
        await api('POST', `/wallet/deposits/${id}/sync`, { token: user.token });
      }
    },

    async withdraw() {
      const user = pick(users);
      const body = {
        destinationId: user.destination.id,
        amountMinor: int(100, 900) * 100,
        pin: chance(0.1) ? '000001' : user.pin,
        idempotencyKey: h.key(),
      };
      const res = await api('POST', '/wallet/withdrawals', { token: user.token, body });
      note(`withdraw ${user.uid} ${body.amountMinor} -> ${res.status}`);
      if (res.status === 200 && chance(0.2)) {
        const again = await api('POST', '/wallet/withdrawals', { token: user.token, body });
        if (again.status === 200) assert.equal(again.body.data.tx.id, res.body.data.tx.id);
      }
      if (res.status === 200 && chance(0.15)) {
        const changed = await api('POST', '/wallet/withdrawals', { token: user.token, body: { ...body, amountMinor: body.amountMinor + 100 } });
        assert.equal(changed.body.error && changed.body.error.code, 'idempotency_conflict');
      }
    },

    async transfer() {
      const from = pick(users);
      const to = chance(0.05) ? from : pick(users);
      const body = { walletCode: to.code, amountMinor: int(1, 600) * 100, pin: chance(0.05) ? '000001' : from.pin, idempotencyKey: h.key() };
      if (chance(0.3)) body.note = 'lunch';
      const res = await api('POST', '/wallet/transfers', { token: from.token, body });
      note(`transfer ${from.uid}->${to.uid} ${body.amountMinor} -> ${res.status}`);
      if (res.status === 200 && chance(0.2)) {
        const again = await api('POST', '/wallet/transfers', { token: from.token, body });
        if (again.status === 200) assert.equal(again.body.data.tx.id, res.body.data.tx.id);
      }
      if (res.status === 200 && chance(0.15)) {
        const changed = await api('POST', '/wallet/transfers', { token: from.token, body: { ...body, amountMinor: body.amountMinor + 100 } });
        assert.equal(changed.body.error && changed.body.error.code, 'idempotency_conflict');
      }
    },

    async adminStep() {
      const open = txs((t) => t.kind === 'withdrawal');
      if (open.length === 0) return;
      const target = pick(open);
      // Mostly legal moves (so the money really flows through every state), sometimes nonsense.
      const legal = { pending_review: ['approve', 'approve', 'approve', 'reject'], approved: ['complete', 'complete', 'complete', 'fail'] }[target.status];
      const action = legal && chance(0.85) ? pick(legal) : pick(['approve', 'complete', 'reject', 'fail']);
      const body = { approve: {}, complete: { payoutReference: `REF-${int(1000, 9999)}` }, reject: { reason: 'Not acceptable' }, fail: { reason: 'Bank said no' } }[action];
      const res = await api('POST', `/admin/withdrawals/${target.id}/${action}`, { token: admin.token, body });
      note(`admin ${action} ${target.id} (${target.status}) -> ${res.status}`);
    },

    async userCancel() {
      const open = txs((t) => t.kind === 'withdrawal' && t.status === 'pending_review');
      if (open.length === 0) return;
      const target = pick(open);
      const owner = users.find((u) => u.uid === target.ownerUid);
      const res = await api('POST', `/wallet/withdrawals/${target.id}/cancel`, { token: owner.token });
      note(`cancel ${target.id} -> ${res.status}`);
    },

    async reverse() {
      const candidates = txs((t) => (t.kind === 'deposit' || t.kind === 'transfer') && t.status === 'completed');
      if (candidates.length === 0) return;
      const target = pick(candidates);
      const res = await api('POST', `/admin/transactions/${target.id}/reverse`, { token: admin.token, body: { reason: 'Randomised reversal' } });
      note(`reverse ${target.id} -> ${res.status}`);
    },

    async destinations() {
      const user = pick(users);
      if (chance(0.5)) {
        const res = await api('POST', '/wallet/destinations', {
          token: user.token,
          body: { kind: 'bank', providerName: 'BDO', accountName: 'Test User', accountNumber: `00${int(1000000, 9999999)}` },
        });
        if (res.status === 200 && chance(0.6)) {
          await api('DELETE', `/wallet/destinations/${res.body.data.destination.id}`, { token: user.token });
        }
      } else {
        await api('DELETE', `/wallet/destinations/${pick(['x'.repeat(20), user.destination.id])}`, { token: user.token });
      }
      // The first destination may have been removed: keep a usable one around.
      const current = h.db.read(`users/${user.uid}/destinations/${user.destination.id}`);
      if (!current || current.status !== 'active') user.destination = await h.addDestination(user, { accountNumber: `0917${int(1000000, 9999999)}` });
    },

    async quote() {
      const user = pick(users);
      await api('POST', '/wallet/quote', { token: user.token, body: { kind: pick(['deposit', 'withdrawal', 'transfer']), amountMinor: int(1, 100000) } });
    },

    async scheduler() {
      await reconcilePendingDeposits(h.deps);
    },

    async tick() {
      h.clock.advance(int(0, 4) * 60 * 60 * 1000 + int(0, 59) * 60 * 1000);
    },

    async glitch() {
      // The provider is briefly unreachable for whatever happens next.
      h.provider.failFetch = true;
      const user = pick(users);
      const pending = txs((t) => t.kind === 'deposit' && t.status === 'pending' && t.ownerUid === user.uid);
      if (pending.length > 0) await api('POST', `/wallet/deposits/${pick(pending).id}/sync`, { token: user.token });
      h.provider.failFetch = false;
    },
  };
  const WEIGHTED = [
    ...Array(6).fill('deposit'),
    ...Array(6).fill('withdraw'),
    ...Array(6).fill('transfer'),
    ...Array(5).fill('adminStep'),
    ...Array(2).fill('userCancel'),
    ...Array(2).fill('reverse'),
    'destinations',
    'quote',
    'scheduler',
    ...Array(2).fill('tick'),
    'glitch',
  ];

  for (let batch = 0; batch < BATCHES; batch += 1) {
    const size = chance(0.35) ? int(2, 4) : 1;
    const names = Array.from({ length: size }, () => pick(WEIGHTED));
    note(`-- batch ${batch}: ${names.join(', ')}`);
    await Promise.all(names.map((name) => OPS[name]()));
    try {
      assertInvariants(h);
    } catch (error) {
      error.message = `seed ${seed}, batch ${batch}: ${error.message}\nrecent operations:\n  ${trace.join('\n  ')}`;
      throw error;
    }
  }

  // Wind everything down: settle every deposit and let the server's own reconciliation agree with the books.
  h.clock.advance(3 * 24 * 3600 * 1000);
  await reconcilePendingDeposits(h.deps);
  assertInvariants(h);
  const report = await api('GET', '/admin/reconcile', { token: admin.token, query: { limit: '500' } });
  assert.equal(report.status, 200);
  assert.deepEqual(report.body.data.mismatches, [], `seed ${seed}: reconcile found mismatches`);
  assert.deepEqual(internal, [], `seed ${seed}: unexpected 500s`);
  // Provider outages (the `glitch` operation) are logged by the scheduler on purpose; anything else would be a bug.
  assert.deepEqual(h.unexpectedErrors().filter((e) => !/contention|"provider_error"/i.test(JSON.stringify(e))), [], `seed ${seed}: logged errors`);
  return h;
}

test('random operations never break the ledger', { timeout: 590000 }, async () => {
  const counters = {};
  for (const seed of SEEDS) await runSeed(seed, counters);

  // The run must actually have exercised the interesting paths.
  const happened = (prefix) => Object.entries(counters).filter(([key]) => key.startsWith(prefix) && key.endsWith(' ok')).reduce((sum, [, n]) => sum + n, 0);
  assert.ok(happened('POST /wallet/deposits ') > 40, 'deposits created');
  assert.ok(happened('POST /wallet/deposits/:id/sync') > 10, 'deposits settled');
  assert.ok(happened('POST /wallet/withdrawals ') > 40, 'withdrawals created');
  assert.ok(happened('POST /admin/withdrawals/:id/complete') > 5, 'withdrawals completed');
  assert.ok(happened('POST /admin/withdrawals/:id/reject') + happened('POST /admin/withdrawals/:id/fail') > 3, 'withdrawals returned');
  assert.ok(happened('POST /wallet/transfers ') > 60, 'transfers made');
  assert.ok(happened('POST /admin/transactions/:id/reverse') > 3, 'reversals made');
  for (const needle of ['insufficient_funds', 'pin_incorrect', 'limit_exceeded', 'invalid_state', 'idempotency_conflict', 'not_found']) {
    assert.ok(Object.keys(counters).some((key) => key.endsWith(` ${needle}`)), `never saw ${needle}`);
  }
});
