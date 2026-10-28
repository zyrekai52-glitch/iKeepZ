'use strict';

// Cloud Functions entry point. Everything with logic lives in ./src and is unit-tested with an in-memory Firestore;
// this file only wires the real Firebase SDKs, parameters and secrets to it.

const { setGlobalOptions } = require('firebase-functions/v2');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const { REGION, DEFAULTS, PARAM_NAMES, loadConfig } = require('./src/config');
const { createStore } = require('./src/store');
const { createProvider } = require('./src/providers');
const { createApi } = require('./src/api');
const { handleWebhook } = require('./src/handlers/webhooks');
const { isApiError } = require('./src/errors');
const { reconcilePendingDeposits, cleanupExpired } = require('./src/scheduled/reconcile');

setGlobalOptions({ region: REGION, maxInstances: 20 });

// Secrets live in Secret Manager. The deploy workflow stores the literal value "unset" when a key is not available yet,
// which keeps deposits disabled without breaking the deployment.
const paymongoSecretKey = defineSecret('PAYMONGO_SECRET_KEY');
const paymongoWebhookSecret = defineSecret('PAYMONGO_WEBHOOK_SECRET');
const secrets = [paymongoSecretKey, paymongoWebhookSecret];

const params = Object.fromEntries(PARAM_NAMES.map((name) => [name, defineString(name, { default: DEFAULTS[name] })]));

let runtime = null;

/** Built lazily on the first invocation of an instance, because parameter and secret values only exist at runtime. */
function getRuntime() {
  if (runtime) return runtime;
  if (getApps().length === 0) initializeApp();
  const config = loadConfig((name) => params[name].value());
  const db = getFirestore();
  const deps = {
    db,
    store: createStore(db),
    auth: getAuth(),
    clock: { now: () => new Date() },
    config,
    logger,
    provider: createProvider({
      secrets: {
        PAYMONGO_SECRET_KEY: paymongoSecretKey.value(),
        PAYMONGO_WEBHOOK_SECRET: paymongoWebhookSecret.value(),
      },
      config,
      logger,
    }),
  };
  runtime = { deps, api: createApi(deps) };
  return runtime;
}

const httpOptions = { secrets, cors: false, invoker: 'public', memory: '256MiB', timeoutSeconds: 60 };

/** The whole REST API (see docs/ARCHITECTURE.md section 4). Reached via Hosting at /api/** or its own URL. */
exports.api = onRequest(httpOptions, (req, res) => getRuntime().api.handleHttp(req, res));

/** Same code path as POST /webhooks/paymongo, on a URL of its own that can be given to PayMongo directly. */
exports.paymongoWebhook = onRequest(httpOptions, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await handleWebhook(getRuntime().deps, { rawBody: req.rawBody, headers: req.headers });
    res.status(200).json({ data: result });
  } catch (error) {
    if (isApiError(error)) {
      res.status(error.status).json(error.toBody());
      return;
    }
    logger.error('Webhook failed', { message: error && error.message });
    res.status(500).json({ error: { code: 'internal', message: 'Webhook processing failed.' } });
  }
});

/** Every 15 minutes: settles or expires pending deposits whose webhook never arrived. */
exports.reconcilePendingDeposits = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Manila', secrets, timeoutSeconds: 300, memory: '256MiB', retryCount: 0 },
  async () => {
    const summary = await reconcilePendingDeposits(getRuntime().deps);
    logger.info('reconcilePendingDeposits finished', summary);
  },
);

/** Daily housekeeping of expired rate-limit / idempotency / webhook-dedupe / daily-limit documents. */
exports.cleanupExpired = onSchedule(
  { schedule: 'every day 03:30', timeZone: 'Asia/Manila', secrets, timeoutSeconds: 300, memory: '256MiB', retryCount: 0 },
  async () => {
    const summary = await cleanupExpired(getRuntime().deps);
    logger.info('cleanupExpired finished', summary);
  },
);
