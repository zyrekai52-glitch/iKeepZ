'use strict';

const { parse, int, oneOf } = require('../validation');
const { MAX_MINOR } = require('../money');
const rateLimit = require('../ratelimit');
const common = require('./common');
const { depositsReady } = require('./health');

/**
 * Informational price check. It never throws for an out-of-range amount: `problem` says what is wrong
 * (below_min | above_max | daily_limit | insufficient_funds | unavailable) so the UI can show it inline.
 * The real operations re-validate everything.
 */
async function quote(ctx) {
  const { deps, user } = ctx;
  const { config, clock } = deps;
  const input = parse({ kind: oneOf(['deposit', 'withdrawal', 'transfer']), amountMinor: int({ min: 1, max: MAX_MINOR }) }, ctx.body);
  await rateLimit.consume(deps, user.uid, 'quote');
  const account = await common.loadAccount(deps, user.uid);
  const price = common.priceOf(config, input.kind, input.amountMinor);

  let problem = null;
  if (input.amountMinor < price.minMinor) problem = 'below_min';
  else if (input.amountMinor > price.maxMinor) problem = 'above_max';

  let remainingDailyMinor = null;
  if (input.kind === 'deposit') {
    if (!problem && !depositsReady(deps)) problem = 'unavailable';
  } else {
    const daily = common.dailyFor(deps, user.uid, clock.now());
    const snapshot = await daily.ref.get();
    const used = snapshot.exists ? snapshot.data().outMinor : 0;
    remainingDailyMinor = Math.max(0, config.limits.dailyOutMinor - used);
    if (!problem && price.totalMinor > remainingDailyMinor) problem = 'daily_limit';
    if (!problem && account.wallet.availableMinor < price.totalMinor) problem = 'insufficient_funds';
  }

  return {
    amountMinor: input.amountMinor,
    feeMinor: price.feeMinor,
    totalMinor: price.totalMinor,
    currency: account.wallet.currency,
    minMinor: price.minMinor,
    maxMinor: price.maxMinor,
    remainingDailyMinor,
    problem,
  };
}

module.exports = { quote };
