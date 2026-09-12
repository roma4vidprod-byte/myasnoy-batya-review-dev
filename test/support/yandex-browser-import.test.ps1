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
  $fields = @('fixture','.yandex.ru','/sprav/api/','true','false','session')
  switch ($Mode) {
    'domain' { $fields[1]='example.com' }
    'path' { $fields[2]='/mail' }
    'expired' { $fields[5]='1' }
    'prohibited' { $fields[0]='csrf_fixture' }
    'secure' { $fields[3]='false' }
    'httpOnly' { $fields[4]='yes' }
    'expiry' { $fields[5]='tomorrow' }
    'date' { $fields[5]='2099-01-01T12:00:00+05:00' }
    'missing' { $env:YANDEX_SESSION_ACTIVE_KID=$null }
  }
  $script:answers.Enqueue('ДА')
  foreach ($field in $fields) { $script:answers.Enqueue($field) }
  if ($Mode -eq 'duplicate') { $script:answers.Enqueue('ДА'); $script:answers.Enqueue('fixture') }
  else { $script:answers.Enqueue('НЕТ'); $script:answers.Enqueue($(if ($Mode -eq 'cancel') { ':cancel' } else { 'ИМПОРТ' })) }
  function Read-Host { param([string] $Prompt); return $script:answers.Dequeue() }
  function Read-YandexImportJson {
    param([string] $Prompt)
    $script:valueCalls++
    if ($Mode -eq 'value_cancel') { throw 'SYNTHETIC_PRIVATE_ERROR' }
    $text = if ($Mode -eq 'malformed') { 'SYNTHETIC;PRIVATE' } else { 'synthetic-cookie-' + ('x' * 1500) }
    return ConvertTo-SecureString $text -AsPlainText -Force
  }
  $script:originalStart = (Get-Command New-YandexImportStartInfo).ScriptBlock
  function New-YandexImportStartInfo {
    $script:startCalls++
    $start = & $script:originalStart
    $start.ArgumentList.Insert(0,'--import')
    $start.ArgumentList.Insert(1,'./test/support/yandex-import-rpc.mock.mjs')
    $start.Environment['IMPORT_TEST_MODE'] = 'success'
    return $start
  }
  $before = @($env:SUPABASE_SERVICE_ROLE_KEY,$env:YANDEX_SESSION_KEYS_JSON,$env:YANDEX_SESSION_ACTIVE_KID) -join '|'
  $output = @(Invoke-YandexManualImport -InputReader { Read-YandexBrowserSession }) -join "`n"
  if ($Mode -in @('valid','date')) {
    if ($output -cne "session imported = true`nstate = NOT_CONFIGURED`nrevision = 1") { throw 'VALID_FAIL' }
  } else {
    $code = if ($Mode -eq 'old_version') { 'IMPORT_POWERSHELL_7_REQUIRED' } elseif ($Mode -eq 'missing') { 'IMPORT_CONFIG_MISSING' } else { 'IMPORT_SECURE_INPUT_FAILED' }
    if ($output -cne "session imported = false`nstate = UNKNOWN`nerror = $code") { throw 'INVALID_FAIL' }
  }
  if ($Mode -in @('domain','path','expired','prohibited','secure','httpOnly','expiry','missing','old_version') -and $script:valueCalls -ne 0) { throw 'EARLY_INPUT' }
  if ($Mode -in @('missing','old_version') -and $script:startCalls -ne 0) { throw 'EARLY_RUNTIME' }
  if ((@($env:SUPABASE_SERVICE_ROLE_KEY,$env:YANDEX_SESSION_KEYS_JSON,$env:YANDEX_SESSION_ACTIVE_KID) -join '|') -cne $before) { throw 'ENV_CHANGED' }
  Write-Output 'PASS: browser input fixture'
} catch { Write-Output 'FAIL: browser input fixture'; exit 1 }
