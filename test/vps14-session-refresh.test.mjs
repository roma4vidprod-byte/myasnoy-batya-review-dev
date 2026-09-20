import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const refresh=readFileSync(new URL('../tools/vps14/session-refresh.mjs',import.meta.url),'utf8');
const adapter=readFileSync(new URL('../scripts/yandex-vps-refresh.ps1',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../scripts/start-yandex-local-import.ps1',import.meta.url),'utf8');
const entry=readFileSync(new URL('../scripts/start-yandex-vps-refresh.ps1',import.meta.url),'utf8');

test('VPS14 session refresh is one-shot revision 4 to 5 with no provider IO',()=>{
  assert.match(refresh,/EXPECTED_REVISION=4/);
  assert.match(refresh,/expectedRevision:EXPECTED_REVISION/);
  assert.match(refresh,/result\.revision!==EXPECTED_REVISION\+1/);
  assert.match(refresh,/provider_requests:0/);
  assert.match(refresh,/provider_writes:0/);
  assert.doesNotMatch(refresh,/\bfetch\s*\(/);
  assert.doesNotMatch(refresh,/createYandexReadTransport/);
});

test('VPS14 refresh adapter pins current VDSina and current known-hosts file',()=>{
  for(const literal of [
    'root@83.217.214.29',
    'vdsina_known_hosts',
    'reviewadmin_ed25519',
    'StrictHostKeyChecking=yes',
    'PasswordAuthentication=no',
    'KbdInteractiveAuthentication=no',
    'session-refresh.mjs',
    'expectedRevision=4',
    'revision -ne 5',
    'provider_requests -ne 0',
    'provider_writes -ne 0'
  ])assert.ok(adapter.includes(literal),literal);
  assert.equal(adapter.includes('141.98.87.15'),false);
  assert.equal(adapter.includes('REVIEW_WORKER_SECRET'),false);
});

test('VPS14 local native pipe adds refresh target without changing cloud default',()=>{
  assert.ok(launcher.includes("ValidateSet('cloud-dev','vps-lab','vps-refresh')"));
  assert.ok(launcher.includes("yandex-vps-refresh.ps1"));
  assert.ok(launcher.includes("@('vps-lab','vps-refresh')"));
  assert.match(entry,/Invoke-YandexLocalImport -Target 'vps-refresh'/);
  assert.ok(launcher.includes("$Target = 'cloud-dev'"));
});
