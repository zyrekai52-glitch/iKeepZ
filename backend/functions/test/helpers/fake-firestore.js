'use strict';

// In-memory stand-in for the subset of the Firestore Admin SDK that the backend uses.
//
// It deliberately reproduces the behaviours that matter for money code:
//   * transactions use optimistic concurrency: if a document read in the transaction changes before commit, the
//     callback is run again (up to maxAttempts), exactly like the real SDK;
//   * every read yields to the event loop, so concurrent transactions genuinely interleave in tests;
//   * a transaction that reads after it has written throws, as the real SDK does;
//   * create() fails on existing documents, update() fails on missing ones, undefined values are rejected;
//   * Dates are stored as Timestamp-like objects (with toDate/toMillis) and come back that way.

class FakeTimestamp {
  constructor(ms) {
    this._ms = ms;
  }

  get seconds() {
    return Math.floor(this._ms / 1000);
  }

  get nanoseconds() {
    return (this._ms % 1000) * 1e6;
  }

  toDate() {
    return new Date(this._ms);
  }

  toMillis() {
    return this._ms;
  }

  isEqual(other) {
    return other instanceof FakeTimestamp && other._ms === this._ms;
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function firestoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof FakeTimestamp);
}

function encode(value, path = '') {
  if (value === undefined) throw new Error(`Firestore rejects undefined at ${path || '<root>'}; use null`);
  if (value === null) return null;
  if (value instanceof Date) return new FakeTimestamp(value.getTime());
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value._ms);
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`);
      return value;
    case 'string':
    case 'boolean':
      return value;
    case 'object':
      if (Array.isArray(value)) return value.map((item, index) => encode(item, `${path}[${index}]`));
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item, `${path}.${key}`)]));
    default:
      throw new Error(`Unsupported value type ${typeof value} at ${path}`);
  }
}

function cloneEncoded(value) {
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value._ms);
  if (Array.isArray(value)) return value.map(cloneEncoded);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneEncoded(item)]));
  return value;
}

/** Test convenience: FakeTimestamp -> Date, deep. */
function plain(value) {
  if (value instanceof FakeTimestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(plain);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}

function normalize(value) {
  if (value instanceof FakeTimestamp) return value._ms;
  if (value instanceof Date) return value.getTime();
  return value;
}

function deepEqual(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

function compareValues(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  const rank = (value) => {
    if (value === null) return 0;
    if (typeof value === 'boolean') return 1;
    if (typeof value === 'number') return 2;
    if (typeof value === 'string') return 3;
    return 4;
  };
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function getField(data, fieldPath) {
  let current = data;
  for (const part of fieldPath.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function randomId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 20; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function mergeDeep(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeDeep(out[key], value) : value;
  }
  return out;
}

class DocumentSnapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this._data = data;
  }

  get exists() {
    return this._data !== null;
  }

  data() {
    return this._data === null ? undefined : cloneEncoded(this._data);
  }

  get(fieldPath) {
    return this._data === null ? undefined : cloneEncoded(getField(this._data, fieldPath));
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
  }

  get empty() {
    return this.docs.length === 0;
  }

  get size() {
    return this.docs.length;
  }

  forEach(callback) {
    this.docs.forEach(callback);
  }
}

class Query {
  constructor(db, collectionPath, spec = {}) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.spec = { filters: [], orders: [], limit: null, cursor: null, ...spec };
  }

  _with(patch) {
    return new Query(this.db, this.collectionPath, { ...this.spec, ...patch });
  }

  where(field, op, value) {
    if (!['==', '!=', '<', '<=', '>', '>=', 'array-contains', 'in'].includes(op)) throw new Error(`Unsupported operator ${op}`);
    return this._with({ filters: [...this.spec.filters, { field, op, value }] });
  }

  orderBy(field, direction = 'asc') {
    return this._with({ orders: [...this.spec.orders, { field, direction }] });
  }

  limit(count) {
    return this._with({ limit: count });
  }

  startAfter(snapshot) {
    return this._with({ cursor: snapshot });
  }

  async get() {
    await tick();
    return new QuerySnapshot(this.db._runQuery(this));
  }
}

class CollectionReference extends Query {
  constructor(db, path) {
    super(db, path);
    this.path = path;
  }

  get id() {
    return this.path.split('/').pop();
  }

  doc(id) {
    return new DocumentReference(this.db, `${this.path}/${id === undefined ? randomId() : id}`);
  }

  async add(data) {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

class DocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').pop();
  }

  collection(name) {
    return new CollectionReference(this.db, `${this.path}/${name}`);
  }

  async get() {
    await tick();
    return this.db._snapshot(this);
  }

  async set(data, options) {
    await tick();
    this.db._apply([{ op: 'set', ref: this, data: encode(data), merge: Boolean(options && options.merge) }]);
  }

  async create(data) {
    await tick();
    this.db._apply([{ op: 'create', ref: this, data: encode(data) }]);
  }

  async update(data) {
    await tick();
    this.db._apply([{ op: 'update', ref: this, data: checkUpdate(data) }]);
  }

  async delete() {
    await tick();
    this.db._apply([{ op: 'delete', ref: this }]);
  }
}

function checkUpdate(data) {
  for (const key of Object.keys(data)) {
    if (key.includes('.')) throw new Error(`The fake does not support dotted field paths (${key}); update whole top-level fields`);
  }
  return encode(data);
}

class Transaction {
  constructor(db) {
    this.db = db;
    this.reads = new Map();
    this.writes = [];
  }

  async get(target) {
    if (this.writes.length > 0) {
      throw new Error('Firestore transactions require all reads to be executed before all writes.');
    }
    await tick();
    if (target instanceof DocumentReference) {
      const snapshot = this.db._snapshot(target);
      this.reads.set(target.path, this.db._version(target.path));
      return snapshot;
    }
    const docs = this.db._runQuery(target);
    for (const doc of docs) this.reads.set(doc.ref.path, this.db._version(doc.ref.path));
    return new QuerySnapshot(docs);
  }

  create(ref, data) {
    this.writes.push({ op: 'create', ref, data: encode(data) });
    return this;
  }

  set(ref, data, options) {
    this.writes.push({ op: 'set', ref, data: encode(data), merge: Boolean(options && options.merge) });
    return this;
  }

  update(ref, data) {
    this.writes.push({ op: 'update', ref, data: checkUpdate(data) });
    return this;
  }

  delete(ref) {
    this.writes.push({ op: 'delete', ref });
    return this;
  }
}

class WriteBatch {
  constructor(db) {
    this.db = db;
    this.ops = [];
  }

  create(ref, data) {
    this.ops.push({ op: 'create', ref, data: encode(data) });
    return this;
  }

  set(ref, data, options) {
    this.ops.push({ op: 'set', ref, data: encode(data), merge: Boolean(options && options.merge) });
    return this;
  }

  update(ref, data) {
    this.ops.push({ op: 'update', ref, data: checkUpdate(data) });
    return this;
  }

  delete(ref) {
    this.ops.push({ op: 'delete', ref });
    return this;
  }

  async commit() {
    await tick();
    this.db._apply(this.ops);
  }
}

class FakeFirestore {
  constructor() {
    this._docs = new Map(); // path -> { data: object | null, version: number }
    this.stats = { commits: 0, retries: 0 };
    /** Test hook: called right before a transaction validates its reads (use it to force a conflict). */
    this.beforeCommit = null;
  }

  collection(path) {
    return new CollectionReference(this, path);
  }

  doc(path) {
    return new DocumentReference(this, path);
  }

  batch() {
    return new WriteBatch(this);
  }

  _version(path) {
    const entry = this._docs.get(path);
    return entry ? entry.version : 0;
  }

  _snapshot(ref) {
    const entry = this._docs.get(ref.path);
    return new DocumentSnapshot(ref, entry && entry.data !== null ? cloneEncoded(entry.data) : null);
  }

  _runQuery(query) {
    const { collectionPath } = query;
    const { filters, orders, limit, cursor } = query.spec;
    const prefix = `${collectionPath}/`;
    let docs = [];
    for (const [path, entry] of this._docs) {
      if (entry.data === null || !path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
      docs.push(new DocumentSnapshot(new DocumentReference(this, path), cloneEncoded(entry.data)));
    }
    docs = docs.filter((doc) => filters.every((filter) => matchesFilter(doc._data, filter)));
    docs = docs.filter((doc) => orders.every((order) => getField(doc._data, order.field) !== undefined));
    const compare = (a, b) => {
      for (const order of orders) {
        const result = compareValues(getField(a._data, order.field), getField(b._data, order.field));
        if (result !== 0) return order.direction === 'desc' ? -result : result;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    };
    docs.sort(compare);
    if (cursor) docs = docs.filter((doc) => compare(doc, cursor) > 0);
    if (limit !== null) docs = docs.slice(0, limit);
    return docs;
  }

  _apply(ops) {
    // Validate every precondition first so the whole write set is all-or-nothing.
    const pending = new Map();
    const current = (path) => (pending.has(path) ? pending.get(path) : (this._docs.get(path) || { data: null }).data);
    for (const op of ops) {
      const { path } = op.ref;
      const existing = current(path);
      if (op.op === 'create') {
        if (existing !== null) throw firestoreError(6, `ALREADY_EXISTS: ${path}`);
        pending.set(path, op.data);
      } else if (op.op === 'update') {
        if (existing === null) throw firestoreError(5, `NOT_FOUND: ${path}`);
        pending.set(path, { ...existing, ...op.data });
      } else if (op.op === 'set') {
        pending.set(path, op.merge && existing !== null ? mergeDeep(existing, op.data) : op.data);
      } else if (op.op === 'delete') {
        pending.set(path, null);
      }
    }
    for (const [path, data] of pending) {
      this._docs.set(path, { data: data === null ? null : cloneEncoded(data), version: this._version(path) + 1 });
    }
    this.stats.commits += 1;
  }

  async runTransaction(callback, options = {}) {
    const maxAttempts = options.maxAttempts || 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const transaction = new Transaction(this);
      const result = await callback(transaction);
      await tick();
      if (this.beforeCommit) await this.beforeCommit(attempt, transaction);
      let conflict = false;
      for (const [path, version] of transaction.reads) {
        if (this._version(path) !== version) {
          conflict = true;
          break;
        }
      }
      if (conflict) {
        this.stats.retries += 1;
        continue;
      }
      this._apply(transaction.writes);
      return result;
    }
    throw firestoreError(10, 'ABORTED: too much contention on these documents');
  }

  // ---- test helpers ----------------------------------------------------------------------------------------------

  /** Writes a document directly (bypassing everything), e.g. to arrange state. */
  seed(path, data) {
    this._docs.set(path, { data: encode(data), version: this._version(path) + 1 });
  }

  /** Plain-object view (timestamps as Dates) of one document or null. */
  read(path) {
    const entry = this._docs.get(path);
    return entry && entry.data !== null ? plain(entry.data) : null;
  }

  /** All documents directly under a collection path as [{ id, path, data }], sorted by path. */
  list(collectionPath) {
    const prefix = `${collectionPath}/`;
    const out = [];
    for (const [path, entry] of this._docs) {
      if (entry.data === null || !path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
      out.push({ id: path.slice(prefix.length), path, data: plain(entry.data) });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }
}

function matchesFilter(data, { field, op, value }) {
  const actual = getField(data, field);
  if (actual === undefined) return false;
  switch (op) {
    case '==':
      return deepEqual(actual, value);
    case '!=':
      return !deepEqual(actual, value);
    case 'array-contains':
      return Array.isArray(actual) && actual.some((item) => deepEqual(item, value));
    case 'in':
      return Array.isArray(value) && value.some((item) => deepEqual(actual, item));
    default: {
      if (actual === null || value === null) return false;
      const result = compareValues(actual, value);
      if (op === '<') return result < 0;
      if (op === '<=') return result <= 0;
      if (op === '>') return result > 0;
      return result >= 0;
    }
  }
}

module.exports = { FakeFirestore, FakeTimestamp };
