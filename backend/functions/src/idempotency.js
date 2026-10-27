'use strict';

const { err } = require('./errors');
const { sha256Hex, canonicalJson } = require('./util');

/** Document id of the idempotency record for (user, operation, client-supplied key). */
function idempotencyId(uid, op, key) {
  return sha256Hex(`${uid}|${op}|${key}`);
}

/** Hash of the semantic payload (never includes the PIN or the key itself). */
function requestHash(payload) {
  return sha256Hex(canonicalJson(payload));
}

/**
 * Looks at an idempotency record snapshot. Returns null when the key is new, the stored record when the same key was
 * already used with the SAME payload, and throws `idempotency_conflict` when the payload differs.
 */
function inspect(snapshot, hash) {
  if (!snapshot.exists) return null;
  const record = snapshot.data();
  if (record.requestHash !== hash) {
    throw err('idempotency_conflict', 'This request key was already used for a different request.');
  }
  return record;
}

module.exports = { idempotencyId, requestHash, inspect };
