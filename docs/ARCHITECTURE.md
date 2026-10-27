# iKeepZ — Architecture & Contracts

This file is the single source of truth shared by the Flutter client (`lib/`), the Firebase backend
(`backend/`) and the CI pipeline (`.github/`). If code and this file disagree, fix one of them.

## 1. Overview

```
Flutter app (Android + Windows)
   │  Firebase Auth (email/password)           ← identity
   │  Cloud Firestore (rules-protected)         ← records, categories, settings (client CRUD)
   │                                              wallet, ledger, wallet transactions (READ ONLY for client)
   │  Firebase Storage                          ← profile photo only
   └─ HTTPS API  (Cloud Function `api`)         ← every privileged/financial operation
                 Bearer <Firebase ID token>
Cloud Functions (Node 22, CommonJS, firebase-functions v2 API)
   ├─ api            HTTPS router, all endpoints below
   ├─ paymongoWebhook  public webhook (HMAC-verified), same code path as POST /webhooks/paymongo
   └─ reconcilePendingDeposits   scheduled (every 15 min)
```

Principles
* The client **never** writes wallet, ledger, wallet-transaction, destination, PIN or notification-creation data.
* Money is always an integer in **minor units** (`amountMinor`) plus an ISO-4217 `currency`. No floating point
  anywhere in money arithmetic (server uses `BigInt` for fee math; client uses `int`).
* Every balance change = one Firestore transaction that (a) re-reads the wallet, (b) checks invariants,
  (c) writes the new balance, (d) appends an immutable ledger entry, (e) writes/updates the wallet transaction and
  its event, (f) records the idempotency key. All-or-nothing.
* Nothing is credited because the user *says* they paid. Deposits are credited only after a signature-verified
  provider webhook **and** a server-side fetch of the checkout session from the provider confirms
  `paid` with matching amount + currency (or the same fetch triggered by `/sync` / the scheduler).
* If a capability is not configured (no provider keys, backend not deployed) the app shows it as unavailable.
  There are no fake balances, fake payments or fake backend responses anywhere.

## 2. Configuration contract

### 2.1 Client (`--dart-define-from-file=config/app_config.json`, git-ignored; template: `config/app_config.example.json`)
| key | meaning |
|---|---|
| `FIREBASE_API_KEY` | Web API key of the Firebase project |
| `FIREBASE_PROJECT_ID` | project id |
| `FIREBASE_MESSAGING_SENDER_ID` | sender id |
| `FIREBASE_STORAGE_BUCKET` | e.g. `my-proj.firebasestorage.app` |
| `FIREBASE_APP_ID_ANDROID` | Android app id (`1:123:android:abc…`) for package `com.ikeepz.app` |
| `FIREBASE_APP_ID_WINDOWS` | app id of a *Web* app registered in the same project (desktop SDK uses web config) |
| `FIREBASE_AUTH_DOMAIN` | optional, `my-proj.firebaseapp.com` |
| `API_BASE_URL` | e.g. `https://asia-southeast1-my-proj.cloudfunctions.net/api` (no trailing slash) |
| `SUPPORT_EMAIL` | optional; Help screen hides “Email support” when empty |
| `PRIVACY_URL` | optional |
| `RELEASES_URL` | optional; About screen shows “View releases” when set |

`Firebase.initializeApp(options: FirebaseOptions(...))` is built in Dart from these values — no `google-services.json`,
no FlutterFire CLI. If `FIREBASE_API_KEY`/`FIREBASE_PROJECT_ID` are empty the app shows a **Configuration required**
screen listing the missing keys instead of crashing.

### 2.2 Backend (Cloud Functions)
Secrets (Secret Manager via `defineSecret`): `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`.
Plain params (functions `.env` / `defineString`, all optional with defaults):

