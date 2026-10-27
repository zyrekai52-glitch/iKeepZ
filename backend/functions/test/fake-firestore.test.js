'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore } = require('./helpers/fake-firestore');

test('basic document operations behave like Firestore', async () => {
  const db = new FakeFirestore();
  const ref = db.collection('things').doc('a');
  assert.equal((await ref.get()).exists, false);
  assert.equal((await ref.get()).data(), undefined);
  await ref.create({ n: 1, when: new Date('2026-01-01T00:00:00Z'), nested: { x: 1, y: 2 } });
  await assert.rejects(ref.create({ n: 2 }), (e) => e.code === 6);
  await ref.update({ n: 2 });
  const snap = await ref.get();
  assert.equal(snap.data().n, 2);
  assert.equal(snap.data().when.toDate().toISOString(), '2026-01-01T00:00:00.000Z');
  await ref.set({ nested: { x: 9 } }, { merge: true });
  assert.deepEqual((await ref.get()).data().nested, { x: 9, y: 2 });
  await ref.delete();
  await assert.rejects(ref.update({ n: 3 }), (e) => e.code === 5);
  await assert.rejects(db.collection('things').doc('b').set({ bad: undefined }), /undefined/);
});

test('queries filter, order, limit and page', async () => {
  const db = new FakeFirestore();
  for (let i = 1; i <= 6; i += 1) {
    await db.collection('c').doc(`d${i}`).set({ n: i, parity: i % 2 === 0 ? 'even' : 'odd', tags: [`t${i % 3}`], at: new Date(2026, 0, i) });
  }
  await db.collection('c/d1/sub').doc('s').set({ n: 100 });
  const ids = (snap) => snap.docs.map((d) => d.id);
  assert.deepEqual(ids(await db.collection('c').where('parity', '==', 'even').orderBy('n', 'desc').get()), ['d6', 'd4', 'd2']);
  assert.deepEqual(ids(await db.collection('c').where('n', '>=', 3).where('n', '<', 6).orderBy('n').get()), ['d3', 'd4', 'd5']);
  assert.deepEqual(ids(await db.collection('c').where('tags', 'array-contains', 't0').orderBy('n').get()), ['d3', 'd6']);
  assert.deepEqual(ids(await db.collection('c').where('n', 'in', [2, 5, 9]).orderBy('n').get()), ['d2', 'd5']);
  assert.deepEqual(ids(await db.collection('c').where('at', '>', new Date(2026, 0, 4)).orderBy('at').get()), ['d5', 'd6']);
  const first = await db.collection('c').orderBy('n').limit(2).get();
  assert.deepEqual(ids(first), ['d1', 'd2']);
  const second = await db.collection('c').orderBy('n').startAfter(first.docs[1]).limit(2).get();
  assert.deepEqual(ids(second), ['d3', 'd4']);
  assert.equal((await db.collection('c').get()).size, 6, 'sub-collection documents are not part of the parent collection');
  assert.equal((await db.collection('c').where('missing', '==', 1).get()).empty, true);
});

test('transactions require reads before writes', async () => {
  const db = new FakeFirestore();
  const ref = db.collection('c').doc('a');
  await assert.rejects(
    db.runTransaction(async (tx) => {
      tx.set(ref, { n: 1 });
      await tx.get(ref);
    }),
    /all reads to be executed before all writes/,
  );
});

test('a transaction retries when a document it read changes', async () => {
  const db = new FakeFirestore();
  const ref = db.collection('c').doc('a');
  await ref.set({ n: 1 });
  let runs = 0;
  let interfered = false;
  db.beforeCommit = async () => {
    if (!interfered) {
      interfered = true;
      await ref.update({ n: 10 });
    }
  };
  await db.runTransaction(async (tx) => {
    runs += 1;
    const snap = await tx.get(ref);
    tx.update(ref, { n: snap.data().n + 1 });
  });
  assert.equal(runs, 2);
  assert.equal(db.read('c/a').n, 11);
  assert.equal(db.stats.retries, 1);
});

test('concurrent read-modify-write transactions do not lose updates', async () => {
  const db = new FakeFirestore();
  const ref = db.collection('c').doc('counter');
  await ref.set({ n: 0 });
  await Promise.all(
    Array.from({ length: 20 }, () =>
      db.runTransaction(
        async (tx) => {
          const snap = await tx.get(ref);
          tx.update(ref, { n: snap.data().n + 1 });
        },
        { maxAttempts: 50 },
      ),
    ),
  );
  assert.equal(db.read('c/counter').n, 20);
});

test('transaction aborts with ABORTED after too many conflicts and applies nothing', async () => {
  const db = new FakeFirestore();
  const ref = db.collection('c').doc('a');
  await ref.set({ n: 1 });
  db.beforeCommit = async () => {
    await ref.update({ n: Math.random() });
  };
  await assert.rejects(
    db.runTransaction(async (tx) => {
      await tx.get(ref);
      tx.set(db.collection('c').doc('side'), { x: 1 });
    }),
    (e) => e.code === 10,
  );
  assert.equal(db.read('c/side'), null);
});

test('a failing write rolls back the whole transaction', async () => {
  const db = new FakeFirestore();
  await db.collection('c').doc('exists').set({ n: 1 });
  await assert.rejects(
    db.runTransaction(async (tx) => {
      tx.set(db.collection('c').doc('new'), { n: 1 });
      tx.create(db.collection('c').doc('exists'), { n: 2 });
    }),
    (e) => e.code === 6,
  );
  assert.equal(db.read('c/new'), null);
  assert.equal(db.read('c/exists').n, 1);
});

test('errors thrown in the callback are not retried and nothing is written', async () => {
  const db = new FakeFirestore();
  let runs = 0;
  await assert.rejects(
    db.runTransaction(async (tx) => {
      runs += 1;
      tx.set(db.collection('c').doc('a'), { n: 1 });
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(runs, 1);
  assert.equal(db.read('c/a'), null);
});

test('batches are atomic', async () => {
  const db = new FakeFirestore();
  await db.collection('c').doc('x').set({ n: 1 });
  const batch = db.batch();
  batch.set(db.collection('c').doc('y'), { n: 2 });
  batch.create(db.collection('c').doc('x'), { n: 3 });
  await assert.rejects(batch.commit(), (e) => e.code === 6);
  assert.equal(db.read('c/y'), null);
});
