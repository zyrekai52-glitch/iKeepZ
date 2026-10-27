'use strict';

const { parse, str } = require('../validation');
const rateLimit = require('../ratelimit');
const { requireRecentSignIn } = require('../auth');
const { setPin, pinStatus } = require('../pin');
const { queueNotification, queueActivity } = require('../effects');

async function securityStatus(ctx) {
  const { deps, user } = ctx;
  const pin = await pinStatus(deps, user.uid);
  return {
    pinSet: pin.pinSet,
    pinLockedUntil: pin.pinLockedUntil,
    emailVerified: user.emailVerified,
    authTime: user.authTimeSeconds === null ? null : new Date(user.authTimeSeconds * 1000).toISOString(),
  };
}

/** Sets or changes the 6-digit wallet PIN. Needs a sign-in within the last five minutes. */
async function changePin(ctx) {
  const { deps, user } = ctx;
  requireRecentSignIn(user, deps.clock.now());
  const input = parse(
    {
      newPin: str({ min: 6, max: 6, pattern: /^\d{6}$/, trim: false }),
      currentPin: str({ min: 6, max: 6, pattern: /^\d{6}$/, trim: false, optional: true }),
    },
    ctx.body,
  );
  await rateLimit.consume(deps, user.uid, 'pin');
  await setPin(deps, user.uid, { newPin: input.newPin, currentPin: input.currentPin });
  return { ok: true };
}

/** Signs the account out everywhere: every refresh token is revoked, so existing ID tokens stop passing verification. */
async function revokeSessions(ctx) {
  const { deps, user } = ctx;
  const { store, clock } = deps;
  await deps.auth.revokeRefreshTokens(user.uid);
  await store.db.runTransaction(async (tx) => {
    const userSnapshot = await tx.get(store.user(user.uid));
    const now = clock.now();
    queueNotification(tx, store, {
      uid: user.uid,
      userData: userSnapshot.exists ? userSnapshot.data() : null,
      type: 'sessions_revoked',
      now,
    });
    queueActivity(tx, store, user.uid, { type: 'sessions_revoked', summary: 'Signed out of all devices', now });
  });
  return { ok: true };
}

module.exports = { securityStatus, changePin, revokeSessions };
