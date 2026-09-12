param([string] $Mode)
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot '../../scripts/import-yandex-browser-session.ps1')
  if ($Mode -eq 'old_version') { function Get-YandexImportPowerShellMajor { return 5 } }
  $env:SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_SYNTHETIC_NOT_VALID'
  $env:YANDEX_SESSION_KEYS_JSON = @{fixture=[Convert]::ToBase64String([byte[]]::new(32))} | ConvertTo-Json -Compress
  $env:YANDEX_SESSION_ACTIVE_KID = 'fixture'
  $script:answers = [Collections.Generic.Queue[string]]::new()
  $script:valueCalls = 0; $script:startCalls = 0
  $fields = @('.yandex.ru','/sprav/api/','true','false','session')
  $script:header = 'fixture=synthetic-cookie-one==; fixture_two=synthetic-cookie-%2F+two; csrf_fixture=synthetic-cookie-excluded'
  switch ($Mode) {
    'domain' { $fields[0]='example.com' }
    'path' { $fields[1]='/mail' }
    'expired' { $fields[4]='1' }
    'prohibited' { $script:header='csrf_fixture=synthetic-cookie-excluded; password=synthetic-cookie-excluded' }
    'secure' { $fields[2]='false' }
    'httpOnly' { $fields[3]='yes' }
    'expiry' { $fields[4]='tomorrow' }
    'date' { $fields[4]='2099-01-01T12:00:00+05:00' }
    'missing' { $env:YANDEX_SESSION_ACTIVE_KID=$null }
    'duplicate' { $script:header='fixture=synthetic-cookie-one; fixture=synthetic-cookie-two' }
    'malformed' { $script:header='fixture=synthetic-cookie-one; broken' }
    'newline' { $script:header="fixture=synthetic-cookie-one`r`nAuthorization: SECRET_SYNTHETIC" }
    'empty_value' { $script:header='fixture=' }
    'trailing' { $script:header='fixture=synthetic-cookie-one;' }
    'set_cookie' { $script:header='fixture=synthetic-cookie-one; Domain=example.com' }
    'prefix' { $script:header='Cookie: ' + $script:header }
    'duplicate_prohibited' { $script:header+='; csrf_fixture=synthetic-cookie-duplicate' }
    'oversize' { $script:header='fixture=' + ('x' * 8193) }
  }
  $script:answers.Enqueue('ДА')
  $script:answers.Enqueue($(if ($Mode -eq 'mixed_metadata') { 'НЕТ' } else { 'ДА' }))
  foreach ($field in $fields) { $script:answers.Enqueue($field) }
  $script:answers.Enqueue($(if ($Mode -eq 'cancel') { ':cancel' } else { 'ИМПОРТ' }))
  function Read-Host { param([string] $Prompt); return $script:answers.Dequeue() }
  function Read-YandexImportJson {
    param([string] $Prompt)
    $script:valueCalls++
    if ($Mode -eq 'value_cancel') { throw 'SYNTHETIC_PRIVATE_ERROR' }
    return ConvertTo-SecureString $script:header -AsPlainText -Force
  }
  $script:originalStart = (Get-Command New-YandexImportStartInfo).ScriptBlock
  function New-YandexImportStartInfo {
    $script:startCalls++
    $start = & $script:originalStart
    $start.ArgumentList.Insert(0,'--import')
    $start.ArgumentList.Insert(1,'./test/support/yandex-header-import-rpc.mock.mjs')
    $start.Environment['IMPORT_TEST_MODE'] = 'success'
    return $start
  }
  $before = @($env:SUPABASE_SERVICE_ROLE_KEY,$env:YANDEX_SESSION_KEYS_JSON,$env:YANDEX_SESSION_ACTIVE_KID) -join '|'
  $output = @(Invoke-YandexManualImport -InputReader { Read-YandexBrowserSession }) -join "`n"
  if ($Mode -in @('valid','date','prefix')) {
    if ($output -cne "session imported = true`nstate = NOT_CONFIGURED`nrevision = 1") { throw 'VALID_FAIL' }
  } else {
    $code = if ($Mode -eq 'old_version') { 'IMPORT_POWERSHELL_7_REQUIRED' } elseif ($Mode -eq 'missing') { 'IMPORT_CONFIG_MISSING' } else { 'IMPORT_SECURE_INPUT_FAILED' }
    if ($output -cne "session imported = false`nstate = UNKNOWN`nerror = $code") { throw 'INVALID_FAIL' }
  }
  if ($Mode -in @('missing','old_version') -and $script:valueCalls -ne 0) { throw 'EARLY_INPUT' }
  if ($Mode -notin @('missing','old_version') -and $script:valueCalls -ne 1) { throw 'NOT_SINGLE_PASTE' }
  if ($Mode -in @('missing','old_version') -and $script:startCalls -ne 0) { throw 'EARLY_RUNTIME' }
  if ((@($env:SUPABASE_SERVICE_ROLE_KEY,$env:YANDEX_SESSION_KEYS_JSON,$env:YANDEX_SESSION_ACTIVE_KID) -join '|') -cne $before) { throw 'ENV_CHANGED' }
  Write-Output 'PASS: browser input fixture'
} catch { Write-Output 'FAIL: browser input fixture'; exit 1 }
