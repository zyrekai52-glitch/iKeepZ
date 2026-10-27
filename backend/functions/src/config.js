'use strict';

const { isSupportedCurrency } = require('./money');

const REGION = 'asia-southeast1';
const VERSION = require('../package.json').version;

// Every parameter is optional; see backend/functions/.env.example.
const DEFAULTS = {
  PUBLIC_RETURN_URL: '',
  WALLET_CURRENCIES: 'PHP',
  DEPOSIT_MIN_MINOR: '10000',
  DEPOSIT_MAX_MINOR: '5000000',
  WITHDRAW_MIN_MINOR: '10000',
  WITHDRAW_MAX_MINOR: '5000000',
  TRANSFER_MIN_MINOR: '100',
  TRANSFER_MAX_MINOR: '5000000',
  DAILY_OUT_LIMIT_MINOR: '10000000',
  LIMIT_TZ_OFFSET_MINUTES: '480',
  DEPOSIT_FEE_BPS: '0',
  DEPOSIT_FEE_FIXED_MINOR: '0',
  WITHDRAW_FEE_BPS: '0',
  WITHDRAW_FEE_FIXED_MINOR: '0',
  TRANSFER_FEE_BPS: '0',
  TRANSFER_FEE_FIXED_MINOR: '0',
  PIN_MAX_ATTEMPTS: '5',
  PIN_LOCK_MINUTES: '15',
  REQUIRE_KYC_FOR_WITHDRAWAL: 'false',
  PAYMENT_METHODS: 'gcash,paymaya,card',
};

const PARAM_NAMES = Object.keys(DEFAULTS);

// Fixed-window rate limits per user (see docs/ARCHITECTURE.md section 4).
const RATE_LIMITS = Object.freeze({
  lookup: { limit: 20, windowSeconds: 600 },
  deposit: { limit: 10, windowSeconds: 3600 },
  withdrawal: { limit: 5, windowSeconds: 3600 },
  transfer: { limit: 20, windowSeconds: 3600 },
  destination: { limit: 10, windowSeconds: 86400 },
  pin: { limit: 5, windowSeconds: 3600 },
  quote: { limit: 60, windowSeconds: 3600 },
});

function integer(name, raw, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${name} must be a whole number (got "${raw}")`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max} (got ${raw})`);
  }
  return value;
}

function boolean(name, raw) {
  const text = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no', ''].includes(text)) return false;
  throw new Error(`${name} must be true or false (got "${raw}")`);
}

/**
 * Builds the immutable runtime configuration. `read(name)` returns the raw parameter value or undefined/'' to use the
 * default. Throws a descriptive Error for invalid values so a bad deployment fails loudly at cold start.
 */
function loadConfig(read = () => undefined, overrides = {}) {
  const get = (name) => {
    const value = read(name);
    return value === undefined || value === null || String(value).trim() === '' ? DEFAULTS[name] : String(value).trim();
  };

  const currencies = get('WALLET_CURRENCIES')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (currencies.length === 0) throw new Error('WALLET_CURRENCIES must list at least one currency');
  for (const currency of currencies) {
    if (!isSupportedCurrency(currency)) throw new Error(`WALLET_CURRENCIES contains unsupported currency ${currency}`);
  }

  const returnUrl = get('PUBLIC_RETURN_URL');
  if (returnUrl !== '') {
    let parsed;
    try {
      parsed = new URL(returnUrl);
    } catch {
      throw new Error('PUBLIC_RETURN_URL must be an absolute https URL');
    }
    if (parsed.protocol !== 'https:') throw new Error('PUBLIC_RETURN_URL must use https');
  }

  const range = (minName, maxName) => {
    const min = integer(minName, get(minName), { min: 1, max: 1e12 });
    const max = integer(maxName, get(maxName), { min: 1, max: 1e12 });
    if (min > max) throw new Error(`${minName} must not exceed ${maxName}`);
    return { min, max };
  };
  const fee = (bpsName, fixedName) => ({
    bps: integer(bpsName, get(bpsName), { min: 0, max: 10000 }),
    fixedMinor: integer(fixedName, get(fixedName), { min: 0, max: 1e9 }),
  });

  const paymentMethods = get('PAYMENT_METHODS')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (paymentMethods.length === 0) throw new Error('PAYMENT_METHODS must list at least one method');

  const config = {
    region: REGION,
    version: VERSION,
    publicReturnUrl: returnUrl,
    walletCurrencies: currencies,
    limits: {
      deposit: range('DEPOSIT_MIN_MINOR', 'DEPOSIT_MAX_MINOR'),
      withdrawal: range('WITHDRAW_MIN_MINOR', 'WITHDRAW_MAX_MINOR'),
      transfer: range('TRANSFER_MIN_MINOR', 'TRANSFER_MAX_MINOR'),
      dailyOutMinor: integer('DAILY_OUT_LIMIT_MINOR', get('DAILY_OUT_LIMIT_MINOR'), { min: 1, max: 1e13 }),
    },
    limitTzOffsetMinutes: integer('LIMIT_TZ_OFFSET_MINUTES', get('LIMIT_TZ_OFFSET_MINUTES'), { min: -720, max: 840 }),
    fees: {
      deposit: fee('DEPOSIT_FEE_BPS', 'DEPOSIT_FEE_FIXED_MINOR'),
      withdrawal: fee('WITHDRAW_FEE_BPS', 'WITHDRAW_FEE_FIXED_MINOR'),
      transfer: fee('TRANSFER_FEE_BPS', 'TRANSFER_FEE_FIXED_MINOR'),
    },
    pin: {
      maxAttempts: integer('PIN_MAX_ATTEMPTS', get('PIN_MAX_ATTEMPTS'), { min: 3, max: 20 }),
      lockMinutes: integer('PIN_LOCK_MINUTES', get('PIN_LOCK_MINUTES'), { min: 1, max: 1440 }),
      scrypt: { N: 16384, r: 8, p: 1, keylen: 32 },
    },
    requireKycForWithdrawal: boolean('REQUIRE_KYC_FOR_WITHDRAWAL', get('REQUIRE_KYC_FOR_WITHDRAWAL')),
    paymentMethods,
    rateLimits: RATE_LIMITS,
    depositStaleMinutes: 30,
    depositExpireHours: 26,
    retention: { rateLimitDays: 2, idempotencyDays: 30, providerEventDays: 30, dailyDays: 7 },
  };

  return deepFreeze(mergeOverrides(config, overrides));
}

function mergeOverrides(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object'
        ? mergeOverrides(base[key], value)
        : value;
  }
  return out;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

module.exports = { REGION, VERSION, DEFAULTS, PARAM_NAMES, RATE_LIMITS, loadConfig };
