'use strict';

function depositsReady(deps) {
  const { provider, config } = deps;
  return Boolean(provider && provider.isConfigured() && config.publicReturnUrl);
}

async function health(ctx) {
  const { config, provider, clock } = ctx.deps;
  const ready = depositsReady(ctx.deps);
  const rule = (fee) => ({ bps: fee.bps, fixedMinor: fee.fixedMinor });
  return {
    ok: true,
    version: config.version,
    time: clock.now().toISOString(),
    capabilities: {
      deposits: ready,
      withdrawals: true,
      transfers: true,
      provider: ready ? provider.name : null,
      walletCurrencies: config.walletCurrencies,
      limits: {
        depositMin: config.limits.deposit.min,
        depositMax: config.limits.deposit.max,
        withdrawMin: config.limits.withdrawal.min,
        withdrawMax: config.limits.withdrawal.max,
        transferMin: config.limits.transfer.min,
        transferMax: config.limits.transfer.max,
        dailyOut: config.limits.dailyOutMinor,
      },
      fees: {
        deposit: rule(config.fees.deposit),
        withdrawal: rule(config.fees.withdrawal),
        transfer: rule(config.fees.transfer),
      },
      requireKyc: config.requireKycForWithdrawal,
    },
  };
}

module.exports = { health, depositsReady };
