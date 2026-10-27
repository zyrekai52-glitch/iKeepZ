'use strict';

const { err } = require('../errors');
const { parse, str } = require('../validation');
const { sanitizeText, newWalletCode, serialize } = require('../util');
const { queueActivity } = require('../effects');

// Icon keys and colours are a fixed set shared with the Flutter client and the Firestore rules.
const DEFAULT_CATEGORIES = [
  { name: 'Salary', kind: 'income', color: 0xff2f8f4e, icon: 'salary' },
  { name: 'Business', kind: 'income', color: 0xff3f6a85, icon: 'business' },
  { name: 'Gifts', kind: 'income', color: 0xffb7791f, icon: 'gift' },
  { name: 'Other income', kind: 'income', color: 0xff6b7580, icon: 'wallet' },
  { name: 'Food & dining', kind: 'expense', color: 0xffc2410c, icon: 'food' },
  { name: 'Transport', kind: 'expense', color: 0xff0e7490, icon: 'transport' },
  { name: 'Bills & utilities', kind: 'expense', color: 0xff7c3aed, icon: 'bills' },
  { name: 'Shopping', kind: 'expense', color: 0xffbe185d, icon: 'shopping' },
  { name: 'Health', kind: 'expense', color: 0xffc53030, icon: 'health' },
  { name: 'Education', kind: 'expense', color: 0xff4d7c0f, icon: 'education' },
  { name: 'Entertainment', kind: 'expense', color: 0xffa16207, icon: 'entertainment' },
  { name: 'Other', kind: 'expense', color: 0xff6b7580, icon: 'other' },
];

function displayNameFor(input, user) {
  const candidates = [input.displayName, user.name, user.email ? user.email.split('@')[0] : null];
  for (const candidate of candidates) {
    const cleaned = sanitizeText(candidate || '', 60);
    if (cleaned) return cleaned;
  }
  return 'iKeepZ user';
}

/** Creates the user profile, wallet, wallet code and default categories once. Safe to call on every sign-in. */
async function bootstrap(ctx) {
  const { deps, user } = ctx;
  const { store, clock, config } = deps;
  const input = parse({ displayName: str({ max: 60, optional: true }), currency: str({ min: 3, max: 3, optional: true }) }, ctx.body, {
    allowEmpty: true,
  });
  const currency = (input.currency || config.walletCurrencies[0]).toUpperCase();
  if (!config.walletCurrencies.includes(currency)) {
    throw err('invalid_argument', 'That currency is not available.', { field: 'currency', allowed: config.walletCurrencies });
  }
  const displayName = displayNameFor(input, user);

  const result = await store.db.runTransaction(async (tx) => {
    const userSnapshot = await tx.get(store.user(user.uid));
    const walletSnapshot = await tx.get(store.wallet(user.uid));
    if (userSnapshot.exists && walletSnapshot.exists) return { user: userSnapshot.data(), wallet: walletSnapshot.data() };
    if (userSnapshot.exists !== walletSnapshot.exists) {
      throw new Error(`Inconsistent account state for ${user.uid}: user=${userSnapshot.exists} wallet=${walletSnapshot.exists}`);
    }

    let walletCode = null;
    for (let attempt = 0; attempt < 8 && walletCode === null; attempt += 1) {
      const candidate = newWalletCode();
      const taken = await tx.get(store.walletCode(candidate));
      if (!taken.exists) walletCode = candidate;
    }
    if (walletCode === null) throw new Error('Could not allocate a wallet code');

    const now = clock.now();
    const userDoc = {
      uid: user.uid,
      email: user.email || '',
      displayName,
      photoUrl: null,
      walletCurrency: currency,
      status: 'active',
      withdrawalsEnabled: true,
      transfersEnabled: true,
      kycStatus: 'none',
      preferences: {
        theme: 'system',
        accent: 'slate',
        fontScale: 'medium',
        locale: 'en_PH',
        displayCurrency: currency,
        autoLockMinutes: 0,
        notifications: { wallet: true },
      },
      createdAt: now,
      updatedAt: now,
    };
    const walletDoc = {
      uid: user.uid,
      currency,
      availableMinor: 0,
      heldMinor: 0,
      pendingDepositMinor: 0,
      walletCode,
      status: 'active',
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(store.user(user.uid), userDoc);
    tx.create(store.wallet(user.uid), walletDoc);
    tx.create(store.walletCode(walletCode), { uid: user.uid, createdAt: now });
    for (const category of DEFAULT_CATEGORIES) {
      tx.create(store.categories(user.uid).doc(), { ...category, archived: false, createdAt: now, updatedAt: now });
    }
    queueActivity(tx, store, user.uid, { type: 'account_created', summary: 'Account created', now });
    return { user: userDoc, wallet: walletDoc };
  });

  return { user: serialize(result.user), wallet: serialize(result.wallet) };
}

module.exports = { bootstrap, DEFAULT_CATEGORIES };
