param([string] $Mode = 'buffer')
$ErrorActionPreference = 'Stop'
$importNames = @('SUPABASE_SERVICE_ROLE_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')
$held = $null
try {
  . (Join-Path $PSScriptRoot '../../scripts/import-yandex-session.ps1')
  if ($Mode -eq 'buffer') {
    $script:inputKeys = [Collections.Generic.Queue[ConsoleKeyInfo]]::new()
    function Add-TestCharacters([string] $Text) {
      foreach ($character in $Text.ToCharArray()) { $script:inputKeys.Enqueue([ConsoleKeyInfo]::new($character,[ConsoleKey]::A,$false,$false,$false)) }
    }
    function Add-TestEnd { $script:inputKeys.Enqueue([ConsoleKeyInfo]::new([char]4,[ConsoleKey]::D,$false,$false,$true)) }
    $readFixtureKey = { if ($script:inputKeys.Count) { return $script:inputKeys.Dequeue() }; throw 'FIXTURE_KEY_EXHAUSTED' }
    foreach ($length in @(2048,60000)) {
      Add-TestCharacters ('x' * $length); Add-TestEnd
      $held = Read-YandexImportBuffer -ReadKey $readFixtureKey
      if ($held.Length -ne $length -or -not $held.IsReadOnly()) { throw 'LONG_INPUT' }
      $held.Dispose(); $held=$null
    }
    Add-TestCharacters ([string][char]27 + '[200~' + '{')
    $script:inputKeys.Enqueue([ConsoleKeyInfo]::new([char]13,[ConsoleKey]::Enter,$false,$false,$false))
    Add-TestCharacters 'x'
    $script:inputKeys.Enqueue([ConsoleKeyInfo]::new([char]8,[ConsoleKey]::Backspace,$false,$false,$false))
    Add-TestCharacters ('}' + [char]27 + '[201~'); Add-TestEnd
    $held = Read-YandexImportBuffer -ReadKey $readFixtureKey
    if ($held.Length -ne 3) { throw 'MULTILINE_OR_PASTE_DELIMITERS' }
    $held.Dispose(); $held=$null
    foreach ($scenario in @('oversize','invalid','cancel','empty')) {
      if ($scenario -eq 'oversize') { Add-TestCharacters ('x' * 60001) }
      if ($scenario -eq 'invalid') { Add-TestCharacters ([string][char]0) }
      if ($scenario -eq 'cancel') { $script:inputKeys.Enqueue([ConsoleKeyInfo]::new([char]3,[ConsoleKey]::C,$false,$false,$true)) }
      else { Add-TestEnd }
      $rejected = $false
      try { $held = Read-YandexImportBuffer -ReadKey $readFixtureKey } catch { $rejected = $true }
      if (-not $rejected -or $script:inputKeys.Count) { throw 'INPUT_FAIL_CLOSED' }
    }
  } else {
    foreach ($name in $importNames) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
    if ($Mode -ne 'missing') {
      [Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','sb_secret_SYNTHETIC_NOT_VALID','Process')
      [Environment]::SetEnvironmentVariable('YANDEX_SESSION_KEYS_JSON',(@{fixture=[Convert]::ToBase64String([byte[]]::new(32))} | ConvertTo-Json -Compress),'Process')
      [Environment]::SetEnvironmentVariable('YANDEX_SESSION_ACTIVE_KID','fixture','Process')
    }
    # Deliberate synthetic taint: these MUST NOT be inherited by the real import CLI.
    [Environment]::SetEnvironmentVariable('YANDEX_LIVE_READ_APPROVAL','asbest-read-only-v1','Process')
    [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN','SYNTHETIC_ALERT_DISABLED','Process')
    [Environment]::SetEnvironmentVariable('RESEND_API_KEY','SYNTHETIC_ALERT_DISABLED','Process')
    $script:importInputCalls = 0
    function Read-YandexImportJson {
      $script:importInputCalls++
      if ($Mode -eq 'cancel') { throw 'SYNTHETIC_PRIVATE_EXCEPTION' }
      $inputText = if ($Mode -eq 'bad_json') { '{SYNTHETIC_PRIVATE_INVALID_JSON' } else {
        @{ account='myasnoibatya-zakaz'; cookies=@(@{
          name='fixture'; value=('synthetic-cookie-' + 'x' * 1500); domain='.yandex.ru'; path='/'; secure=$true; httpOnly=$true; expires=-1
        }) } | ConvertTo-Json -Depth 5 -Compress
      }
      return ConvertTo-SecureString $inputText -AsPlainText -Force
    }
    $script:originalStart = (Get-Command New-YandexImportStartInfo -CommandType Function).ScriptBlock
    function New-YandexImportStartInfo {
      param([ValidateSet('status','import')][string] $Operation = 'import')
      $testStart = & $script:originalStart -Operation $Operation
      $testStart.ArgumentList.Insert(0,'--import')
      $testStart.ArgumentList.Insert(1,'./test/support/yandex-import-rpc.mock.mjs')
      $testStart.Environment['IMPORT_TEST_MODE'] = $Mode
      return $testStart
    }
    $before = @{}
    foreach ($name in $importNames) { $before[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
    $lines = @(Invoke-YandexManualImport)
    foreach ($name in $importNames) {
      if ([Environment]::GetEnvironmentVariable($name,'Process') -cne $before[$name]) { throw 'KEY_ENV_CHANGED' }
    }
    $output = $lines -join "`n"
    if ($Mode -eq 'success') {
      if ($output -cne "session imported = true`nstate = NOT_CONFIGURED`nrevision = 8") { throw 'SUCCESS_STATUS' }
    } elseif ($Mode -in @('error','bad_result')) {
      $code = if ($Mode -eq 'error') { 'IMPORT_CLI_FAILED' } else { 'IMPORT_STATUS_INVALID' }
      if ($output -cne "session imported = NOT_CONFIRMED`nstate = UNKNOWN`nerror = $code") { throw 'UNCERTAIN_STATUS' }
    } else {
      $code = @{missing='IMPORT_CONFIG_MISSING';cancel='IMPORT_SECURE_INPUT_FAILED';bad_json='IMPORT_JSON_INVALID'}[$Mode]
      if ($output -cne "session imported = false`nstate = UNKNOWN`nerror = $code") { throw 'FAIL_STATUS' }
      if ($Mode -eq 'missing' -and $script:importInputCalls -ne 0) { throw 'MISSING_CONFIG_PROMPTED' }
    }
    if ($output -match 'SYNTHETIC|synthetic-cookie|ciphertext|cookies') { throw 'SECRET_OUTPUT' }
  }
  Write-Output 'PASS: isolated manual import regression'
} catch {
  Write-Output 'FAIL: isolated manual import regression'
  exit 1
} finally {
  if ($held) { $held.Dispose() }
  foreach ($name in $importNames) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
}
