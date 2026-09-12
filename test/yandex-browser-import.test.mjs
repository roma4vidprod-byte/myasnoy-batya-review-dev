import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
for (const extra of [[],['--unexpected']]) {
  test(`browser helper entrypoint: ${extra.length ? 'arguments refused' : 'missing env before prompt'}`, () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(name)));
    const child = spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','scripts/import-yandex-browser-session.ps1',...extra], {cwd,env,encoding:'utf8',timeout:10000});
    const code = extra.length ? 'IMPORT_ARGUMENTS_NOT_ALLOWED' : 'IMPORT_CONFIG_MISSING';
    assert.equal(child.status === 0 && child.stderr === '' && child.stdout.trim().replaceAll('\r','') === `session imported = false\nstate = UNKNOWN\nerror = ${code}`,true);
  });
}
for (const mode of ['publish','valid','prefix','date','old_version','missing','domain','path','expired','prohibited','duplicate','cancel','value_cancel','malformed','secure','httpOnly','expiry','newline','empty_value','trailing','set_cookie','duplicate_prohibited','oversize','mixed_metadata','metadata_cancel','metadata_duplicate','metadata_missing','metadata_extra','metadata_value','partitioned','wrong_nonce','wrong_url','stale','metadata_only']) {
  test(`browser cookie helper: ${mode}, synthetic input only`, () => {
    const child = spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','test/support/yandex-browser-import.test.ps1','-Mode',mode], {cwd,encoding:'utf8',timeout:20000});
    // Never include captured input or exceptions in assertion diagnostics.
    assert.equal(child.status === 0 && child.stderr === '' && child.stdout.trim().endsWith('PASS: browser input fixture'),true);
    assert.equal(/synthetic-cookie-|SYNTHETIC_PRIVATE|SECRET_SYNTHETIC|ciphertext|csrf_fixture/.test(child.stdout + child.stderr),false);
  });
}

test('browser helper: no files/profile access, commands, secrets in argv or second engine', () => {
  const source = readFileSync(new URL('../scripts/import-yandex-browser-session.ps1',import.meta.url),'utf8');
  assert.match(source,/Invoke-YandexManualImport -InputReader/);
  assert.match(source,/Read-YandexImportJson -Prompt/);
  assert.match(source,/\$args.Count/);
  assert.doesNotMatch(source,/Set-Content|Add-Content|Out-File|WriteAll|AppendAll|Start-Transcript|Get-Clipboard|Invoke-Expression|Invoke-WebRequest|Invoke-RestMethod|CreateCipher|ArgumentList\.Add|SetEnvironmentVariable|System\.IO|SQLite|Login Data|Cookies.db/i);
  assert.doesNotMatch(source,/Write-(?:Output|Host).*\$(?:value|records|secret|json|name)/);
});
