import { sendTelegramMessage } from '../../../api/_telegram.js';
import { sendResendEmail, emailConfig } from '../../../api/_email.js';
import { scopeOf, serverOnly, fail, FAILURE_CODES } from './crypto.js';

// Input is constructed from fixed categories and scope, never from upstream errors.
export async function sendSessionAlert({ scope, state, category, timestamp, incidentId }) {
  serverOnly();
  const s = scopeOf(scope);
  if (!['ERROR','REAUTH_REQUIRED'].includes(state) || !FAILURE_CODES.has(category) ||
      !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(timestamp) ||
      !/^[0-9a-f-]{36}$/.test(incidentId)) fail('SESSION_ALERT_INVALID');
  const action = state === 'REAUTH_REQUIRED' ? 'Manually reauthenticate technical account and replace encrypted session.'
    : 'Inspect safe error category; verify contract/configuration before retrying.';
  const text = [
    'Review Activator: provider=yandex', `company=${s.companyId}`, `location=${s.locationId}`,
    `organization=${s.organizationId}`, `state=${state}`, `category=${category}`, `timestamp=${timestamp}`, `action=${action}`
  ].join('\n');
  const outcome = {};
  for (const [channel, send] of [
    ['telegram', () => sendTelegramMessage({ text })],
    ['email', () => sendResendEmail({ to: emailConfig().adminTo, subject: 'Review Activator — Yandex session requires attention',
      text, idempotencyKey: `yandex-session/${incidentId}` })]
  ]) {
    try { outcome[channel] = (await send()).status; } catch { outcome[channel] = 'FAILED'; }
  }
  return outcome;
}
