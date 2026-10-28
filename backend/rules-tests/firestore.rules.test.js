'use strict';

const { test, before, after, beforeEach } = require('node:test');
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, addDoc, serverTimestamp, Timestamp } = require('firebase/firestore');
const { createEnv } = require('./env');

let env;
before(async () => {
  env = await createEnv();
});
after(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anonymous = () => env.unauthenticatedContext().firestore();
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const now = () => Timestamp.now();

const PREFERENCES = {
  theme: 'system', accent: 'slate', fontScale: 'medium', locale: 'en_PH', displayCurrency: 'PHP', autoLockMinutes: 0, notifications: { wallet: true },
};
const USER = {
  uid: 'alice', email: 'alice@example.com', displayName: 'Alice', photoUrl: null, walletCurrency: 'PHP', status: 'active',
  withdrawalsEnabled: true, transfersEnabled: true, kycStatus: 'none', preferences: PREFERENCES, createdAt: now(), updatedAt: now(),
};
const RECORD = () => ({
  kind: 'expense', title: 'Lunch', amountMinor: 25000, currency: 'PHP', categoryId: 'cat1', categoryName: 'Food & dining',
  date: now(), notes: '', tags: ['work'], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
});
const CATEGORY = () => ({ name: 'Food', kind: 'expense', color: 0xffc2410c, icon: 'food', archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

async function seedUser() {
  await seed((db) => setDoc(doc(db, 'users/alice'), USER));
}

// ------------------------------------------------------------------------------------------------ default deny

test('everything not listed is closed, for signed-in and anonymous callers alike', async () => {
  const paths = [
    'walletSecurity/alice', 'destinationSecrets/d1', 'walletCodes/IKZ-ABCD-EFGH', 'idempotency/x', 'rateLimits/x', 'walletDaily/alice_20260310',
    'providerEvents/evt', 'platformRevenue/PHP', 'adminAudit/a1', 'somethingElse/x', 'users/alice/unknown/x',
  ];
  await seed(async (db) => {
    for (const path of paths.filter((p) => p !== 'users/alice/unknown/x')) await setDoc(doc(db, path), { x: 1 });
  });
  for (const db of [as('alice'), anonymous()]) {
    for (const path of paths) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { x: 2 }));
    }
  }
});

// ------------------------------------------------------------------------------------------------ users/{uid}

test('a user can read only their own profile, and cannot create or delete it', async () => {
  await seedUser();
  await assertSucceeds(getDoc(doc(as('alice'), 'users/alice')));
  await assertFails(getDoc(doc(as('bob'), 'users/alice')));
  await assertFails(getDoc(doc(anonymous(), 'users/alice')));
  await assertFails(setDoc(doc(as('bob'), 'users/bob'), USER));
  await assertFails(deleteDoc(doc(as('alice'), 'users/alice')));
});

