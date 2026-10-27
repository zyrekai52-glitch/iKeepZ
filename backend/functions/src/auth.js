'use strict';

const { err } = require('./errors');

const STEP_UP_SECONDS = 300;

/** Verifies the Firebase ID token in `Authorization: Bearer ...` (revocation is checked) and returns the caller. */
async function authenticate(headers, deps) {
  const header = String((headers && (headers.authorization || headers.Authorization)) || '');
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw err('unauthenticated', 'Sign in to continue.');
  let decoded;
  try {
    decoded = await deps.auth.verifyIdToken(match[1], true);
  } catch {
    throw err('unauthenticated', 'Your session has expired. Sign in again.');
  }
  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
    admin: decoded.admin === true,
    name: typeof decoded.name === 'string' ? decoded.name : null,
    authTimeSeconds: Number.isFinite(decoded.auth_time) ? decoded.auth_time : null,
  };
}

function requireVerified(user) {
  if (!user.emailVerified) {
    throw err('email_not_verified', 'Verify your email address before using the wallet.');
  }
}

function requireAdmin(user) {
  if (!user.admin) throw err('permission_denied', 'Administrator access is required.');
}

/** Sensitive changes (PIN) need a sign-in within the last five minutes. */
function requireRecentSignIn(user, now) {
  const seconds = user.authTimeSeconds;
  if (seconds === null || now.getTime() / 1000 - seconds > STEP_UP_SECONDS) {
    throw err('step_up_required', 'Sign in again to confirm it is you, then retry.');
  }
}

module.exports = { STEP_UP_SECONDS, authenticate, requireVerified, requireAdmin, requireRecentSignIn };
