import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../scripts/set-dev-admin-password.ps1', import.meta.url), 'utf8');

test('DEV admin password helper is hidden-input, fixed-scope and server-only', () => {
  for (const literal of [
    'PSVersionTable.PSVersion.Major -lt 7',
    'Read-Host \'New DEV admin password (hidden)\' -AsSecureString',
    'Read-Host \'Repeat DEV admin password (hidden)\' -AsSecureString',
    "GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY', 'Process')",
    '/auth/v1/admin/users',
    "Invoke-SupabaseAdminApi 'PUT'",
    '/rest/v1/review_admins',
    "TargetEmail = 'myasnoibatya@yandex.ru'",
    "ProjectUrl = 'https://ykiubttldgyjpajmsuas.supabase.co'"
  ]) assert.ok(script.includes(literal), `missing safe contract: ${literal}`);

  assert.doesNotMatch(script, /param\s*\([^)]*password/i);
  assert.doesNotMatch(script, /Write-(?:Host|Error).*password/i);
  assert.doesNotMatch(script, /Write-Output\s+\$plainPassword/i);
  assert.doesNotMatch(script, /ConvertTo-SecureString/);
  assert.doesNotMatch(script, /Start-Process/);
  assert.doesNotMatch(script, /Invoke-WebRequest/);
});

test('DEV admin password helper fails closed and clears sensitive references', () => {
  for (const literal of [
    'SERVICE_ROLE_ENV_MISSING',
    'PASSWORD_POLICY_FAILED',
    'PASSWORD_CONFIRMATION_FAILED',
    'TARGET_USER_NOT_FOUND',
    'ACTIVE_ADMIN_NOT_CONFIRMED',
    "ZeroFreeBSTR($pointer)",
    '$plainPassword = $null',
    '$serviceKey = $null'
  ]) assert.ok(script.includes(literal), `missing fail-closed contract: ${literal}`);
  assert.doesNotMatch(script, /access_token|refresh_token|recovery_link/i);
});
