import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const mode of ['buffer','success','missing','bad_json','cancel','error','bad_result']) {
  test(`manual session import: ${mode}; existing CLI, encrypted mock RPC, no Yandex`, t => {
    const child = spawnSync('pwsh', ['-NoLogo','-NoProfile','-NonInteractive','-File','test/support/yandex-import.test.ps1','-Mode',mode], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: mode === 'buffer' ? 40000 : 20000
    });
    if (child.error?.code === 'ENOENT') { t.skip('PowerShell 7 unavailable'); return; }
    assert.equal(child.status === 0 && child.stderr === '' && child.stdout.trim() === 'PASS: isolated manual import regression', true);
  });
}

test('manual import adapter has no secret files, key setup, live commands, shell eval or raw-output forwarding', () => {
  const source = readFileSync(new URL('../scripts/import-yandex-session.ps1',import.meta.url),'utf8');
  assert.match(source, /ReadKey\(\$true\)/);
  assert.match(source, /expectedRevision = 0/);
  assert.match(source, /Environment.Clear\(\)/);
  assert.match(source, /StandardInput.WriteAsync\(\$payload\)/);
  assert.match(source, /ArgumentList.Add\('import'\)/);
  assert.doesNotMatch(source, /Invoke-Expression|Set-Content|Out-File|Write-Host|Get-Clipboard|SetEnvironmentVariable|Read-Host|Start-Transcript|yandex\.ru|ArgumentList.Add\('(?:health|probe|dry-run)'\)/);
  assert.doesNotMatch(source, /Write-Output\s+\$(?:plain|session|payload|stdout|stderr|result)/);
});
