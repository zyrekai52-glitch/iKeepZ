'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPaymongoProvider, interpretSession, interpretWebhook, parseSignatureHeader } = require('../src/providers/paymongo');
const { createFakePaymongo } = require('./helpers/fake-paymongo');

function provider(fake, extra = {}) {
  const logs = [];
  const instance = createPaymongoProvider({
    secretKey: fake.secretKey,
    webhookSecret: fake.webhookSecret,
    paymentMethods: ['gcash', 'card'],
    fetchImpl: fake.fetchImpl,
    logger: { warn: (...args) => logs.push(args), info() {}, error() {} },
    ...extra,
  });
  return { instance, logs };
}

test('interpretSession understands paid, expired, unpaid and payment-intent-only sessions', () => {
  const paid = interpretSession({
    attributes: {
      reference_number: 'DEP-1',
      payments: [
        { id: 'pay_0', attributes: { status: 'failed', amount: 100 } },
        { id: 'pay_1', attributes: { status: 'paid', amount: 102500, currency: 'php', paid_at: 1800000000 } },
      ],
    },
  });
  assert.deepEqual(paid, {
    status: 'paid',
    referenceNumber: 'DEP-1',
    providerPaymentId: 'pay_1',
    amountMinor: 102500,
    currency: 'PHP',
    paidAt: new Date(1800000000 * 1000),
  });

  assert.equal(interpretSession({ attributes: { status: 'expired' } }).status, 'expired');
  assert.equal(interpretSession({ attributes: { status: 'active', payments: [] } }).status, 'unpaid');
  assert.equal(interpretSession({ attributes: { payments: [{ attributes: { status: 'failed', amount: 5 } }] } }).status, 'unpaid');
  assert.equal(interpretSession(null).status, 'unpaid');
  assert.equal(interpretSession({}).status, 'unpaid');

  const viaIntent = interpretSession({ attributes: { payment_intent: { attributes: { status: 'succeeded', amount: 5000, currency: 'PHP' } } } });
  assert.equal(viaIntent.status, 'paid');
  assert.equal(viaIntent.amountMinor, 5000);
  const notYet = interpretSession({ attributes: { payment_intent: { attributes: { status: 'awaiting_payment_method', amount: 5000 } } } });
  assert.equal(notYet.status, 'unpaid');

  const noAmount = interpretSession({ attributes: { payments: [{ id: 'p', attributes: { status: 'paid', amount: '100' } }] } });
  assert.equal(noAmount.status, 'paid');
  assert.equal(noAmount.amountMinor, null, 'a non-integer amount is not trusted');
});

test('interpretWebhook only acts on checkout_session.payment.paid', () => {
  const event = (type, data) => ({ data: { id: 'evt_1', attributes: { type, livemode: true, data } } });
  const paid = interpretWebhook(event('checkout_session.payment.paid', { id: 'cs_1', type: 'checkout_session', attributes: { reference_number: 'DEP-1' } }));
  assert.deepEqual(paid, { eventId: 'evt_1', type: 'payment_paid', rawType: 'checkout_session.payment.paid', checkoutSessionId: 'cs_1', referenceNumber: 'DEP-1', livemode: true });
  assert.equal(interpretWebhook(event('payment.paid', { id: 'pay_1', type: 'payment' })).type, 'other');
  assert.equal(interpretWebhook(event('checkout_session.payment.paid', { id: 'pay_1', type: 'payment' })).type, 'other');
  assert.equal(interpretWebhook(event('source.chargeable', undefined)).checkoutSessionId, null);
  assert.equal(interpretWebhook({}), null);
  assert.equal(interpretWebhook(null), null);
  assert.equal(interpretWebhook({ data: { id: 5, attributes: {} } }), null);
});

test('signature header parsing', () => {
  assert.deepEqual(parseSignatureHeader('t=1,te=abc,li='), { t: '1', te: 'abc', li: '' });
  assert.deepEqual(parseSignatureHeader(undefined), {});
  assert.deepEqual(parseSignatureHeader('garbage'), {});
});

