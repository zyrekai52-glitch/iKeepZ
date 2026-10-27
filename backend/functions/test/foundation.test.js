'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const money = require('../src/money');
const util = require('../src/util');
const { parse, str, int, oneOf, bool } = require('../src/validation');
const { loadConfig } = require('../src/config');
const { err, STATUS } = require('../src/errors');

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'test_vectors', 'money.json'), 'utf8'));

test('shared money vectors: currency exponents agree', () => {
  for (const [currency, exponent] of Object.entries(vectors.currencies)) {
    assert.equal(money.exponentOf(currency), exponent, currency);
  }
});

test('shared money vectors: parseMajor', () => {
  for (const item of vectors.parse) {
    const result = money.parseMajor(item.input, item.currency);
    if (item.error) {
      assert.deepEqual(result, { error: item.error }, `${item.currency} "${item.input}"`);
    } else {
      assert.deepEqual(result, { minor: item.minor }, `${item.currency} "${item.input}"`);
    }
  }
});

test('shared money vectors: formatPlain', () => {
  for (const item of vectors.format) {
    assert.equal(money.formatPlain(item.minor, item.currency), item.plain, `${item.currency} ${item.minor}`);
  }
});

test('shared money vectors: computeFee rounds half up', () => {
  for (const item of vectors.fee) {
    assert.equal(
      money.computeFee(item.amountMinor, { bps: item.bps, fixedMinor: item.fixedMinor }),
      item.feeMinor,
      JSON.stringify(item),
    );
  }
});

test('formatDisplay groups thousands and keeps the sign', () => {
  assert.equal(money.formatDisplay(123456789, 'PHP'), 'PHP 1,234,567.89');
  assert.equal(money.formatDisplay(-250, 'USD'), '-USD 2.50');
  assert.equal(money.formatDisplay(1500, 'JPY'), 'JPY 1,500');
});

test('computeFee rejects unsafe amounts and handles large values exactly', () => {
  assert.throws(() => money.computeFee(-1, { bps: 10 }));
  assert.throws(() => money.computeFee(1.5, { bps: 10 }));
  assert.equal(money.computeFee(9_000_000_000_000, { bps: 10000 }), 9_000_000_000_000);
});

test('unsupported currencies throw', () => {
  assert.throws(() => money.exponentOf('XXX'));
  assert.throws(() => money.exponentOf('constructor'));
  assert.equal(money.isSupportedCurrency('PHP'), true);
  assert.equal(money.isSupportedCurrency('php'), false);
});

