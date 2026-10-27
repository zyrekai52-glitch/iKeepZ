'use strict';

const crypto = require('node:crypto');

/**
 * A fetch() stand-in that behaves like the parts of the PayMongo REST API the adapter uses, with PayMongo-shaped JSON.
 * It lets tests drive the REAL adapter (and the real signature check) end to end without any network access.
 */
function createFakePaymongo({ secretKey = 'sk_test_abc123', webhookSecret = 'whsk_test_abc123' } = {}) {
  const sessions = new Map();
  const requests = [];
  let counter = 0;
  const behaviour = { failWith: null, networkDown: false, malformedCreate: false };

  function respond(status, json) {
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  }

  function present(session) {
    return {
      data: {
        id: session.id,
        type: 'checkout_session',
        attributes: {
          checkout_url: `https://checkout.paymongo.test/${session.id}`,
          reference_number: session.reference,
          status: session.status,
          description: session.description,
          line_items: session.lineItems,
          payment_method_types: session.methods,
          success_url: session.successUrl,
          cancel_url: session.cancelUrl,
          expires_at: 1900000000,
          payments: session.payment ? [{ id: session.payment.id, type: 'payment', attributes: session.payment.attributes }] : [],
          payment_intent: session.payment
            ? { id: 'pi_1', type: 'payment_intent', attributes: { status: 'succeeded', amount: session.payment.attributes.amount, currency: session.payment.attributes.currency } }
            : { id: 'pi_1', type: 'payment_intent', attributes: { status: 'awaiting_payment_method', amount: session.lineItems[0].amount, currency: session.lineItems[0].currency } },
        },
      },
    };
  }

  async function fetchImpl(url, init) {
    const record = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    requests.push(record);
    if (behaviour.networkDown) throw new TypeError('fetch failed');
    if (init.headers.Authorization !== `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`) {
      return respond(401, { errors: [{ code: 'authentication_failed', detail: 'Invalid API key' }] });
    }
    if (behaviour.failWith) return respond(behaviour.failWith, { errors: [{ code: 'parameter_invalid', detail: 'nope' }] });
    const path = new URL(url).pathname.replace(/^\/v1/, '');
    if (init.method === 'POST' && path === '/checkout_sessions') {
      if (behaviour.malformedCreate) return respond(200, { data: { id: 'cs_broken' } });
      counter += 1;
      const attributes = record.body.data.attributes;
      const session = {
        id: `cs_test_${counter}`,
        reference: attributes.reference_number,
        status: 'active',
        description: attributes.description,
        lineItems: attributes.line_items,
        methods: attributes.payment_method_types,
        successUrl: attributes.success_url,
        cancelUrl: attributes.cancel_url,
        payment: null,
      };
      sessions.set(session.id, session);
      return respond(200, present(session));
    }
    const match = /^\/checkout_sessions\/([^/]+)(\/expire)?$/.exec(path);
    if (match) {
      const session = sessions.get(match[1]);
      if (!session) return respond(404, { errors: [{ code: 'resource_not_found' }] });
      if (init.method === 'GET' && !match[2]) return respond(200, present(session));
      if (init.method === 'POST' && match[2]) {
        if (!session.payment) session.status = 'expired';
        return respond(200, present(session));
      }
    }
    return respond(404, { errors: [{ code: 'resource_not_found' }] });
  }

  function pay(sessionId, { amount, currency = 'PHP', status = 'paid' } = {}) {
    const session = sessions.get(sessionId);
    session.payment = {
      id: `pay_${sessionId}`,
      attributes: { status, amount: amount === undefined ? session.lineItems[0].amount : amount, currency, paid_at: 1800000000 },
    };
  }

  /** Builds a signed webhook delivery. `mode` is the Paymongo-Signature slot to fill: te (test) or li (live). */
  function webhook(sessionId, { eventId = `evt_${sessionId}`, type = 'checkout_session.payment.paid', mode = 'te', secret = webhookSecret, timestamp = '1800000100' } = {}) {
    const session = sessions.get(sessionId);
    const body = JSON.stringify({
      data: {
        id: eventId,
        type: 'event',
        attributes: {
          type,
          livemode: mode === 'li',
          data: { id: sessionId, type: 'checkout_session', attributes: { reference_number: session ? session.reference : null } },
        },
      },
    });
    const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const header = mode === 'te' ? `t=${timestamp},te=${digest},li=` : `t=${timestamp},te=,li=${digest}`;
    return { rawBody: Buffer.from(body), headers: { 'paymongo-signature': header } };
  }

  return { fetchImpl, sessions, requests, behaviour, pay, webhook, secretKey, webhookSecret };
}

module.exports = { createFakePaymongo };