test('verifyWebhook accepts a genuine test or live signature and nothing else', () => {
  const fake = createFakePaymongo();
  const { instance } = provider(fake);
  fake.sessions.set('cs_1', { reference: 'DEP-1' });
  for (const mode of ['te', 'li']) {
    const { rawBody, headers } = fake.webhook('cs_1', { mode });
    assert.equal(instance.verifyWebhook(rawBody, headers), true, mode);
    assert.equal(instance.verifyWebhook(rawBody.toString('utf8'), headers), true, `${mode} as string`);
  }
  const good = fake.webhook('cs_1');
  assert.equal(instance.verifyWebhook(Buffer.from(`${good.rawBody.toString()} `), good.headers), false, 'tampered body');
  assert.equal(instance.verifyWebhook(good.rawBody, {}), false, 'no header');
  assert.equal(instance.verifyWebhook(good.rawBody, { 'paymongo-signature': 'te=abc' }), false, 'no timestamp');
  assert.equal(instance.verifyWebhook(good.rawBody, { 'paymongo-signature': 't=1800000100,te=,li=' }), false, 'empty signatures');
  assert.equal(instance.verifyWebhook(good.rawBody, { 'paymongo-signature': 't=1800000100,te=deadbeef,li=' }), false, 'wrong signature');
  const forged = fake.webhook('cs_1', { secret: 'attacker-secret' });
  assert.equal(instance.verifyWebhook(forged.rawBody, forged.headers), false, 'signed with another secret');
  const replayedTimestamp = { 'paymongo-signature': good.headers['paymongo-signature'].replace('t=1800000100', 't=1800000101') };
  assert.equal(instance.verifyWebhook(good.rawBody, replayedTimestamp), false, 'timestamp is part of the signed text');
});

test('verifyWebhook is false when no webhook secret is configured', () => {
  const fake = createFakePaymongo();
  fake.sessions.set('cs_1', { reference: 'DEP-1' });
  const { rawBody } = fake.webhook('cs_1');
  for (const webhookSecret of [undefined, '', '   ', 'unset', 'UNSET']) {
    const { instance } = provider(fake, { webhookSecret });
    const digest = crypto.createHmac('sha256', webhookSecret || '').update(`1.${rawBody}`).digest('hex');
    assert.equal(instance.verifyWebhook(rawBody, { 'paymongo-signature': `t=1,te=${digest},li=` }), false, String(webhookSecret));
  }
});

test('an unset secret key means not configured', async () => {
  for (const secretKey of [undefined, '', 'unset']) {
    const instance = createPaymongoProvider({ secretKey });
    assert.equal(instance.isConfigured(), false);
    await assert.rejects(instance.fetchPayment('cs_1'), (e) => e.code === 'not_configured');
    await assert.rejects(instance.createCheckout({ reference: 'DEP-1', amountMinor: 100, currency: 'PHP', description: 'x', returnUrl: 'https://x.test/r' }), (e) => e.code === 'not_configured');
  }
});

test('createCheckout sends a correct, authenticated request', async () => {
  const fake = createFakePaymongo();
  const { instance } = provider(fake);
  assert.equal(instance.isConfigured(), true);
  const result = await instance.createCheckout({
    reference: 'DEP-ABC123',
    amountMinor: 102500,
    currency: 'PHP',
    description: 'iKeepZ wallet deposit DEP-ABC123',
    returnUrl: 'https://ikeepz-test.web.app/payment-return.html',
  });
  assert.equal(result.providerRef, 'cs_test_1');
  assert.equal(result.checkoutUrl, 'https://checkout.paymongo.test/cs_test_1');
  assert.deepEqual(result.expiresAt, new Date(1900000000 * 1000));

  const [request] = fake.requests;
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://api.paymongo.com/v1/checkout_sessions');
  assert.equal(request.headers.Authorization, `Basic ${Buffer.from('sk_test_abc123:').toString('base64')}`);
  assert.equal(request.headers['Content-Type'], 'application/json');
  const attributes = request.body.data.attributes;
  assert.equal(attributes.reference_number, 'DEP-ABC123');
  assert.deepEqual(attributes.line_items, [{ currency: 'PHP', amount: 102500, name: 'iKeepZ wallet deposit', quantity: 1 }]);
  assert.deepEqual(attributes.payment_method_types, ['gcash', 'card']);
  assert.equal(attributes.send_email_receipt, false);
  assert.equal(attributes.success_url, 'https://ikeepz-test.web.app/payment-return.html?status=success&ref=DEP-ABC123');
  assert.equal(attributes.cancel_url, 'https://ikeepz-test.web.app/payment-return.html?status=cancelled&ref=DEP-ABC123');
});

