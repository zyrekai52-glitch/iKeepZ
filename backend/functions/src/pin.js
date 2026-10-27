'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { err } = require('./errors');
const { toDate } = require('./util');
const { queueNotification } = require('./effects');

const scrypt = promisify(crypto.scrypt);

const PIN_PATTERN = /^\d{6}$/;

/** True for PINs that are trivially guessable: repeated digit, straight sequence, or a repeated 3-digit half. */
function isWeakPin(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = Array.from(pin, Number);
  const steps = digits.slice(1).map((digit, index) => digit - digits[index]);
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) return true;
  return pin.slice(0, 3) === pin.slice(3);
}

async function derive(pin, salt, params) {
  const { N, r, p, keylen } = params;
  return scrypt(pin, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 + 1024 * 1024 });
}

async function hashPin(pin, params) {
  const salt = crypto.randomBytes(16);
  const hash = await derive(pin, salt, params);
  return { hash: hash.toString('base64'), salt: salt.toString('base64'), params: { ...params } };
}

async function matches(pin, record) {
  const expected = Buffer.from(record.hash, 'base64');
  const actual = await derive(pin, Buffer.from(record.salt, 'base64'), record.params);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function lockedError(until) {
  return err('pin_locked', 'Too many incorrect PIN attempts. Try again later.', { lockedUntil: until.toISOString() });
}

/**
 * Verifies the wallet PIN. Everything (lock check, comparison, attempt counting) happens inside one transaction so
 * parallel guesses are serialised and every failed guess is counted. Throws pin_required / pin_locked / pin_incorrect.
 */
async function verifyPin(deps, uid, pin) {
  const { store, clock, config } = deps;
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    throw err('invalid_argument', 'The PIN must be exactly 6 digits.', { field: 'pin' });
  }
  const securityRef = store.security(uid);
  const userRef = store.user(uid);

  const outcome = await store.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(securityRef);
    const userSnapshot = await tx.get(userRef);
    const now = clock.now();
    if (!snapshot.exists || !snapshot.data().hash) return { result: 'not_set' };
    const record = snapshot.data();
    const lockedUntil = toDate(record.lockedUntil);
    if (lockedUntil && lockedUntil > now) return { result: 'locked', lockedUntil };

    if (await matches(pin, record)) {
      if ((record.failedAttempts || 0) > 0 || record.lockedUntil) {
        tx.update(securityRef, { failedAttempts: 0, lockedUntil: null, updatedAt: now });
      }
      return { result: 'ok' };
    }

    const failedAttempts = (record.failedAttempts || 0) + 1;
    if (failedAttempts >= config.pin.maxAttempts) {
      const until = new Date(now.getTime() + config.pin.lockMinutes * 60000);
      tx.update(securityRef, {
        failedAttempts: 0,
        lockedUntil: until,
        lockCount: (record.lockCount || 0) + 1,
        updatedAt: now,
      });
      queueNotification(tx, store, {
        uid,
        userData: userSnapshot.exists ? userSnapshot.data() : null,
        type: 'pin_locked',
        params: { until: until.toISOString() },
        now,
      });
      return { result: 'locked', lockedUntil: until };
    }
    tx.update(securityRef, { failedAttempts, updatedAt: now });
    return { result: 'wrong', attemptsRemaining: config.pin.maxAttempts - failedAttempts };
  });

  switch (outcome.result) {
    case 'ok':
      return;
    case 'not_set':
      throw err('pin_required', 'Set a wallet PIN in Security before using the wallet.');
    case 'locked':
      throw lockedError(outcome.lockedUntil);
    default:
      throw err('pin_incorrect', 'Incorrect PIN.', { attemptsRemaining: outcome.attemptsRemaining });
  }
}

/** Sets or changes the PIN. When a PIN exists the current one must be supplied and is verified (and counted). */
async function setPin(deps, uid, { newPin, currentPin }) {
  const { store, clock, config } = deps;
  if (typeof newPin !== 'string' || !PIN_PATTERN.test(newPin)) {
    throw err('invalid_argument', 'The new PIN must be exactly 6 digits.', { field: 'newPin' });
  }
  if (isWeakPin(newPin)) {
    throw err('invalid_argument', 'Choose a less predictable PIN (no repeated digits or simple sequences).', {
      field: 'newPin',
      reason: 'weak_pin',
    });
  }

  const securityRef = store.security(uid);
  const existing = await securityRef.get();
  const hadPin = existing.exists && Boolean(existing.data().hash);
  if (hadPin) {
    if (typeof currentPin !== 'string') {
      throw err('invalid_argument', 'Enter your current PIN to change it.', { field: 'currentPin' });
    }
    await verifyPin(deps, uid, currentPin);
    if (currentPin === newPin) {
      throw err('invalid_argument', 'The new PIN must be different from the current one.', { field: 'newPin' });
    }
  }

  const record = await hashPin(newPin, config.pin.scrypt);
  await store.db.runTransaction(async (tx) => {
    const userSnapshot = await tx.get(store.user(uid));
    const now = clock.now();
    tx.set(securityRef, {
      ...record,
      failedAttempts: 0,
      lockedUntil: null,
      lockCount: 0,
      setAt: now,
      updatedAt: now,
    });
    queueNotification(tx, store, {
      uid,
      userData: userSnapshot.exists ? userSnapshot.data() : null,
      type: 'pin_changed',
      params: { first: !hadPin },
      now,
    });
  });
}

async function pinStatus(deps, uid) {
  const snapshot = await deps.store.security(uid).get();
  if (!snapshot.exists || !snapshot.data().hash) return { pinSet: false, pinLockedUntil: null };
  const lockedUntil = toDate(snapshot.data().lockedUntil);
  const active = lockedUntil && lockedUntil > deps.clock.now() ? lockedUntil.toISOString() : null;
  return { pinSet: true, pinLockedUntil: active };
}

module.exports = { PIN_PATTERN, isWeakPin, hashPin, verifyPin, setPin, pinStatus };