| param | default | meaning |
|---|---|---|
| `PUBLIC_RETURN_URL` | `""` | https URL of `backend/public/payment-return.html` (Hosting). Deposits are disabled when empty |
| `WALLET_CURRENCIES` | `PHP` | comma list of currencies new wallets may use (PayMongo checkout supports PHP only) |
| `DEPOSIT_MIN_MINOR` / `DEPOSIT_MAX_MINOR` | `10000` / `5000000` | per-operation limits (minor units, applied to every wallet currency; PHP 100.00 – 50,000.00) |
| `WITHDRAW_MIN_MINOR` / `WITHDRAW_MAX_MINOR` | `10000` / `5000000` | |
| `TRANSFER_MIN_MINOR` / `TRANSFER_MAX_MINOR` | `100` / `5000000` | |
| `DAILY_OUT_LIMIT_MINOR` | `10000000` | withdrawals + transfers out per local day per user |
| `LIMIT_TZ_OFFSET_MINUTES` | `480` | defines “day” for daily limits (Asia/Manila) |
| `DEPOSIT_FEE_BPS` `DEPOSIT_FEE_FIXED_MINOR` | `0` `0` | fee charged **on top of** the amount at checkout |
| `WITHDRAW_FEE_BPS` `WITHDRAW_FEE_FIXED_MINOR` | `0` `0` | fee deducted from wallet in addition to the amount |
| `TRANSFER_FEE_BPS` `TRANSFER_FEE_FIXED_MINOR` | `0` `0` | fee deducted from the sender in addition to the amount |
| `PIN_MAX_ATTEMPTS` / `PIN_LOCK_MINUTES` | `5` / `15` | |
| `REQUIRE_KYC_FOR_WITHDRAWAL` | `false` | when true, `users/{uid}.kycStatus` must be `approved` |

Fee rounding: `fee = round_half_up(amount * bps / 10000) + fixed` computed with BigInt.
Function region constant: `asia-southeast1` (edit in `functions/src/config.js`).

## 3. Firestore data model

All timestamps are Firestore `Timestamp`. `uid` = Firebase Auth uid.

```
users/{uid}                         (server creates in /bootstrap; client may update ONLY displayName, photoUrl, preferences, updatedAt)
  uid, email, displayName, photoUrl|null, walletCurrency, status('active'|'suspended'),
  withdrawalsEnabled(bool), transfersEnabled(bool), kycStatus('none'|'pending'|'approved'|'rejected'),
  preferences: { theme('system'|'light'|'dark'), accent('slate'|'sage'|'clay'|'moss'|'stone'|'dusk'),
                 fontScale('small'|'medium'|'large'), locale('en_PH'|'en_US'|'en_GB'|'fil_PH'),
                 displayCurrency(ISO), autoLockMinutes(int 0..120, 0=off),
                 notifications:{ wallet(bool) } }                   (security notifications are always on)
  createdAt, updatedAt
users/{uid}/records/{id}            (client CRUD)
  kind('income'|'expense'), title(1..120), amountMinor(int>0), currency(ISO), categoryId|null, categoryName(<=60),
  date(Timestamp), notes(<=1000), tags(list<=10, each<=30), createdAt, updatedAt
users/{uid}/categories/{id}         (client CRUD)
  name(1..60), kind('income'|'expense'|'both'), color(int ARGB), icon(key from a fixed set), archived(bool), createdAt, updatedAt
users/{uid}/activity/{id}           (append-only; client creates source:'client', server creates source:'server')
  type(string<=40), summary(<=200), entityType|null, entityId|null, source('client'|'server'), createdAt
users/{uid}/notifications/{id}      (server creates; client may update ONLY readAt, may delete)
  type, group('wallet'|'security'), title, body, data(map), readAt|null, createdAt
users/{uid}/destinations/{id}       (server-written, owner read)
  kind('bank'|'ewallet'), providerName(<=40), accountName(<=80), accountNumberMasked('••••1234'), status('active'|'removed'), createdAt
wallets/{uid}                       (server-written, owner read)
  currency, availableMinor, heldMinor, pendingDepositMinor, walletCode, status('active'|'frozen'), version, createdAt, updatedAt
wallets/{uid}/ledger/{entryId}      (server-written, immutable, owner read)
  txId, type('deposit_credit'|'withdrawal_hold'|'withdrawal_release'|'withdrawal_settle'|'transfer_out'|'transfer_in'|'reversal_debit'|'reversal_credit'),
  deltaAvailableMinor, deltaHeldMinor, balanceAvailableAfterMinor, balanceHeldAfterMinor, currency, createdAt
walletTx/{txId}                     (txId == reference; server-written; read if request.auth.uid in participants)
  reference, kind('deposit'|'withdrawal'|'transfer'|'reversal'), status, amountMinor, feeMinor, totalMinor, currency,
  ownerUid, counterpartyUid|null, participants[uid], directions{uid:'credit'|'debit'},
  ownerDisplay, counterpartyDisplay|null (masked names like "Juan D."),
  destinationId|null, destinationSummary|null ("GCash ••••1234"), provider|null, providerRef|null, checkoutUrl|null (pending deposits only),
  note|null, failureReason|null, payoutReference|null, reversesTxId|null, reversedByTxId|null,
  createdAt, updatedAt, completedAt|null
walletTx/{txId}/events/{id}         (server-written; participants may read)  from, to, at, by('system'|'user'|'admin'|'provider'), note
```
Server-only collections (rules: `allow read, write: if false` for clients):
`walletSecurity/{uid}` (PIN hash `scrypt`, salt, failedAttempts, lockedUntil, updatedAt),
`destinationSecrets/{destId}` (ownerUid, full accountNumber), `walletCodes/{code}` → `{uid}`,
`idempotency/{sha256(uid|op|key)}` (uid, op, requestHash, txId, createdAt), `rateLimits/{key}`,
`walletDaily/{uid_YYYYMMDD}` (outMinor), `providerEvents/{providerEventId}` (webhook dedupe),
`platformRevenue/{currency}` (collectedMinor), `adminAudit/{id}`.

