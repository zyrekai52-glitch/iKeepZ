'use strict';

const { createPaymongoProvider } = require('./paymongo');

/**
 * Builds the payment provider from secrets. A missing or "unset" secret yields a provider whose isConfigured() is false;
 * the API then reports deposits as unavailable instead of pretending to work.
 */
function createProvider({ secrets, config, logger, fetchImpl }) {
  return createPaymongoProvider({
    secretKey: secrets.PAYMONGO_SECRET_KEY,
    webhookSecret: secrets.PAYMONGO_WEBHOOK_SECRET,
    paymentMethods: config.paymentMethods,
    logger,
    fetchImpl,
  });
}

module.exports = { createProvider };
