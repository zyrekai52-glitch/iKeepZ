'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ok, fails } = require('./helpers/harness');
const { WALLET_CODE_PATTERN } = require('../src/util');
const { DEFAULT_CATEGORIES } = require('../src/handlers/bootstrap');

test('GET /health needs no sign-in and reports capabilities', async () => {
  const h = createHarness({ params: { DEPOSIT_FEE_BPS: '250', REQUIRE_KYC_FOR_WITHDRAWAL: 'true' } });
  const data = ok(await h.call('GET', '/health'));
  assert.equal(data.ok, true);
  assert.equal(data.version, '1.0.0');
  assert.equal(data.time, '2026-03-10T02:00:00.000Z');
  assert.equal(data.capabilities.deposits, true);
  assert.equal(data.capabilities.provider, 'paymongo');
  assert.deepEqual(data.capabilities.walletCurrencies, ['PHP']);
  assert.equal(data.capabilities.limits.depositMin, 10000);
  assert.equal(data.capabilities.limits.dailyOut, 10000000);
  assert.deepEqual(data.capabilities.fees.deposit, { bps: 250, fixedMinor: 0 });
  assert.equal(data.capabilities.requireKyc, true);
});

test('health says deposits are unavailable without a provider, with an unconfigured one, or without a return URL', async () => {
  const none = createHarness({ provider: false });
  assert.equal(ok(await none.call('GET', '/health')).capabilities.deposits, false);
  assert.equal(ok(await none.call('GET', '/health')).capabilities.provider, null);

  const unconfigured = createHarness();
  unconfigured.provider.configured = false;
  assert.equal(ok(await unconfigured.call('GET', '/health')).capabilities.deposits, false);

  const noUrl = createHarness({ params: { PUBLIC_RETURN_URL: '' } });
  assert.equal(ok(await noUrl.call('GET', '/health')).capabilities.deposits, false);
  assert.equal(ok(await noUrl.call('GET', '/health')).capabilities.withdrawals, true);
});

test('routing: /api prefix, trailing slash, unknown paths and wrong methods', async () => {
  const h = createHarness();
  ok(await h.call('GET', '/api/health'));
  ok(await h.call('GET', '/health/'));
  ok(await h.call('GET', '/api/health?x=1'));
  fails(await h.call('GET', '/nope'), 'not_found');
  fails(await h.call('POST', '/health'), 'not_found');
  fails(await h.call('GET', '/wallet/deposits'), 'not_found');
  fails(await h.call('OPTIONS', '/health'), 'not_found');
});

test('authentication: missing, malformed, unknown and revoked tokens are all 401', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  fails(await h.call('POST', '/bootstrap', {}), 'unauthenticated');
  fails(await h.call('POST', '/bootstrap', { headers: { authorization: 'Basic abc' } }), 'unauthenticated');
  fails(await h.call('POST', '/bootstrap', { token: 'not-a-token' }), 'unauthenticated');
  const res = await h.call('GET', '/security/status', { token: user.token });
  assert.equal(res.status, 200);
  await h.auth.revokeRefreshTokens('u1');
  const revoked = await h.call('GET', '/security/status', { token: user.token });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.error.code, 'unauthenticated');
  // a freshly issued token works again
  assert.equal((await h.call('GET', '/security/status', { token: h.auth.issue('u1') })).status, 200);
});

test('wallet endpoints require a verified email; bootstrap and security status do not', async () => {
  const h = createHarness();
  const user = await h.signup('u1', { emailVerified: false });
  ok(await h.call('GET', '/security/status', { token: user.token }));
  const routes = [
    ['POST', '/wallet/quote', { kind: 'deposit', amountMinor: 10000 }],
    ['POST', '/wallet/deposits', { amountMinor: 10000, idempotencyKey: h.key() }],
    ['POST', '/wallet/destinations', { kind: 'bank', providerName: 'BDO', accountName: 'Ana', accountNumber: '123456789' }],
    ['POST', '/wallet/withdrawals', {}],
    ['POST', '/wallet/transfers/lookup', { walletCode: 'IKZ-ABCD-EFGH' }],
    ['POST', '/wallet/transfers', {}],
    ['POST', '/security/pin', { newPin: '135790' }],
  ];
  for (const [method, path, body] of routes) {
    fails(await h.call(method, path, { token: user.token, body }), 'email_not_verified');
  }
  h.auth.setVerified('u1', true);
  ok(await h.call('POST', '/wallet/quote', { token: h.auth.issue('u1'), body: { kind: 'deposit', amountMinor: 10000 } }));
});

test('admin endpoints reject ordinary users', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  for (const [method, path] of [
    ['GET', '/admin/withdrawals'],
    ['POST', '/admin/withdrawals/WDR-X/approve'],
    ['POST', '/admin/transactions/DEP-X/reverse'],
    ['GET', '/admin/reconcile'],
  ]) {
    const res = await h.call(method, path, { token: user.token, body: {} });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'permission_denied');
  }
});