### Status machines
* deposit: `pending` → `completed` | `failed` | `expired` | `cancelled` ; `completed` → `reversed`
* withdrawal: `pending_review` → `approved` → `completed` ; `pending_review` → `rejected` | `cancelled` ; `approved` → `failed`
* transfer: created directly as `completed` (atomic) ; may become `reversed`
* reversal: created as `completed`

### Ledger invariants (tested)
1. `availableMinor >= 0`, `heldMinor >= 0`, `pendingDepositMinor >= 0` at all times.
2. `sum(ledger.deltaAvailableMinor) == availableMinor` and `sum(ledger.deltaHeldMinor) == heldMinor` per wallet.
3. Each balance change writes exactly one ledger entry per affected wallet in the same transaction.
4. A transaction can credit/debit at most once (status guard inside the transaction).
5. Pending deposits never appear in `availableMinor`; they are tracked in `pendingDepositMinor`.
6. Money is conserved: transfers move `amount` between wallets and `fee` to `platformRevenue/{currency}`.

## 4. HTTP API (`api` function)

Base: `API_BASE_URL`. JSON in/out. Auth: `Authorization: Bearer <Firebase ID token>` (verified with `checkRevoked=true`).
Success: HTTP 200 `{ "data": … }`. Error: `{ "error": { "code": "<snake_case>", "message": "<safe text>", "details"?: {} } }`.

| HTTP | codes |
|---|---|
| 400 | `invalid_argument` |
| 401 | `unauthenticated` |
| 403 | `permission_denied`, `email_not_verified`, `account_suspended`, `feature_disabled`, `pin_required`, `step_up_required`, `kyc_required` |
| 404 | `not_found` |
| 409 | `conflict`, `idempotency_conflict`, `insufficient_funds`, `limit_exceeded`, `invalid_state` |
| 423 | `pin_locked` (details.lockedUntil ISO) |
| 429 | `resource_exhausted` |
| 502 | `provider_error` |
| 503 | `not_configured` (e.g. no payment provider) |
| 500 | `internal` (message is generic; details are logged server-side only) |

Dates in API responses are ISO-8601 UTC strings. Transactions are returned in the same shape as `walletTx` docs
(`id` added, Timestamps → ISO strings, `checkoutUrl` only for the owner).

