'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ok, fails } = require('./helpers/harness');
const pin = require('../src/pin');

test('weak PINs are recognised', () => {
  for (const weak of ['000000', '111111', '123456', '234567', '654321', '987654', '123123', '457457', '012345']) {
    assert.equal(pin.isWeakPin(weak), true, weak);
  }
  for (const strong of ['135790', '482915', '102938', '908172', '271828']) {
    assert.equal(pin.isWeakPin(strong), false, strong);
  }
});

test('setting a PIN: validation, step-up and storage', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const status = async () => ok(await h.call('GET', '/security/status', { token: h.auth.issue('u1') }));
  assert.equal((await status()).pinSet, false);
  assert.equal((await status()).emailVerified, true);

  const set = (body, options = {}) => h.call('POST', '/security/pin', { token: h.auth.issue('u1', options), body });
  fails(await set({ newPin: '12345' }), 'invalid_argument', { field: 'newPin' });
  fails(await set({ newPin: '12345a' }), 'invalid_argument', { field: 'newPin' });
  fails(await set({ newPin: 135790 }), 'invalid_argument', { field: 'newPin' });
  fails(await set({}), 'invalid_argument', { field: 'newPin' });
  fails(await set({ newPin: '111111' }), 'invalid_argument', { field: 'newPin', reason: 'weak_pin' });
  fails(await set({ newPin: '123456' }), 'invalid_argument', { reason: 'weak_pin' });
  fails(await set({ newPin: '135790', extra: 1 }), 'invalid_argument', { field: 'extra' });
  fails(await set({ newPin: '135790' }, { authAgeSeconds: 600 }), 'step_up_required');

  ok(await set({ newPin: '135790' }));
  const stored = h.db.read('walletSecurity/u1');
  assert.ok(stored.hash && stored.salt);
  assert.deepEqual(Object.keys(stored.params).sort(), ['N', 'keylen', 'p', 'r']);
  assert.equal(stored.failedAttempts, 0);
  assert.equal(stored.lockedUntil, null);
  assert.ok(!JSON.stringify(stored).includes('135790'), 'the PIN itself is never stored');
  assert.equal((await status()).pinSet, true);
  void user;
});

test('the same PIN hashes differently each time (random salt)', async () => {
  const params = { N: 1024, r: 8, p: 1, keylen: 32 };
  const a = await pin.hashPin('135790', params);
  const b = await pin.hashPin('135790', params);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('changing the PIN needs the current one', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  await h.setPin(user, '135790');
  const change = (body) => h.call('POST', '/security/pin', { token: h.auth.issue('u1'), body });
  fails(await change({ newPin: '482915' }), 'invalid_argument', { field: 'currentPin' });
  const wrong = fails(await change({ newPin: '482915', currentPin: '000001' }), 'pin_incorrect');
  assert.equal(wrong.details.attemptsRemaining, 4);
  fails(await change({ newPin: '135790', currentPin: '135790' }), 'invalid_argument', { field: 'newPin' });
  ok(await change({ newPin: '482915', currentPin: '135790' }));
  await assert.doesNotReject(pin.verifyPin(h.deps, 'u1', '482915'));
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '135790'), (e) => e.code === 'pin_incorrect');
});

test('setting the PIN raises a security notification even when wallet notifications are off', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const userDoc = h.db.read('users/u1');
  userDoc.preferences.notifications.wallet = false;
  h.db.seed('users/u1', userDoc);
  await h.setPin(user, '135790');
  const [note] = h.notifications('u1');
  assert.equal(note.type, 'pin_changed');
  assert.equal(note.group, 'security');
  assert.equal(note.readAt, null);
  assert.match(note.title, /PIN set/);
});

