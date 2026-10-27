'use strict';

// All money is an integer number of minor units (centavos, cents, ...). Fee math uses BigInt.
// Behaviour here is pinned by ../../../test_vectors/money.json, which the Dart client tests share.

const EXPONENTS = {
  PHP: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  SGD: 2,
  AUD: 2,
  CAD: 2,
  HKD: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
};

const MAX_MINOR = 10 ** 13;
const MAX_BALANCE_MINOR = MAX_MINOR;

function isSupportedCurrency(currency) {
  return typeof currency === 'string' && Object.hasOwn(EXPONENTS, currency);
}

function exponentOf(currency) {
  if (!isSupportedCurrency(currency)) throw new Error(`Unsupported currency ${currency}`);
  return EXPONENTS[currency];
}

/** Parses "1,234.50" into minor units. Returns { minor } or { error }. */
function parseMajor(input, currency) {
  const exponent = exponentOf(currency);
  const text = String(input === null || input === undefined ? '' : input)
    .trim()
    .replace(/,/g, '');
  if (text === '') return { error: 'empty' };
  if (text.startsWith('-')) {
    return /^-\d*\.?\d*$/.test(text) && /\d/.test(text) ? { error: 'negative' } : { error: 'invalid' };
  }
  if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) return { error: 'invalid' };
  const [whole = '', fraction = ''] = text.split('.');
  if (fraction.length > exponent) return { error: 'too_many_decimals' };
  const minor = BigInt((whole === '' ? '0' : whole) + fraction.padEnd(exponent, '0'));
  if (minor > BigInt(MAX_MINOR)) return { error: 'too_large' };
  return { minor: Number(minor) };
}

/** 123450 PHP -> "1234.50" (no grouping, used for machine-ish output). */
function formatPlain(minor, currency) {
  const exponent = exponentOf(currency);
  const negative = minor < 0;
  const digits = BigInt(Math.abs(minor)).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? digits.slice(digits.length - exponent) : '';
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;
}

/** 123450 PHP -> "PHP 1,234.50" (used in notification text). */
function formatDisplay(minor, currency) {
  const plain = formatPlain(Math.abs(minor), currency);
  const [whole, fraction] = plain.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 ? '-' : ''}${currency} ${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}

/** fee = round_half_up(amount * bps / 10000) + fixed */
function computeFee(amountMinor, { bps = 0, fixedMinor = 0 } = {}) {
  assertSafeMinor(amountMinor, 'amountMinor');
  const percentage = (BigInt(amountMinor) * BigInt(bps) + 5000n) / 10000n;
  return Number(percentage + BigInt(fixedMinor));
}

function assertSafeMinor(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

module.exports = {
  EXPONENTS,
  MAX_MINOR,
  MAX_BALANCE_MINOR,
  isSupportedCurrency,
  exponentOf,
  parseMajor,
  formatPlain,
  formatDisplay,
  computeFee,
};
