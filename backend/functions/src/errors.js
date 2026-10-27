'use strict';

const STATUS = {
  invalid_argument: 400,
  unauthenticated: 401,
  permission_denied: 403,
  email_not_verified: 403,
  account_suspended: 403,
  feature_disabled: 403,
  pin_required: 403,
  pin_incorrect: 403,
  step_up_required: 403,
  kyc_required: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  insufficient_funds: 409,
  limit_exceeded: 409,
  invalid_state: 409,
  pin_locked: 423,
  resource_exhausted: 429,
  provider_error: 502,
  not_configured: 503,
  internal: 500,
};

class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code] || 500;
    this.details = details && Object.keys(details).length > 0 ? details : undefined;
  }

  toBody() {
    const error = { code: this.code, message: this.message };
    if (this.details) error.details = this.details;
    return { error };
  }
}

function err(code, message, details) {
  if (!Object.hasOwn(STATUS, code)) throw new Error(`Unknown error code ${code}`);
  return new ApiError(code, message, details);
}

function isApiError(value) {
  return value instanceof ApiError;
}

module.exports = { ApiError, STATUS, err, isApiError };