test('bootstrap creates user, wallet, wallet code, default categories and an activity entry', async () => {
  const h = createHarness();
  h.auth.addUser({ uid: 'u1', email: 'juan.dela@example.com', emailVerified: false, name: 'Juan Dela Cruz' });
  const token = h.auth.issue('u1');
  const data = ok(await h.call('POST', '/bootstrap', { token, body: {} }));

  assert.equal(data.user.uid, 'u1');
  assert.equal(data.user.displayName, 'Juan Dela Cruz');
  assert.equal(data.user.email, 'juan.dela@example.com');
  assert.equal(data.user.status, 'active');
  assert.equal(data.user.walletCurrency, 'PHP');
  assert.deepEqual(data.user.preferences.notifications, { wallet: true });
  assert.equal(data.user.preferences.locale, 'en_PH');
  assert.equal(data.wallet.availableMinor, 0);
  assert.equal(data.wallet.heldMinor, 0);
  assert.equal(data.wallet.pendingDepositMinor, 0);
  assert.equal(data.wallet.status, 'active');
  assert.match(data.wallet.walletCode, WALLET_CODE_PATTERN);
  assert.equal(typeof data.user.createdAt, 'string');

  assert.equal(h.db.read(`walletCodes/${data.wallet.walletCode}`).uid, 'u1');
  const categories = h.db.list('users/u1/categories').map((entry) => entry.data);
  assert.equal(categories.length, DEFAULT_CATEGORIES.length);
  assert.ok(categories.every((category) => category.archived === false && Number.isInteger(category.color)));
  assert.deepEqual(new Set(categories.map((category) => category.kind)), new Set(['income', 'expense']));
  const activity = h.db.list('users/u1/activity').map((entry) => entry.data);
  assert.equal(activity.length, 1);
  assert.equal(activity[0].source, 'server');
  assert.equal(activity[0].type, 'account_created');
});

test('bootstrap is idempotent and never changes an existing account', async () => {
  const h = createHarness();
  const user = await h.signup('u1', { displayName: 'First Name' });
  const before = h.wallet('u1');
  const again = ok(await h.call('POST', '/bootstrap', { token: user.token, body: { displayName: 'Other Name' } }));
  assert.equal(again.user.displayName, 'First Name');
  assert.equal(again.wallet.walletCode, before.walletCode);
  assert.equal(h.db.list('users/u1/categories').length, DEFAULT_CATEGORIES.length);
  assert.equal(h.db.list('walletCodes').length, 1);
  const parallel = await Promise.all(Array.from({ length: 6 }, () => h.call('POST', '/bootstrap', { token: user.token })));
  for (const res of parallel) assert.equal(res.status, 200);
  assert.equal(h.db.list('users/u1/categories').length, DEFAULT_CATEGORIES.length);
});

test('bootstrap: simultaneous first calls create exactly one account', async () => {
  const h = createHarness();
  h.auth.addUser({ uid: 'u9', email: 'u9@example.com' });
  const token = h.auth.issue('u9');
  const results = await Promise.all(Array.from({ length: 6 }, () => h.call('POST', '/bootstrap', { token })));
  for (const res of results) assert.equal(res.status, 200, JSON.stringify(res.body));
  const codes = new Set(results.map((res) => res.body.data.wallet.walletCode));
  assert.equal(codes.size, 1);
  assert.equal(h.db.list('walletCodes').length, 1);
  assert.equal(h.db.list('users/u9/categories').length, DEFAULT_CATEGORIES.length);
});

test('bootstrap display name falls back to the e-mail name, and validates input', async () => {
  const h = createHarness();
  h.auth.addUser({ uid: 'u2', email: 'maria.santos@example.com' });
  const token = h.auth.issue('u2');
  const data = ok(await h.call('POST', '/bootstrap', { token, body: {} }));
  assert.equal(data.user.displayName, 'maria.santos');

  const h2 = createHarness();
  const user = await h2.signup('u3', { bootstrap: false });
  fails(await h2.call('POST', '/bootstrap', { token: user.token, body: { currency: 'USD' } }), 'invalid_argument', { field: 'currency' });
  fails(await h2.call('POST', '/bootstrap', { token: user.token, body: { admin: true } }), 'invalid_argument', { field: 'admin' });
  fails(await h2.call('POST', '/bootstrap', { token: user.token, body: { displayName: 'x'.repeat(61) } }), 'invalid_argument', { field: 'displayName' });
});

test('bootstrap honours WALLET_CURRENCIES', async () => {
  const h = createHarness({ params: { WALLET_CURRENCIES: 'PHP,USD' } });
  const user = await h.signup('u1', { bootstrap: false });
  const data = ok(await h.call('POST', '/bootstrap', { token: user.token, body: { currency: 'usd' } }));
  assert.equal(data.wallet.currency, 'USD');
  assert.equal(data.user.walletCurrency, 'USD');
});