| Endpoint | Auth | Body → Response `data` |
|---|---|---|
| `GET /health` | none | `{ok, version, time, capabilities:{deposits, withdrawals, transfers, provider|null, walletCurrencies[], limits{depositMin,depositMax,withdrawMin,withdrawMax,transferMin,transferMax,dailyOut}, fees{deposit{bps,fixedMinor},withdrawal{…},transfer{…}}, requireKyc}}` — `deposits` is true only when provider secrets **and** `PUBLIC_RETURN_URL` are configured |
| `POST /bootstrap` | user | `{displayName?, currency?}` → `{user, wallet}`; idempotent; creates user, wallet (currency fixed at creation, must be in `WALLET_CURRENCIES`), walletCode, default categories, first activity entry |
| `POST /wallet/quote` | user, verified | `{kind:'deposit'|'withdrawal'|'transfer', amountMinor}` → `{amountMinor, feeMinor, totalMinor, currency, minMinor, maxMinor, remainingDailyMinor|null}` (deposit: `totalMinor` = what the user pays at checkout; withdrawal/transfer: `totalMinor` = debited from wallet) |
| `POST /wallet/deposits` | user, verified | `{amountMinor, idempotencyKey}` → `{tx, checkoutUrl}` — creates `pending` tx, increments `pendingDepositMinor`, creates provider checkout session for `totalMinor` |
| `POST /wallet/deposits/{id}/sync` | owner | → `{tx}` — fetches the session from the provider; credits if paid & matching; marks failed/expired otherwise |
| `POST /wallet/deposits/{id}/cancel` | owner | → `{tx}` — only while `pending` and provider reports no payment |
| `POST /wallet/destinations` | user, verified | `{kind, providerName, accountName, accountNumber}` → `{destination}` (masked) ; max 5 active |
| `DELETE /wallet/destinations/{id}` | owner | → `{ok:true}` (soft remove; blocked while a withdrawal to it is pending) |
| `POST /wallet/withdrawals` | user, verified, PIN | `{destinationId, amountMinor, pin, idempotencyKey}` → `{tx}` (`pending_review`, funds moved available→held) |
| `POST /wallet/withdrawals/{id}/cancel` | owner | → `{tx}` (`pending_review` only; releases hold) |
| `POST /wallet/transfers/lookup` | user, verified | `{walletCode}` → `{walletCode, displayName(masked), currency}` ; 404 if unknown/own code |
| `POST /wallet/transfers` | user, verified, PIN | `{walletCode, amountMinor, note?, pin, idempotencyKey}` → `{tx}` (`completed`) |
| `GET /security/status` | user | → `{pinSet, pinLockedUntil|null, emailVerified, authTime}` |
| `POST /security/pin` | user, verified, step-up (`auth_time` ≤ 5 min) | `{newPin, currentPin?}` (currentPin required if a PIN exists) → `{ok:true}`; PIN = exactly 6 digits |
| `POST /security/revoke-sessions` | user | → `{ok:true}` (revokes refresh tokens) |
| `POST /webhooks/paymongo` | signature | PayMongo event → `{received:true}` always 200 after signature check (even for duplicates/unknown events) |
| `GET /admin/withdrawals?status=&limit=` | admin | → `{items:[{tx, userEmail, destination:{kind,providerName,accountName,accountNumber}}]}` |
| `POST /admin/withdrawals/{id}/approve` | admin | → `{tx}` |
| `POST /admin/withdrawals/{id}/reject` | admin | `{reason}` → `{tx}` (releases hold) |
| `POST /admin/withdrawals/{id}/complete` | admin | `{payoutReference}` → `{tx}` (settles held funds) |
| `POST /admin/withdrawals/{id}/fail` | admin | `{reason}` → `{tx}` (releases hold) |
| `POST /admin/transactions/{id}/reverse` | admin | `{reason}` → `{tx}` (deposit/transfer only; fails with `insufficient_funds` if the credited party already spent it) |
| `GET /admin/reconcile` | admin | → `{walletsChecked, mismatches:[{uid, field, expected, actual}], platformRevenue:{CUR:n}}` |

Admin = custom claim `admin: true` (set with `backend/scripts/set-admin.js` or the `set-admin` GitHub workflow). Every admin action writes `adminAudit/{id}`.

Rate limits (fixed window per uid, stored in `rateLimits`): lookups 20/10 min, deposits 10/h, withdrawals 5/h, transfers 20/h,
destinations 10/day, PIN set/change 5/h, quote 60/h. PIN verification failures: 5 → locked 15 min.

