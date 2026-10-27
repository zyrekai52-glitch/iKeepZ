'use strict';

const { err } = require('../errors');
const common = require('./common');
const { settleDepositFromProvider } = require('./deposits');

/**
 * Payment-provider webhook. The body is only a *hint* that something happened: after the signature is verified we look up
 * the pending deposit and ask the provider (server to server) what really happened before crediting anything.
 * Duplicates and unknown events are acknowledged; a failure while settling returns an error so the provider retries.
 */
async function handleWebhook(deps, { rawBody, headers }) {
  const { provider, store, clock, config, logger } = deps;
  if (!provider || !provider.isConfigured()) throw err('not_configured', 'Payments are not configured.');
  if (!rawBody || !provider.verifyWebhook(rawBody, headers || {})) {
    throw err('unauthenticated', 'The webhook signature is not valid.');
  }
  let body;
  try {
    body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    throw err('invalid_argument', 'The webhook body is not valid JSON.');
  }
  const event = provider.parseWebhook(body);
  if (!event) throw err('invalid_argument', 'The webhook body is not a recognised event.');

  const eventRef = store.providerEvent(event.eventId);
  if ((await eventRef.get()).exists) return { received: true, duplicate: true };

  let settled = null;
  if (event.type === 'payment_paid' && event.checkoutSessionId) {
    const found = await store.walletTxs().where('providerRef', '==', event.checkoutSessionId).limit(1).get();
    if (found.empty) {
      logger.warn('Webhook for a checkout session we have no deposit for', { eventId: event.eventId });
    } else {
      const result = await settleDepositFromProvider(deps, found.docs[0].id, 'provider');
      settled = result.data.status;
    }
  }

  const now = clock.now();
  await eventRef.set({
    type: event.rawType,
    receivedAt: now,
    expiresAt: common.addDays(now, config.retention.providerEventDays),
  });
  return { received: true, settled };
}

async function paymongoWebhook(ctx) {
  return handleWebhook(ctx.deps, { rawBody: ctx.rawBody, headers: ctx.headers });
}

module.exports = { handleWebhook, paymongoWebhook };
