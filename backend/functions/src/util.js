'use strict';

const crypto = require('node:crypto');

// Unambiguous alphabet (no 0/O, 1/I/L, U) for references and wallet codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** JSON with sorted keys and undefined removed, so equal payloads hash equally. */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function randomString(length, alphabet = ALPHABET) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function newReference(prefix) {
  return `${prefix}-${randomString(12)}`;
}

function newDocId() {
  return randomString(20, ALNUM);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Accepts a Date, a Firestore Timestamp (anything with toDate), an ISO string or epoch millis. */
function toDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Deep-converts dates/timestamps to ISO strings and drops undefined, for API responses. */
function serialize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map((item) => serialize(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const converted = serialize(item);
      if (converted !== undefined) out[key] = converted;
    }
    return out;
  }
  return value;
}

/** YYYYMMDD of `date` in the fixed-offset zone `offsetMinutes` east of UTC. */
function dayKey(date, offsetMinutes) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Single-line text: NFC, control characters removed, whitespace collapsed, trimmed, length-capped. */
function sanitizeText(value, max) {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, max).join('');
}

/** "Juan Dela Cruz" -> "Juan C."; a single word stays as is. */
function maskName(name) {
  const parts = sanitizeText(name, 80).split(' ').filter(Boolean);
  if (parts.length === 0) return 'iKeepZ user';
  if (parts.length === 1) return parts[0];
  const last = Array.from(parts[parts.length - 1])[0];
  return `${parts[0]} ${last.toUpperCase()}.`;
}

/** Keeps only the last four characters: "••••4567". */
function maskAccount(accountNumber) {
  const tail = String(accountNumber).slice(-4);
  return `••••${tail}`;
}

const WALLET_CODE_PATTERN = /^IKZ-[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/;

function newWalletCode() {
  return `IKZ-${randomString(4)}-${randomString(4)}`;
}

/** Normalises user input ("ikz abcd efgh") to the canonical form, or returns null if it cannot be a wallet code. */
function normalizeWalletCode(input) {
  if (typeof input !== 'string') return null;
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 11 || !compact.startsWith('IKZ')) return null;
  const code = `IKZ-${compact.slice(3, 7)}-${compact.slice(7)}`;
  return WALLET_CODE_PATTERN.test(code) ? code : null;
}

module.exports = {
  ALPHABET,
  sha256Hex,
  canonicalJson,
  randomString,
  newReference,
  newDocId,
  safeEqual,
  toDate,
  serialize,
  dayKey,
  sanitizeText,
  maskName,
  maskAccount,
  newWalletCode,
  normalizeWalletCode,
  WALLET_CODE_PATTERN,
};