test('quote: fees, totals and problems', async () => {
  const h = createHarness({ params: { DEPOSIT_FEE_BPS: '250', WITHDRAW_FEE_FIXED_MINOR: '1500', TRANSFER_FEE_BPS: '100', TRANSFER_FEE_FIXED_MINOR: '50' } });
  const user = await h.signup('u1');
  const quote = async (kind, amountMinor) => ok(await h.call('POST', '/wallet/quote', { token: user.token, body: { kind, amountMinor } }));

  const deposit = await quote('deposit', 100000);
  assert.deepEqual(
    { fee: deposit.feeMinor, total: deposit.totalMinor, cur: deposit.currency, min: deposit.minMinor, max: deposit.maxMinor, daily: deposit.remainingDailyMinor, problem: deposit.problem },
    { fee: 2500, total: 102500, cur: 'PHP', min: 10000, max: 5000000, daily: null, problem: null },
  );
  assert.equal((await quote('deposit', 9999)).problem, 'below_min');
  assert.equal((await quote('deposit', 5000001)).problem, 'above_max');

  const withdrawal = await quote('withdrawal', 20000);
  assert.equal(withdrawal.feeMinor, 1500);
  assert.equal(withdrawal.totalMinor, 21500);
  assert.equal(withdrawal.problem, 'insufficient_funds');
  assert.equal(withdrawal.remainingDailyMinor, 10000000);

  const transfer = await quote('transfer', 10000);
  assert.equal(transfer.feeMinor, 150);
  assert.equal(transfer.totalMinor, 10150);

  await h.fund(user, 500000);
  assert.equal((await quote('withdrawal', 20000)).problem, null);
  assert.equal((await quote('transfer', 99)).problem, 'below_min');
});

test('quote reports the daily limit and requires a set-up wallet', async () => {
  const h = createHarness({ params: { DAILY_OUT_LIMIT_MINOR: '50000' } });
  const user = await h.signup('u1');
  const data = ok(await h.call('POST', '/wallet/quote', { token: user.token, body: { kind: 'withdrawal', amountMinor: 60000 } }));
  assert.equal(data.remainingDailyMinor, 50000);
  assert.equal(data.problem, 'daily_limit');

  const stranger = await h.signup('u2', { bootstrap: false });
  const res = await h.call('POST', '/wallet/quote', { token: stranger.token, body: { kind: 'deposit', amountMinor: 10000 } });
  fails(res, 'not_found', { reason: 'not_bootstrapped' });
  fails(await h.call('POST', '/wallet/quote', { token: user.token, body: { kind: 'bogus', amountMinor: 1 } }), 'invalid_argument', { field: 'kind' });
  fails(await h.call('POST', '/wallet/quote', { token: user.token, body: { kind: 'deposit', amountMinor: 1.5 } }), 'invalid_argument', { field: 'amountMinor' });
});

test('rate limiting is per user and per window', async () => {
  const h = createHarness({ relaxRateLimits: false });
  const a = await h.signup('a');
  const b = await h.signup('b');
  const body = { kind: 'deposit', amountMinor: 10000 };
  for (let i = 0; i < 60; i += 1) ok(await h.call('POST', '/wallet/quote', { token: a.token, body }));
  const limited = await h.call('POST', '/wallet/quote', { token: a.token, body });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'resource_exhausted');
  assert.ok(limited.body.error.details.retryAfterSeconds >= 1);
  ok(await h.call('POST', '/wallet/quote', { token: b.token, body }));
  h.clock.advance(3600 * 1000);
  ok(await h.call('POST', '/wallet/quote', { token: a.token, body }));
});

test('unexpected errors become a generic 500 and are logged, not leaked', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  h.db.runTransaction = async () => {
    throw new Error('secret database detail');
  };
  const res = await h.call('POST', '/bootstrap', { token: h.auth.issue('u1') });
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'internal');
  assert.ok(!JSON.stringify(res.body).includes('secret database detail'));
  assert.equal(h.unexpectedErrors().length, 1);
  void user;
});

test('every documented endpoint exists', () => {
  const h = createHarness();
  const documented = [
    'GET /health',
    'POST /bootstrap',
    'POST /wallet/quote',
    'POST /wallet/deposits',
    'POST /wallet/deposits/:id/sync',
    'POST /wallet/deposits/:id/cancel',
    'POST /wallet/destinations',
    'DELETE /wallet/destinations/:id',
    'POST /wallet/withdrawals',
    'POST /wallet/withdrawals/:id/cancel',
    'POST /wallet/transfers/lookup',
    'POST /wallet/transfers',
    'GET /security/status',
    'POST /security/pin',
    'POST /security/revoke-sessions',
    'POST /webhooks/paymongo',
    'GET /admin/withdrawals',
    'POST /admin/withdrawals/:id/approve',
    'POST /admin/withdrawals/:id/reject',
    'POST /admin/withdrawals/:id/complete',
    'POST /admin/withdrawals/:id/fail',
    'POST /admin/transactions/:id/reverse',
    'GET /admin/reconcile',
  ];
  assert.deepEqual([...h.api.routes].sort(), [...documented].sort());
});