test('verifyPin: not set, malformed, wrong, locked, unlocked', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '135790'), (e) => e.code === 'pin_required');
  await h.setPin(user, '135790');
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '12'), (e) => e.code === 'invalid_argument');
  await assert.rejects(pin.verifyPin(h.deps, 'u1', undefined), (e) => e.code === 'invalid_argument');

  const remaining = [];
  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(pin.verifyPin(h.deps, 'u1', '000001'), (e) => {
      remaining.push(e.details.attemptsRemaining);
      return e.code === 'pin_incorrect';
    });
  }
  assert.deepEqual(remaining, [4, 3, 2, 1]);
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '000001'), (e) => e.code === 'pin_locked' && Boolean(e.details.lockedUntil));
  const lockedUntil = h.db.read('walletSecurity/u1').lockedUntil;
  assert.equal(lockedUntil.toISOString(), '2026-03-10T02:15:00.000Z');
  assert.equal(h.notifications('u1').filter((n) => n.type === 'pin_locked').length, 1);

  // Even the correct PIN is refused while locked, and does not extend the lock.
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '135790'), (e) => e.code === 'pin_locked');
  assert.equal((await h.call('GET', '/security/status', { token: h.auth.issue('u1') })).body.data.pinLockedUntil, '2026-03-10T02:15:00.000Z');

  h.clock.advance(15 * 60 * 1000 + 1000);
  await assert.doesNotReject(pin.verifyPin(h.deps, 'u1', '135790'));
  const after = h.db.read('walletSecurity/u1');
  assert.equal(after.failedAttempts, 0);
  assert.equal(after.lockedUntil, null);
  assert.equal((await h.call('GET', '/security/status', { token: h.auth.issue('u1') })).body.data.pinLockedUntil, null);
});

test('a correct PIN resets the failure counter', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  await h.setPin(user, '135790');
  for (let i = 0; i < 3; i += 1) await assert.rejects(pin.verifyPin(h.deps, 'u1', '000001'));
  await pin.verifyPin(h.deps, 'u1', '135790');
  for (let i = 0; i < 4; i += 1) await assert.rejects(pin.verifyPin(h.deps, 'u1', '000001'), (e) => e.code === 'pin_incorrect');
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '000001'), (e) => e.code === 'pin_locked');
});

test('after a lock expires a wrong guess starts a fresh count', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  await h.setPin(user, '135790');
  for (let i = 0; i < 5; i += 1) await assert.rejects(pin.verifyPin(h.deps, 'u1', '000001'));
  h.clock.advance(16 * 60 * 1000);
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '000001'), (e) => e.code === 'pin_incorrect' && e.details.attemptsRemaining === 4);
});

test('parallel wrong guesses cannot dodge the counter', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  await h.setPin(user, '135790');
  const guesses = Array.from({ length: 12 }, (_, i) => `00000${i % 10}`.slice(-6)).map((g, i) => (g === '135790' ? `00001${i}` : g));
  const results = await Promise.allSettled(guesses.map((guess) => pin.verifyPin(h.deps, 'u1', guess)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0, 'no wrong guess may succeed');
  const codes = results.map((r) => r.reason.code);
  for (const code of codes) assert.ok(['pin_incorrect', 'pin_locked', 10].includes(code), `unexpected outcome ${code}`);
  // Only the first four wrong guesses are ever reported as "incorrect"; the fifth locks, everything after is locked out.
  assert.ok(codes.filter((code) => code === 'pin_incorrect').length <= 4);
  assert.equal(h.db.read('walletSecurity/u1').lockCount, 1);
  await assert.rejects(pin.verifyPin(h.deps, 'u1', '135790'), (e) => e.code === 'pin_locked');
});

test('revoke-sessions signs the account out everywhere', async () => {
  const h = createHarness();
  const user = await h.signup('u1');
  const other = h.auth.issue('u1');
  ok(await h.call('POST', '/security/revoke-sessions', { token: user.token }));
  assert.equal((await h.call('GET', '/security/status', { token: user.token })).status, 401);
  assert.equal((await h.call('GET', '/security/status', { token: other })).status, 401);
  assert.equal((await h.call('GET', '/security/status', { token: h.auth.issue('u1') })).status, 200);
  const note = h.notifications('u1').find((n) => n.type === 'sessions_revoked');
  assert.equal(note.group, 'security');
});

test('PIN changes are rate limited', async () => {
  const h = createHarness({ relaxRateLimits: false });
  await h.signup('u1');
  const attempt = () => h.call('POST', '/security/pin', { token: h.auth.issue('u1'), body: { newPin: '111111' } });
  for (let i = 0; i < 5; i += 1) fails(await attempt(), 'invalid_argument');
  fails(await attempt(), 'resource_exhausted');
});
