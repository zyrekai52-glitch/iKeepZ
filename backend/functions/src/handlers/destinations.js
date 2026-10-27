'use strict';

const { err } = require('../errors');
const { parse, str, oneOf } = require('../validation');
const { sanitizeText, maskAccount, newDocId, serialize } = require('../util');
const rateLimit = require('../ratelimit');
const { queueActivity } = require('../effects');
const common = require('./common');

const MAX_ACTIVE_DESTINATIONS = 5;
const OPEN_WITHDRAWAL_STATUSES = ['pending_review', 'approved'];

/** Saves a payout destination. The full account number is kept in a server-only collection; the app only sees a mask. */
async function addDestination(ctx) {
  const { deps, user } = ctx;
  const { store, clock, config } = deps;
  const input = parse(
    {
      kind: oneOf(['bank', 'ewallet']),
      providerName: str({ min: 2, max: 40 }),
      accountName: str({ min: 2, max: 80 }),
      accountNumber: str({ min: 4, max: 34, pattern: /^[0-9A-Za-z -]+$/ }),
    },
    ctx.body,
  );
  const providerName = sanitizeText(input.providerName, 40);
  const accountName = sanitizeText(input.accountName, 80);
  const accountNumber = input.accountNumber.replace(/[\s-]/g, '').toUpperCase();
  if (providerName.length < 2) throw err('invalid_argument', 'providerName is too short', { field: 'providerName' });
  if (accountName.length < 2) throw err('invalid_argument', 'accountName is too short', { field: 'accountName' });
  if (accountNumber.length < 4) throw err('invalid_argument', 'accountNumber is too short', { field: 'accountNumber' });

  const account = await common.loadAccount(deps, user.uid);
  common.assertUsable(account, config, 'deposits');
  await rateLimit.consume(deps, user.uid, 'destination');

  const id = newDocId();
  const saved = await store.db.runTransaction(async (tx) => {
    const active = await tx.get(store.destinations(user.uid).where('status', '==', 'active'));
    if (active.size >= MAX_ACTIVE_DESTINATIONS) {
      throw err('limit_exceeded', `You can save up to ${MAX_ACTIVE_DESTINATIONS} payout destinations. Remove one first.`, {
        reason: 'max_destinations',
        max: MAX_ACTIVE_DESTINATIONS,
      });
    }
    const now = clock.now();
    const doc = {
      kind: input.kind,
      providerName,
      accountName,
      accountNumberMasked: maskAccount(accountNumber),
      status: 'active',
      createdAt: now,
    };
    tx.create(store.destinations(user.uid).doc(id), doc);
    tx.create(store.destinationSecret(id), {
      ownerUid: user.uid,
      kind: input.kind,
      providerName,
      accountName,
      accountNumber,
      status: 'active',
      createdAt: now,
    });
    queueActivity(tx, store, user.uid, {
      type: 'destination_added',
      summary: `Saved payout destination ${providerName} ${doc.accountNumberMasked}`,
      entityType: 'destination',
      entityId: id,
      now,
    });
    return doc;
  });
  return { destination: { id, ...serialize(saved) } };
}

/** Soft-removes a destination (the secret is kept for the audit trail of earlier withdrawals). */
async function removeDestination(ctx) {
  const { deps, user, params } = ctx;
  const { store, clock } = deps;
  if (!/^[A-Za-z0-9]{10,40}$/.test(params.id)) throw err('not_found', 'Destination not found.');
  const ref = store.destinations(user.uid).doc(params.id);
  await store.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw err('not_found', 'Destination not found.');
    if (snapshot.data().status === 'removed') return;
    const related = await tx.get(store.walletTxs().where('ownerUid', '==', user.uid).where('destinationId', '==', params.id));
    if (related.docs.some((doc) => OPEN_WITHDRAWAL_STATUSES.includes(doc.data().status))) {
      throw err('invalid_state', 'A withdrawal to this destination is still in progress.', { reason: 'open_withdrawal' });
    }
    const now = clock.now();
    tx.update(ref, { status: 'removed', removedAt: now });
    tx.set(store.destinationSecret(params.id), { status: 'removed', removedAt: now }, { merge: true });
    queueActivity(tx, store, user.uid, {
      type: 'destination_removed',
      summary: `Removed payout destination ${snapshot.data().providerName} ${snapshot.data().accountNumberMasked}`,
      entityType: 'destination',
      entityId: params.id,
      now,
    });
  });
  return { ok: true };
}

module.exports = { addDestination, removeDestination, MAX_ACTIVE_DESTINATIONS };
