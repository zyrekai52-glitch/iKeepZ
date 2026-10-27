'use strict';

const crypto = require('node:crypto');
const { err } = require('../errors');
const { safeEqual } = require('../util');

// PayMongo Checkout Sessions adapter (https://developers.paymongo.com/reference/checkout-session-resource).
// The adapter never decides that money arrived on its own: callers must use fetchPayment() (a server-to-server read
// with the secret key) and compare the result with the pending transaction before crediting anything.

const API_BASE = 'https://api.paymongo.com/v1';

function clean(secret) {
  const value = typeof secret === 'string' ? secret.trim() : '';
  return value === '' || value.toLowerCase() === 'unset' ? '' : value;
}

/** Pure: turns a checkout session resource into the normalised payment result the ledger code understands. */
function interpretSession(resource) {
  const attributes = (resource && resource.attributes) || {};
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  const base = {
    referenceNumber: typeof attributes.reference_number === 'string' ? attributes.reference_number : null,
    providerPaymentId: null,
    amountMinor: null,
    currency: null,
    paidAt: null,
  };
  const paid = payments.find((payment) => payment && payment.attributes && payment.attributes.status === 'paid');
  if (paid) {
    const info = paid.attributes;
    return {
      ...base,
      status: 'paid',
      providerPaymentId: paid.id || null,
      amountMinor: Number.isSafeInteger(info.amount) ? info.amount : null,
      currency: typeof info.currency === 'string' ? info.currency.toUpperCase() : null,
      paidAt: Number.isFinite(info.paid_at) ? new Date(info.paid_at * 1000) : null,
    };
  }
  const intent = attributes.payment_intent && attributes.payment_intent.attributes;
  if (intent && intent.status === 'succeeded') {
    return {
      ...base,
      status: 'paid',
      amountMinor: Number.isSafeInteger(intent.amount) ? intent.amount : null,
      currency: typeof intent.currency === 'string' ? intent.currency.toUpperCase() : null,
    };
  }
  if (attributes.status === 'expired') return { ...base, status: 'expired' };
  return { ...base, status: 'unpaid' };
}

/** Pure: normalises a webhook event body. Only `checkout_session.payment.paid` is acted upon. */
function interpretWebhook(body) {
  const event = body && body.data;
  const attributes = event && event.attributes;
  if (!event || typeof event.id !== 'string' || !attributes) return null;
  const resource = attributes.data;
  const isPaid = attributes.type === 'checkout_session.payment.paid';
  const isSession = Boolean(resource) && resource.type === 'checkout_session' && typeof resource.id === 'string';
  return {
    eventId: event.id,
    type: isPaid && isSession ? 'payment_paid' : 'other',
    rawType: typeof attributes.type === 'string' ? attributes.type : 'unknown',
    checkoutSessionId: isSession ? resource.id : null,
    referenceNumber: isSession && resource.attributes ? resource.attributes.reference_number || null : null,
    livemode: attributes.livemode === true,
  };
}

function parseSignatureHeader(header) {
  const parts = {};
  for (const piece of String(header || '').split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  return parts;
}

function createPaymongoProvider({ secretKey, webhookSecret, paymentMethods = ['gcash', 'paymaya', 'card'], fetchImpl, logger, timeoutMs = 15000 }) {
  const key = clean(secretKey);
  const signingSecret = clean(webhookSecret);
  const doFetch = fetchImpl || globalThis.fetch;

  async function request(method, path, body) {
    if (!key) throw err('not_configured', 'Payments are not configured.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await doFetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (logger) logger.warn('PayMongo request failed to complete', { path, reason: error && error.name });
      throw err('provider_error', 'The payment provider could not be reached. Please try again.');
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) {
      if (logger) logger.warn('PayMongo rejected a request', { path, status: response.status, errors: json && json.errors });
      throw err('provider_error', 'The payment provider rejected the request.', { providerStatus: response.status });
    }
    return json;
  }

  return {
    name: 'paymongo',

    isConfigured() {
      return Boolean(key);
    },

    async createCheckout({ reference, amountMinor, currency, description, returnUrl }) {
      const success = new URL(returnUrl);
      success.searchParams.set('status', 'success');
      success.searchParams.set('ref', reference);
      const cancel = new URL(returnUrl);
      cancel.searchParams.set('status', 'cancelled');
      cancel.searchParams.set('ref', reference);
      const json = await request('POST', '/checkout_sessions', {
        data: {
          attributes: {
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            description,
            reference_number: reference,
            line_items: [{ currency, amount: amountMinor, name: 'iKeepZ wallet deposit', quantity: 1 }],
            payment_method_types: paymentMethods,
            success_url: success.toString(),
            cancel_url: cancel.toString(),
          },
        },
      });
      const data = json && json.data;
      const attributes = data && data.attributes;
      if (!data || typeof data.id !== 'string' || !attributes || typeof attributes.checkout_url !== 'string') {
        throw err('provider_error', 'The payment provider returned an unexpected response.');
      }
      return {
        providerRef: data.id,
        checkoutUrl: attributes.checkout_url,
        expiresAt: Number.isFinite(attributes.expires_at) ? new Date(attributes.expires_at * 1000) : null,
      };
    },

    async fetchPayment(providerRef) {
      const json = await request('GET', `/checkout_sessions/${encodeURIComponent(providerRef)}`);
      if (!json || !json.data) throw err('provider_error', 'The payment provider returned an unexpected response.');
      return interpretSession(json.data);
    },

    async expireCheckout(providerRef) {
      await request('POST', `/checkout_sessions/${encodeURIComponent(providerRef)}/expire`);
    },

    /** Paymongo-Signature: t=<unix>,te=<test hmac>,li=<live hmac>; HMAC-SHA256 of "<t>.<raw body>". */
    verifyWebhook(rawBody, headers) {
      if (!signingSecret) return false;
      const parts = parseSignatureHeader(headers && headers['paymongo-signature']);
      if (!parts.t) return false;
      const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
      const expected = crypto.createHmac('sha256', signingSecret).update(`${parts.t}.${text}`).digest('hex');
      return [parts.te, parts.li].some((signature) => Boolean(signature) && safeEqual(signature, expected));
    },

    parseWebhook: interpretWebhook,
  };
}

module.exports = { createPaymongoProvider, interpretSession, interpretWebhook, parseSignatureHeader, clean };
