'use strict';

const assert = require('node:assert/strict');
const { FakeFirestore } = require('./fake-firestore');
const { createStore } = require('../../src/store');
const { loadConfig } = require('../../src/config');
const { createApi } = require('../../src/api');
const { err } = require('../../src/errors');
const { interpretWebhook } = require('../../src/providers/paymongo');

class FakeClock {
  constructor(start) {
    this.current = new Date(start);
  }

  now() {
    return new Date(this.current);
  }

  advance(ms) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Issues opaque tokens; revokeRefreshTokens invalidates every token issued before the call (checkRevoked semantics). */
class FakeAuth {
  constructor(clock) {
    this.clock = clock;
    this.users = new Map();
    this.tokens = new Map();
    this.revokedSeq = new Map();
    this.seq = 0;
  }

  addUser({ uid, email, emailVerified = true, admin = false, name = null }) {
    this.users.set(uid, { uid, email, emailVerified, admin, name });
  }

  issue(uid, { authAgeSeconds = 0 } = {}) {
    const user = this.users.get(uid);
    if (!user) throw new Error(`unknown user ${uid}`);
    this.seq += 1;
    const token = `tok_${uid}_${this.seq}`;
    this.tokens.set(token, { ...user, seq: this.seq, authTime: Math.floor(this.clock.now().getTime() / 1000) - authAgeSeconds });
    return token;
  }

  async verifyIdToken(token, checkRevoked) {
    const info = this.tokens.get(token);
    if (!info) throw new Error('invalid token');
    if (checkRevoked && this.revokedSeq.has(info.uid) && info.seq <= this.revokedSeq.get(info.uid)) throw new Error('token revoked');
    return {
      uid: info.uid,
      email: info.email,
      email_verified: info.emailVerified,
      admin: info.admin ? true : undefined,
      name: info.name || undefined,
      auth_time: info.authTime,
    };
  }

  async revokeRefreshTokens(uid) {
    this.seq += 1;
    this.revokedSeq.set(uid, this.seq);
  }

  setVerified(uid, emailVerified) {
    this.users.get(uid).emailVerified = emailVerified;
  }
}

/** A controllable stand-in for the payment provider. Used only in tests; production never contains a fake provider. */
class FakeProvider {
  constructor() {
    this.name = 'paymongo';
    this.configured = true;
    this.sessions = new Map();
    this.counter = 0;
    this.failNextCreate = false;
    this.failFetch = false;
    this.failExpire = false;
    this.calls = [];
    this.webhookSecret = 'whsec_test';
  }

  isConfigured() {
    return this.configured;
  }

  async createCheckout(args) {
    this.calls.push(['createCheckout', args]);
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw err('provider_error', 'The payment provider rejected the request.');
    }
    this.counter += 1;
    const id = `cs_fake_${this.counter}`;
    this.sessions.set(id, { id, ...args, status: 'unpaid', paidAmountMinor: null, paidCurrency: null });
    return { providerRef: id, checkoutUrl: `https://pay.test/checkout/${id}`, expiresAt: null };
  }

  async fetchPayment(providerRef) {
    this.calls.push(['fetchPayment', providerRef]);
    if (this.failFetch) throw err('provider_error', 'The payment provider could not be reached.');
    const session = this.sessions.get(providerRef);
    if (!session) throw err('provider_error', 'Unknown checkout session.');
    return {
      status: session.status,
      amountMinor: session.paidAmountMinor,
      currency: session.paidCurrency,
      referenceNumber: session.reference,
      providerPaymentId: session.status === 'paid' ? `pay_${providerRef}` : null,
      paidAt: null,
    };
  }

  async expireCheckout(providerRef) {
    this.calls.push(['expireCheckout', providerRef]);
    if (this.failExpire) throw err('provider_error', 'Could not expire.');
    const session = this.sessions.get(providerRef);
    if (session && session.status === 'unpaid') session.status = 'expired';
  }

  verifyWebhook(rawBody, headers) {
    return headers['x-test-signature'] === this.webhookSecret;
  }

  parseWebhook(body) {
    return interpretWebhook(body);
  }

  // ---- test controls ----
  pay(providerRef, { amountMinor, currency } = {}) {
    const session = this.sessions.get(providerRef);
    session.status = 'paid';
    session.paidAmountMinor = amountMinor === undefined ? session.amountMinor : amountMinor;
    session.paidCurrency = currency === undefined ? session.currency : currency;
  }

  expire(providerRef) {
    this.sessions.get(providerRef).status = 'expired';
  }

  webhookFor(providerRef, { eventId = `evt_${providerRef}`, type = 'checkout_session.payment.paid' } = {}) {
    const body = {
      data: {
        id: eventId,
        type: 'event',
        attributes: {
          type,
          livemode: false,
          data: { id: providerRef, type: 'checkout_session', attributes: { reference_number: this.sessions.get(providerRef)?.reference } },
        },
      },
    };
    return { rawBody: Buffer.from(JSON.stringify(body)), headers: { 'x-test-signature': this.webhookSecret } };
  }
}

