'use strict';

// Side-effect documents written inside the same Firestore transaction as the balance change they describe:
// notifications, activity entries, wallet-transaction events and the admin audit trail.
// All helpers are synchronous: they only buffer writes on `tx` (reads must have happened earlier).

const { formatDisplay } = require('./money');
const { sanitizeText } = require('./util');

const money = (p) => formatDisplay(p.amountMinor, p.currency);

const TEMPLATES = {
  deposit_completed: (p) => ({
    group: 'wallet',
    title: 'Deposit received',
    body: `${money(p)} was added to your wallet.`,
  }),
  deposit_failed: (p) => ({
    group: 'wallet',
    title: 'Deposit not completed',
    body: `Your deposit of ${money(p)} was not completed${p.reason ? ` (${p.reason})` : ''}. You have not been credited.`,
  }),
  withdrawal_requested: (p) => ({
    group: 'wallet',
    title: 'Withdrawal requested',
    body: `Your request to withdraw ${money(p)} to ${p.destination} is waiting for review.`,
  }),
  withdrawal_approved: (p) => ({
    group: 'wallet',
    title: 'Withdrawal approved',
    body: `Your withdrawal of ${money(p)} to ${p.destination} was approved and is being paid out.`,
  }),
  withdrawal_rejected: (p) => ({
    group: 'wallet',
    title: 'Withdrawal rejected',
    body: `Your withdrawal of ${money(p)} was rejected${p.reason ? `: ${p.reason}` : ''}. The funds are back in your wallet.`,
  }),
  withdrawal_completed: (p) => ({
    group: 'wallet',
    title: 'Withdrawal completed',
    body: `${money(p)} was sent to ${p.destination}${p.payoutReference ? ` (ref ${p.payoutReference})` : ''}.`,
  }),
  withdrawal_failed: (p) => ({
    group: 'wallet',
    title: 'Withdrawal failed',
    body: `Your withdrawal of ${money(p)} could not be paid out${p.reason ? `: ${p.reason}` : ''}. The funds are back in your wallet.`,
  }),
  withdrawal_cancelled: (p) => ({
    group: 'wallet',
    title: 'Withdrawal cancelled',
    body: `You cancelled your withdrawal of ${money(p)}. The funds are back in your wallet.`,
  }),
  transfer_sent: (p) => ({
    group: 'wallet',
    title: 'Transfer sent',
    body: `You sent ${money(p)} to ${p.counterparty}.`,
  }),
  transfer_received: (p) => ({
    group: 'wallet',
    title: 'Transfer received',
    body: `${p.counterparty} sent you ${money(p)}.`,
  }),
  transaction_reversed: (p) => ({
    group: 'wallet',
    title: 'Transaction reversed',
    body: `A ${p.kind} of ${money(p)} was reversed${p.reason ? `: ${p.reason}` : ''}.`,
  }),
  pin_changed: (p) => ({
    group: 'security',
    title: p.first ? 'Wallet PIN set' : 'Wallet PIN changed',
    body: p.first
      ? 'A wallet PIN was set on your account. If this was not you, change your password now.'
      : 'Your wallet PIN was changed. If this was not you, change your password now.',
  }),
  pin_locked: (p) => ({
    group: 'security',
    title: 'Wallet PIN locked',
    body: `Too many incorrect PIN attempts. PIN entry is locked until ${p.until}.`,
  }),
  sessions_revoked: () => ({
    group: 'security',
    title: 'Signed out everywhere',
    body: 'All of your sessions were signed out. Sign in again on the devices you trust.',
  }),
};

/** Creates a notification unless it is a wallet-group one the user has switched off. Returns true if written. */
function queueNotification(tx, store, { uid, userData, type, params = {}, now }) {
  const template = TEMPLATES[type];
  if (!template) throw new Error(`Unknown notification type ${type}`);
  const built = template(params);
  const wallet = userData && userData.preferences && userData.preferences.notifications;
  if (built.group === 'wallet' && wallet && wallet.wallet === false) return false;
  tx.create(store.notifications(uid).doc(), {
    type,
    group: built.group,
    title: built.title,
    body: built.body,
    data: params.txId ? { txId: params.txId } : {},
    readAt: null,
    createdAt: now,
  });
  return true;
}

function queueActivity(tx, store, uid, { type, summary, entityType = null, entityId = null, now }) {
  tx.create(store.activity(uid).doc(), {
    type,
    summary: sanitizeText(summary, 200),
    entityType,
    entityId,
    source: 'server',
    createdAt: now,
  });
}

function queueEvent(tx, store, txId, { from, to, by, note = null, now }) {
  tx.create(store.walletTxEvents(txId).doc(), { from, to, at: now, by, note });
}

function queueAudit(tx, store, { adminUid, action, txId = null, targetUid = null, reason = null, details = {}, now }) {
  tx.create(store.adminAudit().doc(), {
    adminUid,
    action,
    txId,
    targetUid,
    reason: reason ? sanitizeText(reason, 300) : null,
    details,
    createdAt: now,
  });
}

module.exports = { TEMPLATES, queueNotification, queueActivity, queueEvent, queueAudit };
