'use strict';

const { err } = require('./errors');

// A tiny strict schema validator for request bodies.
//   const input = parse({ amountMinor: int({ min: 1 }), note: str({ max: 140, optional: true }) }, body);
// Unknown fields are rejected; optional fields that are absent come back as undefined (null when `nullable`).

function str(options = {}) {
  return { type: 'string', min: 0, max: 1000, trim: true, optional: false, nullable: false, ...options };
}

function int(options = {}) {
  return {
    type: 'int',
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    optional: false,
    nullable: false,
    ...options,
  };
}

function oneOf(values, options = {}) {
  return { type: 'enum', values, optional: false, nullable: false, ...options };
}

function bool(options = {}) {
  return { type: 'bool', optional: false, nullable: false, ...options };
}

function bad(field, message) {
  return err('invalid_argument', message, { field });
}

function check(field, spec, value) {
  switch (spec.type) {
    case 'string': {
      if (typeof value !== 'string') throw bad(field, `${field} must be text`);
      const text = spec.trim ? value.trim() : value;
      if (Array.from(text).length < spec.min) throw bad(field, `${field} is too short`);
      if (Array.from(text).length > spec.max) throw bad(field, `${field} is too long`);
      if (spec.pattern && !spec.pattern.test(text)) throw bad(field, `${field} is not valid`);
      return text;
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw bad(field, `${field} must be a whole number`);
      if (value < spec.min) throw bad(field, `${field} is too small`);
      if (value > spec.max) throw bad(field, `${field} is too large`);
      return value;
    }
    case 'enum': {
      if (typeof value !== 'string' || !spec.values.includes(value)) throw bad(field, `${field} is not valid`);
      return value;
    }
    case 'bool': {
      if (typeof value !== 'boolean') throw bad(field, `${field} must be true or false`);
      return value;
    }
    default:
      throw new Error(`Unknown spec type ${spec.type}`);
  }
}

function parse(schema, input, { allowEmpty = false } = {}) {
  let body = input;
  if (body === undefined || body === null) body = {};
  if (typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
    throw err('invalid_argument', 'The request body must be a JSON object.');
  }
  if (!allowEmpty && Object.keys(schema).length > 0 && Object.keys(body).length === 0) {
    const required = Object.keys(schema).filter((key) => !schema[key].optional);
    if (required.length > 0) throw bad(required[0], `${required[0]} is required`);
  }
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(schema, key)) throw bad(key, `Unexpected field ${key}`);
  }
  const out = {};
  for (const [field, spec] of Object.entries(schema)) {
    const value = body[field];
    if (value === undefined) {
      if (!spec.optional) throw bad(field, `${field} is required`);
      out[field] = undefined;
      continue;
    }
    if (value === null) {
      if (spec.nullable) {
        out[field] = null;
        continue;
      }
      if (spec.optional) {
        out[field] = undefined;
        continue;
      }
      throw bad(field, `${field} is required`);
    }
    out[field] = check(field, spec, value);
  }
  return out;
}

const IDEMPOTENCY_KEY = str({ min: 16, max: 64, pattern: /^[A-Za-z0-9_-]+$/ });

module.exports = { str, int, oneOf, bool, parse, IDEMPOTENCY_KEY };