const RELAXED_RATE_LIMITS = Object.fromEntries(
  ['lookup', 'deposit', 'withdrawal', 'transfer', 'destination', 'pin', 'quote'].map((name) => [name, { limit: 100000, windowSeconds: 3600 }]),
);

function createHarness({ params = {}, provider = true, relaxRateLimits = true, overrides = {}, start = '2026-03-10T02:00:00Z' } = {}) {
  const clock = new FakeClock(start);
  const db = new FakeFirestore();
  const store = createStore(db);
  const values = { PUBLIC_RETURN_URL: 'https://ikeepz-test.web.app/payment-return.html', ...params };
  const config = loadConfig((name) => values[name], {
    pin: { scrypt: { N: 1024, r: 8, p: 1, keylen: 32 } },
    ...(relaxRateLimits ? { rateLimits: RELAXED_RATE_LIMITS } : {}),
    ...overrides,
  });
  const auth = new FakeAuth(clock);
  const logs = [];
  const logger = {
    info() {},
    warn(...args) {
      logs.push(['warn', ...args]);
    },
    error(...args) {
      logs.push(['error', ...args]);
    },
  };
  const fakeProvider = provider === true ? new FakeProvider() : provider || null;
  const deps = { db, store, auth, clock, config, logger, provider: fakeProvider };
  const api = createApi(deps);
  let keyCounter = 0;

  const h = {
    db,
    store,
    auth,
    clock,
    config,
    logs,
    deps,
    api,
    provider: fakeProvider,

    key() {
      keyCounter += 1;
      return `key_${String(keyCounter).padStart(6, '0')}_${Math.random().toString(36).slice(2, 10)}`;
    },

    call(method, path, { token, body, headers, query, rawBody } = {}) {
      return api.handle({
        method,
        path,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        query,
        body,
        rawBody,
      });
    },

    /** Registers an auth user and (unless bootstrap:false) creates their wallet through the real endpoint. */
    async signup(uid, { email = `${uid}@example.com`, name = null, emailVerified = true, admin = false, bootstrap = true, displayName } = {}) {
      auth.addUser({ uid, email, emailVerified, admin, name });
      const token = auth.issue(uid);
      if (bootstrap) {
        const res = await h.call('POST', '/bootstrap', { token, body: displayName ? { displayName } : {} });
        assert.equal(res.status, 200, JSON.stringify(res.body));
      }
      return { uid, token };
    },

    /** Gives the user a wallet PIN through the real endpoint. */
    async setPin(account, pin = '135790') {
      const res = await h.call('POST', '/security/pin', { token: auth.issue(account.uid), body: { newPin: pin } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return pin;
    },

    /** Credits the wallet through the genuine deposit path (checkout -> provider paid -> verified sync). */
    async fund(account, amountMinor) {
      const created = await h.call('POST', '/wallet/deposits', { token: account.token, body: { amountMinor, idempotencyKey: h.key() } });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      const { tx } = created.body.data;
      fakeProvider.pay(h.db.read(`walletTx/${tx.id}`).providerRef);
      const synced = await h.call('POST', `/wallet/deposits/${tx.id}/sync`, { token: account.token });
      assert.equal(synced.status, 200, JSON.stringify(synced.body));
      assert.equal(synced.body.data.tx.status, 'completed');
      return synced.body.data.tx;
    },

    async addDestination(account, overrides2 = {}) {
      const res = await h.call('POST', '/wallet/destinations', {
        token: account.token,
        body: { kind: 'ewallet', providerName: 'GCash', accountName: 'Juan Dela Cruz', accountNumber: '09171234567', ...overrides2 },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.data.destination;
    },

    wallet(uid) {
      return db.read(`wallets/${uid}`);
    },

    tx(id) {
      return db.read(`walletTx/${id}`);
    },

    revenue(currency = 'PHP') {
      const doc = db.read(`platformRevenue/${currency}`);
      return doc ? doc.collectedMinor : 0;
    },

    notifications(uid) {
      return db.list(`users/${uid}/notifications`).map((entry) => entry.data);
    },

    unexpectedErrors() {
      return logs.filter((entry) => entry[0] === 'error');
    },
  };
  return h;
}

/** Asserts a 200 response and returns `data`. */
function ok(response) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

/** Asserts an error response with the given code (and optionally status / details subset). */
function fails(response, code, details) {
  assert.equal(response.body.error && response.body.error.code, code, JSON.stringify(response.body));
  if (details) {
    for (const [key, value] of Object.entries(details)) assert.deepEqual(response.body.error.details[key], value, `details.${key}`);
  }
  return response.body.error;
}

module.exports = { createHarness, ok, fails, FakeClock, FakeAuth, FakeProvider };
