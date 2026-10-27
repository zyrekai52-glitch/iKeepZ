'use strict';

const { err, isApiError } = require('./errors');
const { authenticate, requireVerified, requireAdmin } = require('./auth');
const { Router } = require('./router');

const { health } = require('./handlers/health');
const { bootstrap } = require('./handlers/bootstrap');
const { quote } = require('./handlers/quote');
const { createDeposit, syncDeposit, cancelDeposit } = require('./handlers/deposits');
const { addDestination, removeDestination } = require('./handlers/destinations');
const { createWithdrawal, cancelWithdrawal } = require('./handlers/withdrawals');
const { lookupWallet, createTransfer } = require('./handlers/transfers');
const { securityStatus, changePin, revokeSessions } = require('./handlers/security');
const { paymongoWebhook } = require('./handlers/webhooks');
const { listWithdrawals, withdrawalAction, reverseTransaction, reconcile } = require('./handlers/admin');

// auth: 'none' | 'user' | 'admin';  verified: the caller's email must be verified.
const ROUTES = [
  ['GET', '/health', { auth: 'none' }, health],
  ['POST', '/bootstrap', { auth: 'user' }, bootstrap],
  ['POST', '/wallet/quote', { auth: 'user', verified: true }, quote],
  ['POST', '/wallet/deposits', { auth: 'user', verified: true }, createDeposit],
  ['POST', '/wallet/deposits/:id/sync', { auth: 'user', verified: true }, syncDeposit],
  ['POST', '/wallet/deposits/:id/cancel', { auth: 'user', verified: true }, cancelDeposit],
  ['POST', '/wallet/destinations', { auth: 'user', verified: true }, addDestination],
  ['DELETE', '/wallet/destinations/:id', { auth: 'user', verified: true }, removeDestination],
  ['POST', '/wallet/withdrawals', { auth: 'user', verified: true }, createWithdrawal],
  ['POST', '/wallet/withdrawals/:id/cancel', { auth: 'user', verified: true }, cancelWithdrawal],
  ['POST', '/wallet/transfers/lookup', { auth: 'user', verified: true }, lookupWallet],
  ['POST', '/wallet/transfers', { auth: 'user', verified: true }, createTransfer],
  ['GET', '/security/status', { auth: 'user' }, securityStatus],
  ['POST', '/security/pin', { auth: 'user', verified: true }, changePin],
  ['POST', '/security/revoke-sessions', { auth: 'user' }, revokeSessions],
  ['POST', '/webhooks/paymongo', { auth: 'none' }, paymongoWebhook],
  ['GET', '/admin/withdrawals', { auth: 'admin' }, listWithdrawals],
  ['POST', '/admin/withdrawals/:id/approve', { auth: 'admin' }, withdrawalAction('approve')],
  ['POST', '/admin/withdrawals/:id/reject', { auth: 'admin' }, withdrawalAction('reject')],
  ['POST', '/admin/withdrawals/:id/complete', { auth: 'admin' }, withdrawalAction('complete')],
  ['POST', '/admin/withdrawals/:id/fail', { auth: 'admin' }, withdrawalAction('fail')],
  ['POST', '/admin/transactions/:id/reverse', { auth: 'admin' }, reverseTransaction],
  ['GET', '/admin/reconcile', { auth: 'admin' }, reconcile],
];

/**
 * deps: { db, store, auth, clock, config, provider, logger }.
 * Returns { handle(request) -> { status, body }, handleHttp(req, res) } (the latter for Express-style runtimes).
 */
function createApi(deps) {
  const router = new Router();
  for (const [method, pattern, options, handler] of ROUTES) router.add(method, pattern, options, handler);

  async function handle(request) {
    try {
      const matched = router.match(String(request.method || 'GET').toUpperCase(), request.path);
      if (!matched) throw err('not_found', 'Unknown endpoint.');
      const { route, params } = matched;
      const headers = request.headers || {};
      const ctx = {
        deps,
        params,
        query: request.query || {},
        body: request.body,
        rawBody: request.rawBody,
        headers,
        user: null,
      };
      if (route.options.auth !== 'none') {
        ctx.user = await authenticate(headers, deps);
        if (route.options.auth === 'admin') requireAdmin(ctx.user);
        if (route.options.verified) requireVerified(ctx.user);
      }
      const data = await route.handler(ctx);
      return { status: 200, body: { data } };
    } catch (error) {
      if (isApiError(error)) return { status: error.status, body: error.toBody() };
      deps.logger.error('Unhandled error', { message: error && error.message, stack: error && error.stack });
      return { status: 500, body: { error: { code: 'internal', message: 'Something went wrong. Please try again.' } } };
    }
  }

  async function handleHttp(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    const output = await handle({
      method: req.method,
      path: req.path || req.url,
      headers: req.headers,
      query: req.query,
      body: req.body,
      rawBody: req.rawBody,
    });
    res.status(output.status).json(output.body);
  }

  return { handle, handleHttp, routes: ROUTES.map(([method, pattern]) => `${method} ${pattern}`) };
}

module.exports = { createApi, ROUTES };
