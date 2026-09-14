/**
 * Safe projection used by the existing reconciliation RPC/HTTP boundary.
 * No I/O and no credentials. Unknown outcomes never imply zero writes.
 * Contract basis: deployed review_reconcile_yandex_connection, inspected
 * 2026-09-14. It raises SQLSTATE 22023 with the four exact messages below.
 *
 * callerBoundary is a trusted SERVER constant. Never obtain it from an HTTP
 * request, an exception property, or an unverified response from another RPC.
 * A business rejection describes THIS RPC statement, not concurrent writes.
 */
const BUSINESS_ERRORS = new Set([
  'REVIEW_SCOPE_INVALID',
  'REVIEW_CONNECTION_NOT_FOUND',
  'SESSION_NOT_READY',
  'RECONCILIATION_NOT_ALLOWED',
]);
const BOUNDARIES = new Set([
  'BEFORE_RPC_DISPATCH',
  'RPC_ERROR_RESPONSE',
  'RPC_TRANSPORT_UNKNOWN',
  'RPC_RESPONSE_INVALID',
  'UNKNOWN',
]);

// Avoid executing arbitrary getters or accepting inherited error attributes.
function ownData(object, key) {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function')) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Project a PostgREST RPC error into a closed safe response.
 * Read code/message only for exact comparison; NEVER return raw attributes.
 * @param {unknown} error
 * @param {string} callerBoundary Trusted caller-observed execution boundary.
 * @returns {Readonly<Record<string, boolean|string>>}
 */
export function safeReconciliationFailure(error, callerBoundary = 'UNKNOWN') {
  const boundary = BOUNDARIES.has(callerBoundary) ? callerBoundary : 'UNKNOWN';
  const code = ownData(error, 'code');
  const message = ownData(error, 'message');
  if (boundary === 'RPC_ERROR_RESPONSE' && code === '22023' &&
      typeof message === 'string' && BUSINESS_ERRORS.has(message)) {
    return Object.freeze({
      ok: false,
      error: message,
      failure_stage: 'RECONCILIATION_RPC',
      outcome: 'BUSINESS_REJECTED',
      connection_effect: 'NOT_APPLIED_BY_THIS_RPC',
    });
  }
  return Object.freeze({
    ok: false,
    error: boundary === 'RPC_RESPONSE_INVALID'
      ? 'RECONCILIATION_CONTRACT_DRIFT' : 'RECONCILIATION_FAILED',
    failure_stage: boundary,
    outcome: 'UNCONFIRMED',
    connection_effect: boundary === 'BEFORE_RPC_DISPATCH'
      ? 'NOT_ATTEMPTED' : 'UNKNOWN',
  });
}

/**
 * Validate and project the SUCCESS schema of the existing RPC.
 * Invalid or lost response does NOT mean a successful write did not happen.
 * Additional upstream fields are ignored, never copied or logged.
 * @param {unknown} data Parsed result from THIS RPC, not arbitrary JSON.
 * @returns {Readonly<Record<string, boolean|string>>}
 */
export function safeReconciliationSuccess(data) {
  const ok = ownData(data, 'ok');
  const changed = ownData(data, 'changed');
  const status = ownData(data, 'status');
  const sessionState = ownData(data, 'session_state');
  if (Array.isArray(data) || ok !== true || typeof changed !== 'boolean' ||
      status !== 'READY' || sessionState !== 'READY') {
    return safeReconciliationFailure(null, 'RPC_RESPONSE_INVALID');
  }
  return Object.freeze({
    ok: true,
    changed,
    status: 'READY',
    session_state: 'READY',
    outcome: changed ? 'CHANGED' : 'ALREADY_READY',
    connection_effect: changed ? 'CHANGED_BY_THIS_RPC' : 'NO_CHANGE_BY_THIS_RPC',
  });
}

// Only errors minted at our RPC boundary carry a trusted outcome. A thrown
// network Error with a forged code/boundary cannot impersonate a DB rejection.
const failures = new WeakMap();
export function reconciliationError(error, boundary = 'UNKNOWN') {
  const result = safeReconciliationFailure(error, boundary);
  const safe = new Error(result.error);
  safe.code = result.error;
  failures.set(safe, result);
  return safe;
}
export function reconciliationFailureResult(error) {
  return failures.get(error) ?? safeReconciliationFailure(null, 'UNKNOWN');
}
export function isReconciliationError(error) {
  return failures.has(error);
}