Idempotency: `idempotencyKey` is 16–64 chars `[A-Za-z0-9_-]`. Same key + same payload ⇒ the original result is returned
(no second debit/credit). Same key + different payload ⇒ `409 idempotency_conflict`.
The client keeps the key in secure storage until it has the response, so an app restart replays the same key.

Notifications (server-created, respect `preferences.notifications.wallet`; security ones always sent):
`deposit_completed`, `deposit_failed`, `withdrawal_requested`, `withdrawal_approved`, `withdrawal_rejected`,
`withdrawal_completed`, `withdrawal_failed`, `transfer_sent`, `transfer_received`, `pin_changed`, `sessions_revoked`.
`data` always contains `txId` when applicable.

## 5. Provider integration (PayMongo, pluggable)
`functions/src/providers/index.js` exposes `{name, isConfigured(), createCheckout({txId, reference, amountMinor, currency, description, email, returnUrl}), fetchPayment(providerRef), verifyWebhook(rawBody, headers), parseWebhook(body)}`.
PayMongo adapter: Checkout Sessions (`POST https://api.paymongo.com/v1/checkout_sessions`, HTTP Basic with the secret key),
`GET /v1/checkout_sessions/{id}` for verification, webhook header `Paymongo-Signature: t=…,te=…,li=…`
(HMAC-SHA256 hex of `"{t}.{rawBody}"` with the webhook secret; `li` for live-mode events, `te` for test-mode; timing-safe compare).
Webhook handling: verify signature → dedupe on event id → extract checkout-session id → **re-fetch the session from PayMongo** →
require paid + amount == `totalMinor` + currency match → credit in a transaction guarded by `status == 'pending'`.
Real money movement still requires the owner’s PayMongo merchant approval; with test keys only test payments occur.
Withdrawals are **not** auto-paid: they require admin approval and the admin marks them completed after paying out manually or via a payout
provider integration that the owner must add (documented, not simulated).

## 6. Client architecture (`lib/`)
```
main.dart                 runApp(ProviderScope(child: IKeepZApp()))
app/                      app.dart (MaterialApp.router), bootstrap.dart (real init), router.dart (GoRouter + guards), shell.dart (responsive scaffold)
config/                   app_config.dart (dart-define values), firebase_options.dart (built from config)
core/                     money/, utils/, errors/
models/                   plain immutable Dart classes with fromMap/toMap
services/                 api_client.dart, auth_service.dart, secure_store.dart, settings_store.dart, export_service.dart
repositories/             records, categories, wallet, notifications, activity, profile
providers/                Riverpod providers
theme/                    tokens, light/dark ThemeData, accents
shared/                   reusable widgets (cards, dialogs, empty/error/loading, charts, money text, paged lists …)
features/<section>/       startup, authentication, dashboard, analytics, records, categories, reports, ewallet, notifications,
                          profile, security, settings, support, about, admin
```
State: Riverpod 3 (`Notifier`, `StreamProvider`, `FutureProvider`). Routing: GoRouter with `redirect` driven by a real `AuthState`
(initializing → unauthenticated → needsVerification → authenticated; plus `locked`). Startup screen is shown until Firebase init, preferences
load and the first auth-state event are all complete — never on a timer.
Responsive: width ≥ 900 → permanent sidebar; 600–899 → collapsed rail; < 600 → bottom navigation (5 primary) + drawer for the rest.

## 7. Security rules summary
Firestore: default deny. Owner-only access to everything under `users/{uid}` with field/type/size validation on writes;
`wallets`, `walletTx`, ledger, destinations: owner/participant read-only; server-only collections fully denied.
Storage: only `users/{uid}/avatar/*`, owner read/write, `image/(jpeg|png|webp)`, < 2 MiB.

## 8. Testing strategy
* Backend: `node --test` with an in-memory Firestore fake (transaction/retry semantics) — ledger invariants, idempotency, concurrency
  races, webhook signatures, PIN lockout, fee/limit math. Rules tests (`@firebase/rules-unit-testing`) run in CI against the emulator.
* Shared vectors: `test_vectors/money.json` is consumed by both Node and Dart tests so both sides agree on parsing/formatting/fees.
* Client: `flutter analyze`, `flutter test` (unit + widget), run in CI on every push.
* Release: CI builds APKs per ABI and the Windows release and uploads them as artifacts.
