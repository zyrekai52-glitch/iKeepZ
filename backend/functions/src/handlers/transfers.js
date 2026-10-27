'use strict';

const { err } = require('../errors');
const { parse, int, str, IDEMPOTENCY_KEY } = require('../validation');
const { MAX_MINOR, formatDisplay } = require('../money');
const { newReference, maskName, normalizeWalletCode, sanitizeText } = require('../util');
const { applyLedger } = require('../ledger');
const { idempotencyId, requestHash, inspect } = require('../idempotency');
const rateLimit = require('../ratelimit');
const { verifyPin } = require('../pin');
const { queueNotification, queueActivity, queueEvent } = require('../effects');
const common = require('./common');

function codeOrThrow(input) {
  const code = normalizeWalletCode(input);
  if (!code) throw err('invalid_argument', 'That is not a valid wallet code.', { field: 'walletCode' });
  return code;
}

/** Same answer for "unknown code" and "your own code" so the endpoint cannot be used to probe accounts. */
async function resolveRecipient(deps, code, senderUid) {
  const snapshot = await deps.store.walletCode(code).get();
  if (!snapshot.exists || snapshot.data().uid === senderUid) throw err('not_found', 'No wallet found for that code.');
  return snapshot.data().uid;
}

async function lookupWallet(ctx) {
  const { deps, user } = ctx;
  const input = parse({ walletCode: str({ min: 3, max: 40 }) }, ctx.body);
  const code = codeOrThrow(input.walletCode);
  await rateLimit.consume(deps, user.uid, 'lookup');
  const recipientUid = await resolveRecipient(deps, code, user.uid);
  const userSnapshot = await deps.store.user(recipientUid).get();
  const walletSnapshot = await deps.store.wallet(recipientUid).get();
  if (
    !userSnapshot.exists ||
    !walletSnapshot.exists ||
    userSnapshot.data().status !== 'active' ||
    walletSnapshot.data().status !== 'active'
  ) {
    throw err('not_found', 'No wallet found for that code.');
  }
  return {
    walletCode: code,
    displayName: maskName(userSnapshot.data().displayName),
    currency: walletSnapshot.data().currency,
  };
}