test('fetchPayment and expireCheckout hit the right endpoints and map the result', async () => {
  const fake = createFakePaymongo();
  const { instance } = provider(fake);
  const { providerRef } = await instance.createCheckout({ reference: 'DEP-1', amountMinor: 20000, currency: 'PHP', description: 'd', returnUrl: 'https://x.test/r' });
  assert.equal((await instance.fetchPayment(providerRef)).status, 'unpaid');
  fake.pay(providerRef);
  const paid = await instance.fetchPayment(providerRef);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.amountMinor, 20000);
  assert.equal(paid.currency, 'PHP');
  assert.equal(paid.referenceNumber, 'DEP-1');
  assert.equal(paid.providerPaymentId, `pay_${providerRef}`);
  assert.equal(fake.requests[1].method, 'GET');
  assert.ok(fake.requests[1].url.endsWith(`/checkout_sessions/${providerRef}`));

  const second = await instance.createCheckout({ reference: 'DEP-2', amountMinor: 20000, currency: 'PHP', description: 'd', returnUrl: 'https://x.test/r' });
  await instance.expireCheckout(second.providerRef);
  assert.equal(fake.requests.at(-1).method, 'POST');
  assert.ok(fake.requests.at(-1).url.endsWith(`/checkout_sessions/${second.providerRef}/expire`));
  assert.equal((await instance.fetchPayment(second.providerRef)).status, 'expired');
});

test('provider failures become provider_error without leaking the key', async () => {
  const fake = createFakePaymongo();
  const { instance, logs } = provider(fake);
  const attempt = () => instance.createCheckout({ reference: 'DEP-1', amountMinor: 20000, currency: 'PHP', description: 'd', returnUrl: 'https://x.test/r' });

  fake.behaviour.failWith = 400;
  await assert.rejects(attempt(), (e) => e.code === 'provider_error' && e.details.providerStatus === 400);
  fake.behaviour.failWith = 500;
  await assert.rejects(attempt(), (e) => e.code === 'provider_error');
  fake.behaviour.failWith = null;

  fake.behaviour.networkDown = true;
  await assert.rejects(attempt(), (e) => e.code === 'provider_error');
  await assert.rejects(instance.fetchPayment('cs_1'), (e) => e.code === 'provider_error');
  fake.behaviour.networkDown = false;

  fake.behaviour.malformedCreate = true;
  await assert.rejects(attempt(), (e) => e.code === 'provider_error');
  fake.behaviour.malformedCreate = false;

  await assert.rejects(instance.fetchPayment('cs_missing'), (e) => e.code === 'provider_error');

  const wrongKey = createPaymongoProvider({ secretKey: 'sk_test_WRONG', fetchImpl: fake.fetchImpl, logger: { warn: (...args) => logs.push(args) } });
  await assert.rejects(wrongKey.fetchPayment('cs_1'), (e) => e.code === 'provider_error' && e.details.providerStatus === 401);
  assert.ok(!JSON.stringify(logs).includes('sk_test_'), 'keys are never logged');
});

test('a request that hangs is aborted', async () => {
  const instance = createPaymongoProvider({
    secretKey: 'sk_test_abc123',
    timeoutMs: 20,
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
  });
  await assert.rejects(instance.fetchPayment('cs_1'), (e) => e.code === 'provider_error');
});