test('canonicalJson ignores key order and undefined', () => {
  assert.equal(util.canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(util.requestHashEqual, undefined);
  assert.equal(util.sha256Hex('abc').length, 64);
});

test('maskName and maskAccount', () => {
  assert.equal(util.maskName('Juan Dela Cruz'), 'Juan C.');
  assert.equal(util.maskName('  maria   santos '), 'maria S.');
  assert.equal(util.maskName('Juan'), 'Juan');
  assert.equal(util.maskName(''), 'iKeepZ user');
  assert.equal(util.maskName(null), 'iKeepZ user');
  assert.equal(util.maskAccount('09171234567'), '••••4567');
});

test('wallet codes normalise from sloppy input', () => {
  const code = util.newWalletCode();
  assert.match(code, util.WALLET_CODE_PATTERN);
  assert.equal(util.normalizeWalletCode(code.toLowerCase().replace(/-/g, ' ')), code);
  assert.equal(util.normalizeWalletCode(code.replace(/-/g, '')), code);
  assert.equal(util.normalizeWalletCode('IKZ-ABCD'), null);
  assert.equal(util.normalizeWalletCode('XXX-ABCD-EFGH'), null);
  assert.equal(util.normalizeWalletCode('IKZ-ABCO-EFGH'), null, 'O is not in the alphabet');
  assert.equal(util.normalizeWalletCode(42), null);
});

test('dayKey follows the configured offset', () => {
  const instant = new Date('2026-03-01T17:30:00Z');
  assert.equal(util.dayKey(instant, 0), '20260301');
  assert.equal(util.dayKey(instant, 480), '20260302');
  assert.equal(util.dayKey(instant, -600), '20260301');
});

test('sanitizeText strips control characters and collapses whitespace', () => {
  assert.equal(util.sanitizeText('  a\u0000b \n\t c  ', 20), 'a b c');
  assert.equal(util.sanitizeText('abcdef', 3), 'abc');
  assert.equal(util.sanitizeText(5, 3), '');
});

test('serialize converts Dates and timestamp-likes and drops undefined', () => {
  const out = util.serialize({ a: new Date('2026-01-01T00:00:00Z'), b: { toDate: () => new Date(0) }, c: [undefined, 1], d: undefined, e: null });
  assert.deepEqual(out, { a: '2026-01-01T00:00:00.000Z', b: '1970-01-01T00:00:00.000Z', c: [undefined, 1], e: null });
});

test('safeEqual compares in constant time shape and handles length differences', () => {
  assert.equal(util.safeEqual('abc', 'abc'), true);
  assert.equal(util.safeEqual('abc', 'abd'), false);
  assert.equal(util.safeEqual('abc', 'abcd'), false);
});

test('validation: types, bounds, unknown and missing fields', () => {
  const schema = {
    name: str({ min: 2, max: 5 }),
    amount: int({ min: 1, max: 10 }),
    kind: oneOf(['a', 'b']),
    flag: bool({ optional: true }),
    note: str({ optional: true, nullable: true, max: 3 }),
  };
  assert.deepEqual(parse(schema, { name: ' abc ', amount: 3, kind: 'a' }), {
    name: 'abc',
    amount: 3,
    kind: 'a',
    flag: undefined,
    note: undefined,
  });
  assert.equal(parse(schema, { name: 'abc', amount: 3, kind: 'a', note: null }).note, null);
  const fails = (body, field) => {
    assert.throws(
      () => parse(schema, body),
      (e) => e.code === 'invalid_argument' && e.details.field === field,
      JSON.stringify(body),
    );
  };
  fails({ name: 'a', amount: 3, kind: 'a' }, 'name');
  fails({ name: 'abcdef', amount: 3, kind: 'a' }, 'name');
  fails({ name: 'abc', amount: 3.5, kind: 'a' }, 'amount');
  fails({ name: 'abc', amount: '3', kind: 'a' }, 'amount');
  fails({ name: 'abc', amount: 11, kind: 'a' }, 'amount');
  fails({ name: 'abc', amount: 0, kind: 'a' }, 'amount');
  fails({ name: 'abc', amount: 3, kind: 'z' }, 'kind');
  fails({ name: 'abc', amount: 3, kind: 'a', extra: 1 }, 'extra');
  fails({ name: 'abc', amount: 3 }, 'kind');
  fails({ name: 'abc', amount: 3, kind: 'a', flag: 'yes' }, 'flag');
  fails({ name: 'abc', amount: 3, kind: 'a', note: 'abcd' }, 'note');
  fails({}, 'name');
  assert.throws(() => parse(schema, [1]), (e) => e.code === 'invalid_argument');
  assert.throws(() => parse(schema, 'x'), (e) => e.code === 'invalid_argument');
});

test('config defaults match the documented ones', () => {
  const config = loadConfig();
  assert.deepEqual(config.walletCurrencies, ['PHP']);
  assert.equal(config.limits.deposit.min, 10000);
  assert.equal(config.limits.deposit.max, 5000000);
  assert.equal(config.limits.dailyOutMinor, 10000000);
  assert.equal(config.limitTzOffsetMinutes, 480);
  assert.equal(config.pin.maxAttempts, 5);
  assert.equal(config.pin.lockMinutes, 15);
  assert.equal(config.requireKycForWithdrawal, false);
  assert.equal(config.fees.transfer.bps, 0);
  assert.equal(config.publicReturnUrl, '');
  assert.deepEqual(config.paymentMethods, ['gcash', 'paymaya', 'card']);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.limits.deposit), true);
});

test('config reads overrides and rejects invalid values', () => {
  const config = loadConfig((name) => ({ WALLET_CURRENCIES: 'php, usd', DEPOSIT_FEE_BPS: '250', REQUIRE_KYC_FOR_WITHDRAWAL: 'true', PUBLIC_RETURN_URL: 'https://x.web.app/payment-return.html' })[name]);
  assert.deepEqual(config.walletCurrencies, ['PHP', 'USD']);
  assert.equal(config.fees.deposit.bps, 250);
  assert.equal(config.requireKycForWithdrawal, true);
  const bad = (values, pattern) => assert.throws(() => loadConfig((name) => values[name]), pattern);
  bad({ WALLET_CURRENCIES: 'XYZ' }, /unsupported currency/);
  bad({ DEPOSIT_MIN_MINOR: '5000', DEPOSIT_MAX_MINOR: '100' }, /must not exceed/);
  bad({ DEPOSIT_FEE_BPS: '10001' }, /between 0 and 10000/);
  bad({ DEPOSIT_FEE_BPS: 'abc' }, /whole number/);
  bad({ PIN_MAX_ATTEMPTS: '1' }, /between 3 and 20/);
  bad({ PUBLIC_RETURN_URL: 'http://insecure.example/x' }, /https/);
  bad({ PUBLIC_RETURN_URL: 'not a url' }, /absolute https URL/);
  bad({ REQUIRE_KYC_FOR_WITHDRAWAL: 'maybe' }, /true or false/);
});

test('errors map to the documented HTTP statuses', () => {
  assert.equal(err('pin_locked', 'x').status, 423);
  assert.equal(err('insufficient_funds', 'x').status, 409);
  assert.equal(err('not_configured', 'x').status, 503);
  assert.equal(err('provider_error', 'x').status, 502);
  assert.equal(err('resource_exhausted', 'x').status, 429);
  assert.deepEqual(err('not_found', 'gone', { a: 1 }).toBody(), { error: { code: 'not_found', message: 'gone', details: { a: 1 } } });
  assert.deepEqual(err('not_found', 'gone', {}).toBody(), { error: { code: 'not_found', message: 'gone' } });
  assert.throws(() => err('made_up', 'x'));
  for (const status of Object.values(STATUS)) assert.ok(status >= 400 && status < 600);
});
