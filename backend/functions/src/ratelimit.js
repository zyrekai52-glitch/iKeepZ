'use strict';

const { err } = require('./errors');

/**
 * Fixed-window counter per user and bucket, stored in `rateLimits`. Counts every attempt (successful or not).
 * Throws `resource_exhausted` with `retryAfterSeconds` when the window is full.
 */
async function consume(deps, uid, bucket) {
  const { store, clock, config } = deps;
  const rule = config.rateLimits[bucket];
  if (!rule) throw new Error(`Unknown rate limit bucket ${bucket}`);
  const windowMs = rule.windowSeconds * 1000;
  const nowMs = clock.now().getTime();
  const windowIndex = Math.floor(nowMs / windowMs);
  const ref = store.rateLimit(`${uid}_${bucket}_${windowIndex}`);

  await store.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = snapshot.exists ? snapshot.data().count : 0;
    if (count >= rule.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil(((windowIndex + 1) * windowMs - nowMs) / 1000));
      throw err('resource_exhausted', 'Too many attempts. Please wait a while and try again.', { retryAfterSeconds });
    }
    tx.set(ref, {
      uid,
      bucket,
      count: count + 1,
      windowIndex,
      expiresAt: new Date((windowIndex + 2) * windowMs),
    });
  });
}

module.exports = { consume };