async function createTransfer(ctx) {
  const { deps, user } = ctx;
  const { store, clock, config } = deps;
  const input = parse(
    {
      walletCode: str({ min: 3, max: 40 }),
      amountMinor: int({ min: 1, max: MAX_MINOR }),
      note: str({ max: 140, optional: true, nullable: true }),
      pin: str({ pattern: /^\d{6}$/, min: 6, max: 6, trim: false }),
      idempotencyKey: IDEMPOTENCY_KEY,
    },
    ctx.body,
  );
  const code = codeOrThrow(input.walletCode);
  const note = input.note ? sanitizeText(input.note, 140) : '';
  const account = await common.loadAccount(deps, user.uid);
  common.assertUsable(account, config, 'transfers');
  common.assertAmountInRange(config, 'transfer', input.amountMinor);
  const { feeMinor, totalMinor } = common.priceOf(config, 'transfer', input.amountMinor);

  const idempotencyRef = store.idempotency(idempotencyId(user.uid, 'transfer', input.idempotencyKey));
  const hash = requestHash({ walletCode: code, amountMinor: input.amountMinor, note });
  const earlier = inspect(await idempotencyRef.get(), hash);
  if (earlier) return { tx: await common.loadTxFor(deps, earlier.txId, user.uid) };

  const recipientUid = await resolveRecipient(deps, code, user.uid);
  await verifyPin(deps, user.uid, input.pin);
  await rateLimit.consume(deps, user.uid, 'transfer');

  const txId = newReference('TRF');
  const daily = common.dailyFor(deps, user.uid, clock.now());
  const result = await store.db.runTransaction(async (tx) => {
    const idempotencySnapshot = await tx.get(idempotencyRef);
    const existing = inspect(idempotencySnapshot, hash);
    if (existing) return { replayId: existing.txId };

    // Read in a fixed order (by uid) so two opposite transfers never wait on each other in different orders.
    const snapshots = {};
    for (const uid of [user.uid, recipientUid].sort()) {
      snapshots[uid] = { user: await tx.get(store.user(uid)), wallet: await tx.get(store.wallet(uid)) };
    }
    const dailySnapshot = await tx.get(daily.ref);
    const senderParty = { user: snapshots[user.uid].user.data(), wallet: snapshots[user.uid].wallet.data() };
    const recipientParty = snapshots[recipientUid];
    const revenueSnapshot = await tx.get(store.platformRevenue(senderParty.wallet.currency));
    const now = clock.now();

    common.assertUsable(senderParty, config, 'transfers');
    if (
      !recipientParty.user.exists ||
      !recipientParty.wallet.exists ||
      recipientParty.user.data().status !== 'active' ||
      recipientParty.wallet.data().status !== 'active'
    ) {
      throw err('not_found', 'No wallet found for that code.');
    }
    const recipient = { user: recipientParty.user.data(), wallet: recipientParty.wallet.data() };
    const { currency } = senderParty.wallet;
    if (recipient.wallet.currency !== currency) {
      throw err('invalid_state', 'You can only send money to wallets that use the same currency.', { reason: 'currency_mismatch' });
    }
    const used = dailySnapshot.exists ? dailySnapshot.data().outMinor : 0;
    common.assertDailyRoom(config, used, totalMinor);

    applyLedger(tx, store, user.uid, senderParty.wallet, { txId, type: 'transfer_out', deltaAvailableMinor: -totalMinor, now });
    applyLedger(tx, store, recipientUid, recipient.wallet, { txId, type: 'transfer_in', deltaAvailableMinor: input.amountMinor, now });
    common.addRevenue(tx, store, revenueSnapshot, currency, feeMinor, now);
    tx.set(daily.ref, {
      uid: user.uid,
      day: daily.day,
      outMinor: used + totalMinor,
      updatedAt: now,
      expiresAt: common.addDays(now, config.retention.dailyDays),
    });

    const senderName = maskName(senderParty.user.displayName);
    const recipientName = maskName(recipient.user.displayName);
    const doc = common.newTxDoc({
      reference: txId,
      kind: 'transfer',
      status: 'completed',
      amountMinor: input.amountMinor,
      feeMinor,
      totalMinor,
      currency,
      ownerUid: user.uid,
      counterpartyUid: recipientUid,
      participants: [user.uid, recipientUid],
      directions: { [user.uid]: 'debit', [recipientUid]: 'credit' },
      ownerDisplay: senderName,
      counterpartyDisplay: recipientName,
      note: note || null,
      dailyKey: daily.key,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    tx.create(store.walletTx(txId), doc);
    queueEvent(tx, store, txId, { from: null, to: 'completed', by: 'user', now });
    queueNotification(tx, store, {
      uid: user.uid,
      userData: senderParty.user,
      type: 'transfer_sent',
      params: { amountMinor: input.amountMinor, currency, counterparty: recipientName, txId },
      now,
    });
    queueNotification(tx, store, {
      uid: recipientUid,
      userData: recipient.user,
      type: 'transfer_received',
      params: { amountMinor: input.amountMinor, currency, counterparty: senderName, txId },
      now,
    });
    queueActivity(tx, store, user.uid, {
      type: 'transfer_sent',
      summary: `Sent ${formatDisplay(input.amountMinor, currency)} to ${recipientName}`,
      entityType: 'walletTx',
      entityId: txId,
      now,
    });
    queueActivity(tx, store, recipientUid, {
      type: 'transfer_received',
      summary: `Received ${formatDisplay(input.amountMinor, currency)} from ${senderName}`,
      entityType: 'walletTx',
      entityId: txId,
      now,
    });
    tx.create(idempotencyRef, {
      uid: user.uid,
      op: 'transfer',
      requestHash: hash,
      txId,
      createdAt: now,
      expiresAt: common.addDays(now, config.retention.idempotencyDays),
    });
    return { replayId: null, doc };
  });
  if (result.replayId) return { tx: await common.loadTxFor(deps, result.replayId, user.uid) };
  return { tx: common.toApiTx(txId, result.doc, user.uid) };
}

module.exports = { lookupWallet, createTransfer };