test('the owner may change the display name, photo and preferences only', async () => {
  await seedUser();
  const ref = () => doc(as('alice'), 'users/alice');
  await assertSucceeds(updateDoc(ref(), { displayName: 'Alice Santos', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(), { photoUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/users%2Falice%2Favatar%2Favatar.jpg?alt=media', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(), { photoUrl: null, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(), { preferences: { ...PREFERENCES, theme: 'dark', accent: 'moss', autoLockMinutes: 15 }, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(), { 'preferences.fontScale': 'large', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('bob'), 'users/alice'), { displayName: 'Mallory', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(anonymous(), 'users/alice'), { displayName: 'Mallory', updatedAt: serverTimestamp() }));
});

test('privileged profile fields cannot be changed by the client', async () => {
  await seedUser();
  const ref = () => doc(as('alice'), 'users/alice');
  for (const patch of [
    { status: 'suspended' }, { withdrawalsEnabled: false }, { transfersEnabled: false }, { kycStatus: 'approved' }, { email: 'x@example.com' },
    { walletCurrency: 'USD' }, { uid: 'bob' }, { createdAt: serverTimestamp() }, { admin: true }, { isAdmin: true },
  ]) {
    await assertFails(updateDoc(ref(), { ...patch, updatedAt: serverTimestamp() }));
  }
});

test('profile updates are validated', async () => {
  await seedUser();
  const ref = () => doc(as('alice'), 'users/alice');
  const bad = [
    { displayName: '' },
    { displayName: 'x'.repeat(61) },
    { displayName: 42 },
    { photoUrl: 'https://evil.example.com/a.png' },
    { photoUrl: 'http://firebasestorage.googleapis.com/a.png' },
    { photoUrl: 'javascript:alert(1)' },
    { preferences: { ...PREFERENCES, theme: 'neon' } },
    { preferences: { ...PREFERENCES, accent: 'red' } },
    { preferences: { ...PREFERENCES, fontScale: 'huge' } },
    { preferences: { ...PREFERENCES, locale: 'de_DE' } },
    { preferences: { ...PREFERENCES, displayCurrency: 'php' } },
    { preferences: { ...PREFERENCES, autoLockMinutes: 121 } },
    { preferences: { ...PREFERENCES, autoLockMinutes: -1 } },
    { preferences: { ...PREFERENCES, autoLockMinutes: 1.5 } },
    { preferences: { ...PREFERENCES, notifications: { wallet: 'yes' } } },
    { preferences: { ...PREFERENCES, notifications: { wallet: true, security: false } } },
    { preferences: { ...PREFERENCES, isAdmin: true } },
    { preferences: { theme: 'dark' } },
    { preferences: 'dark' },
  ];
  for (const patch of bad) await assertFails(updateDoc(ref(), { ...patch, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref(), { displayName: 'Alice B', updatedAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  await assertFails(updateDoc(ref(), { displayName: 'Alice B' }));
});

// ------------------------------------------------------------------------------------------------ records

test('records: the owner can create, read, update and delete their own', async () => {
  const db = as('alice');
  const ref = await assertSucceeds(addDoc(collection(db, 'users/alice/records'), RECORD()));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, { title: 'Dinner', amountMinor: 50000, tags: [], updatedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(query(collection(db, 'users/alice/records'), where('kind', '==', 'expense'))));
  await assertSucceeds(deleteDoc(ref));
});

test('records: nobody else can touch them', async () => {
  await seed((db) => setDoc(doc(db, 'users/alice/records/r1'), { ...RECORD(), createdAt: now(), updatedAt: now() }));
  for (const db of [as('bob'), anonymous()]) {
    await assertFails(getDoc(doc(db, 'users/alice/records/r1')));
    await assertFails(getDocs(collection(db, 'users/alice/records')));
    await assertFails(setDoc(doc(db, 'users/alice/records/r2'), RECORD()));
    await assertFails(updateDoc(doc(db, 'users/alice/records/r1'), { title: 'x', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'users/alice/records/r1')));
  }
});

test('records: invalid data is rejected', async () => {
  const db = as('alice');
  const create = (patch) => addDoc(collection(db, 'users/alice/records'), { ...RECORD(), ...patch });
  for (const patch of [
    { kind: 'transfer' }, { kind: 'Income' },
    { title: '' }, { title: 'x'.repeat(121) }, { title: 5 },
    { amountMinor: 0 }, { amountMinor: -100 }, { amountMinor: 1.5 }, { amountMinor: '100' }, { amountMinor: 10 ** 13 + 1 },
    { currency: 'php' }, { currency: 'PH' }, { currency: 'PHPP' },
    { categoryId: '' }, { categoryId: 7 }, { categoryName: 'x'.repeat(61) }, { categoryName: null },
    { date: '2026-03-10' }, { date: 1700000000 },
    { notes: 'x'.repeat(1001) }, { notes: null },
    { tags: 'work' }, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    { createdAt: Timestamp.fromDate(new Date('2020-01-01')) }, { updatedAt: Timestamp.fromDate(new Date('2020-01-01')) },
    { extra: 'field' },
  ]) {
    await assertFails(create(patch));
  }
  const missing = RECORD();
  delete missing.notes;
  await assertFails(addDoc(collection(db, 'users/alice/records'), missing));
  await assertSucceeds(create({ categoryId: null, categoryName: '', notes: 'x'.repeat(1000), tags: Array.from({ length: 10 }, (_, i) => `t${i}`), amountMinor: 10 ** 13 }));
});

test('records: createdAt is fixed once written', async () => {
  const db = as('alice');
  const ref = await addDoc(collection(db, 'users/alice/records'), RECORD());
  await assertFails(updateDoc(ref, { createdAt: Timestamp.fromDate(new Date('2020-01-01')), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { amountMinor: -5, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { title: 'no timestamp' }));
});

// ------------------------------------------------------------------------------------------------ categories

test('categories: owner CRUD with validation', async () => {
  const db = as('alice');
  const ref = await assertSucceeds(addDoc(collection(db, 'users/alice/categories'), CATEGORY()));
  await assertSucceeds(updateDoc(ref, { name: 'Groceries', icon: 'groceries', color: 0xff2f8f4e, archived: true, updatedAt: serverTimestamp() }));
  const create = (patch) => addDoc(collection(db, 'users/alice/categories'), { ...CATEGORY(), ...patch });
  for (const patch of [
    { name: '' }, { name: 'x'.repeat(61) }, { kind: 'transfer' }, { icon: 'rocket' }, { icon: 5 },
    { color: -1 }, { color: 4294967296 }, { color: 1.5 }, { color: '#fff' }, { archived: 'no' }, { extra: true },
  ]) {
    await assertFails(create(patch));
  }
  for (const kind of ['income', 'expense', 'both']) await assertSucceeds(create({ kind }));
  await assertFails(updateDoc(ref, { createdAt: Timestamp.fromDate(new Date('2020-01-01')), updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(ref));
  await assertFails(addDoc(collection(as('bob'), 'users/alice/categories'), CATEGORY()));
  await assertFails(getDocs(collection(as('bob'), 'users/alice/categories')));
});

// ------------------------------------------------------------------------------------------------ activity

test('activity: append-only, and only as the client', async () => {
  const db = as('alice');
  const entry = (patch = {}) => ({ type: 'record_added', summary: 'Added Lunch', entityType: 'record', entityId: 'r1', source: 'client', createdAt: serverTimestamp(), ...patch });
  const ref = await assertSucceeds(addDoc(collection(db, 'users/alice/activity'), entry()));
  await assertSucceeds(addDoc(collection(db, 'users/alice/activity'), entry({ entityType: null, entityId: null })));
  await assertSucceeds(getDoc(ref));
  await assertFails(updateDoc(ref, { summary: 'edited' }));
  await assertFails(deleteDoc(ref));
  for (const patch of [{ source: 'server' }, { source: 'admin' }, { summary: '' }, { summary: 'x'.repeat(201) }, { type: '' }, { type: 'x'.repeat(41) }, { extra: 1 }, { createdAt: Timestamp.fromDate(new Date('2020-01-01')) }]) {
    await assertFails(addDoc(collection(db, 'users/alice/activity'), entry(patch)));
  }
  await assertFails(addDoc(collection(as('bob'), 'users/alice/activity'), entry()));
  await assertFails(getDoc(doc(as('bob'), ref.path)));
});

// ------------------------------------------------------------------------------------------------ notifications

test('notifications: created by the server, the owner can read, mark as read once, and delete', async () => {
  await seed((db) => setDoc(doc(db, 'users/alice/notifications/n1'), { type: 'deposit_completed', group: 'wallet', title: 'Deposit received', body: 'x', data: {}, readAt: null, createdAt: now() }));
  const ref = () => doc(as('alice'), 'users/alice/notifications/n1');
  await assertFails(addDoc(collection(as('alice'), 'users/alice/notifications'), { type: 'x', group: 'wallet', title: 't', body: 'b', data: {}, readAt: null, createdAt: serverTimestamp() }));
  await assertSucceeds(getDoc(ref()));
  await assertFails(updateDoc(ref(), { title: 'Hacked' }));
  await assertFails(updateDoc(ref(), { readAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  await assertFails(updateDoc(ref(), { readAt: serverTimestamp(), title: 'Hacked' }));
  await assertSucceeds(updateDoc(ref(), { readAt: serverTimestamp() }));
  await assertFails(updateDoc(ref(), { readAt: null }));
  await assertFails(updateDoc(ref(), { readAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(ref()));
  await seed((db) => setDoc(doc(db, 'users/alice/notifications/n2'), { type: 'x', group: 'wallet', title: 't', body: 'b', data: {}, readAt: null, createdAt: now() }));
  await assertFails(getDoc(doc(as('bob'), 'users/alice/notifications/n2')));
  await assertFails(updateDoc(doc(as('bob'), 'users/alice/notifications/n2'), { readAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(as('bob'), 'users/alice/notifications/n2')));
});

// ------------------------------------------------------------------------------------------------ money

test('payout destinations are readable by the owner and never writable', async () => {
  await seed((db) => setDoc(doc(db, 'users/alice/destinations/d1'), { kind: 'ewallet', providerName: 'GCash', accountName: 'Alice', accountNumberMasked: '••••4567', status: 'active', createdAt: now() }));
  await assertSucceeds(getDoc(doc(as('alice'), 'users/alice/destinations/d1')));
  await assertFails(getDoc(doc(as('bob'), 'users/alice/destinations/d1')));
  await assertFails(setDoc(doc(as('alice'), 'users/alice/destinations/d2'), { kind: 'bank', providerName: 'BDO', accountName: 'A', accountNumberMasked: '••••1', status: 'active', createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('alice'), 'users/alice/destinations/d1'), { status: 'removed' }));
  await assertFails(deleteDoc(doc(as('alice'), 'users/alice/destinations/d1')));
});

test('wallets and ledgers are read-only for their owner and invisible to everyone else', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'wallets/alice'), { uid: 'alice', currency: 'PHP', availableMinor: 100, heldMinor: 0, pendingDepositMinor: 0, walletCode: 'IKZ-AAAA-BBBB', status: 'active', version: 1, createdAt: now(), updatedAt: now() });
    await setDoc(doc(db, 'wallets/alice/ledger/e1'), { txId: 'DEP-1', type: 'deposit_credit', deltaAvailableMinor: 100, deltaHeldMinor: 0, balanceAvailableAfterMinor: 100, balanceHeldAfterMinor: 0, currency: 'PHP', seq: 1, createdAt: now() });
  });
  await assertSucceeds(getDoc(doc(as('alice'), 'wallets/alice')));
  await assertSucceeds(getDocs(collection(as('alice'), 'wallets/alice/ledger')));
  await assertFails(getDoc(doc(as('bob'), 'wallets/alice')));
  await assertFails(getDocs(collection(as('bob'), 'wallets/alice/ledger')));
  await assertFails(getDoc(doc(anonymous(), 'wallets/alice')));
  for (const db of [as('alice'), as('bob')]) {
    await assertFails(updateDoc(doc(db, 'wallets/alice'), { availableMinor: 999999999 }));
    await assertFails(setDoc(doc(db, 'wallets/alice'), { availableMinor: 999999999 }));
    await assertFails(deleteDoc(doc(db, 'wallets/alice')));
    await assertFails(setDoc(doc(db, 'wallets/alice/ledger/e2'), { deltaAvailableMinor: 999999999 }));
    await assertFails(deleteDoc(doc(db, 'wallets/alice/ledger/e1')));
  }
  await assertFails(setDoc(doc(as('alice'), 'wallets/mallory'), { availableMinor: 100 }));
});

test('wallet transactions are visible to participants only', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'walletTx/TRF-1'), { reference: 'TRF-1', kind: 'transfer', status: 'completed', amountMinor: 100, ownerUid: 'alice', counterpartyUid: 'bob', participants: ['alice', 'bob'], createdAt: now() });
    await setDoc(doc(db, 'walletTx/TRF-1/events/e1'), { from: null, to: 'completed', at: now(), by: 'user', note: null });
    await setDoc(doc(db, 'walletTx/DEP-9'), { reference: 'DEP-9', kind: 'deposit', status: 'pending', amountMinor: 100, ownerUid: 'carol', counterpartyUid: null, participants: ['carol'], createdAt: now() });
  });
  for (const uid of ['alice', 'bob']) {
    await assertSucceeds(getDoc(doc(as(uid), 'walletTx/TRF-1')));
    await assertSucceeds(getDocs(query(collection(as(uid), 'walletTx'), where('participants', 'array-contains', uid))));
    await assertSucceeds(getDocs(collection(as(uid), 'walletTx/TRF-1/events')));
  }
  await assertFails(getDoc(doc(as('carol'), 'walletTx/TRF-1')));
  await assertFails(getDocs(collection(as('carol'), 'walletTx/TRF-1/events')));
  await assertFails(getDoc(doc(anonymous(), 'walletTx/TRF-1')));
  await assertFails(getDocs(collection(as('alice'), 'walletTx'))); // a query that is not limited to my own transactions is refused
  await assertFails(getDocs(query(collection(as('alice'), 'walletTx'), where('participants', 'array-contains', 'carol'))));
  await assertFails(getDoc(doc(as('alice'), 'walletTx/DEP-9')));
});

test('wallet transactions can never be written by a client, whoever they are', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'walletTx/DEP-1'), { reference: 'DEP-1', kind: 'deposit', status: 'pending', amountMinor: 100, ownerUid: 'alice', participants: ['alice'], createdAt: now() });
  });
  const db = as('alice');
  await assertFails(setDoc(doc(db, 'walletTx/DEP-2'), { reference: 'DEP-2', kind: 'deposit', status: 'completed', amountMinor: 1000000, ownerUid: 'alice', participants: ['alice'] }));
  await assertFails(updateDoc(doc(db, 'walletTx/DEP-1'), { status: 'completed' }));
  await assertFails(deleteDoc(doc(db, 'walletTx/DEP-1')));
  await assertFails(setDoc(doc(db, 'walletTx/DEP-1/events/e9'), { from: 'pending', to: 'completed', at: serverTimestamp(), by: 'user', note: null }));
});
