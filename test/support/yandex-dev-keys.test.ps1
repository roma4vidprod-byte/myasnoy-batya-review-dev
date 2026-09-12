$ErrorActionPreference = 'Stop'
try {
  $script:setupPath = Join-Path $PSScriptRoot '../../scripts/setup-yandex-dev-keys.ps1'
  $tokens = $null; $parseErrors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($script:setupPath, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw 'PS_SYNTAX' }
  . $script:setupPath
  $script:names = @('SUPABASE_SERVICE_ROLE_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')
  foreach ($name in @($script:names) + 'YANDEX_LIVE_READ_APPROVAL') { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  # Exercise the actual child launcher with invalid config (zero RPC). A poisoned
  # NODE_OPTIONS must not reach Node. No operational credential is generated here.
  $savedNodeOptions = [Environment]::GetEnvironmentVariable('NODE_OPTIONS','Process')
  try {
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS','--require=INTENTIONALLY_MISSING_DEV_TEST_MODULE','Process')
    $launched = Invoke-YandexDevKeyCheck -Candidate @{
      SUPABASE_SERVICE_ROLE_KEY='invalid'; YANDEX_SESSION_KEYS_JSON='null'; YANDEX_SESSION_ACTIVE_KID='fixture'
    }
    if ($launched.Code -ne 1 -or $launched.Report.keyring_parse -ne 'FAIL' -or
        $launched.Report.service_role_connection -ne 'FAIL') { throw 'CHILD_ENV_SANITIZATION' }
  } finally { [Environment]::SetEnvironmentVariable('NODE_OPTIONS',$savedNodeOptions,'Process') }
  $script:mode = 'pass'; $script:prompts = 0; $script:checks = 0
  $script:marker = 'sb_secret_PRIVATE_UNIT_TEST_MARKER'
  function Read-YandexDevServiceKey {
    $script:prompts++
    if ($script:mode -eq 'empty') { return [Security.SecureString]::new() }
    return ConvertTo-SecureString $script:marker -AsPlainText -Force
  }
  function Invoke-YandexDevKeyCheck {
    param([hashtable] $Candidate)
    $script:checks++
    if ($script:mode -eq 'throw') { throw $script:marker }
    $map = $Candidate.YANDEX_SESSION_KEYS_JSON | ConvertFrom-Json -AsHashtable
    $kid = $Candidate.YANDEX_SESSION_ACTIVE_KID
    if ($map.Count -ne 1 -or -not $map.ContainsKey($kid) -or $kid -notmatch '^dev-smoke-[a-f0-9]{32}$') { throw 'KEY_MAP_FORMAT' }
    $decoded = [Convert]::FromBase64String($map[$kid])
    if ($decoded.Length -ne 32 -or ($decoded | Where-Object { $_ -ne 0 }).Count -eq 0) { throw 'AES_LENGTH' }
    [Array]::Clear($decoded, 0, $decoded.Length)
    foreach ($name in @('YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')) {
      if ([Environment]::GetEnvironmentVariable($name,'Process')) { throw 'PUBLISHED_BEFORE_CHECK' }
    }
    $code = 0; $status = 'PASS'
    if ($script:mode -eq 'fail') { $code = 1; $status = 'FAIL' }
    if ($script:mode -eq 'existing') { $code = 2 }
    if ($script:mode -eq 'malformed') { $status = $script:marker }
    return @{ Code = $code; Report = @{
      env_present = @{ SUPABASE_SERVICE_ROLE_KEY=$true; YANDEX_SESSION_KEYS_JSON=$true; YANDEX_SESSION_ACTIVE_KID=$true }
      keyring_parse='PASS'; active_kid_exists='PASS'; service_role_connection=$status
      untrusted_extra=$script:marker
    } }
  }
  $expectedLines = @(
    'SUPABASE_SERVICE_ROLE_KEY present = true', 'YANDEX_SESSION_KEYS_JSON present = true',
    'YANDEX_SESSION_ACTIVE_KID present = true', 'keyring parse = PASS', 'active kid = PASS',
    'service role connection = PASS', 'SETUP PASS'
  )
  $actualLines = @(Initialize-YandexDevKeys)
  $output = $actualLines | Out-String
  if (($actualLines -join "`n") -cne ($expectedLines -join "`n") -or $output.Contains($script:marker)) { throw 'SUCCESS_OUTPUT' }
  $firstKeyring = [Environment]::GetEnvironmentVariable('YANDEX_SESSION_KEYS_JSON','Process')
  if (-not $firstKeyring -or $output.Contains(@(($firstKeyring | ConvertFrom-Json -AsHashtable).Values)[0])) { throw 'KEY_EXPOSURE' }
  $output = Initialize-YandexDevKeys | Out-String
  if ($output -notmatch 'EXISTING_KEYRING' -or $script:prompts -ne 1 -or $script:checks -ne 1 -or
      $firstKeyring -cne [Environment]::GetEnvironmentVariable('YANDEX_SESSION_KEYS_JSON','Process')) { throw 'OVERWRITE_GUARD' }
  foreach ($name in $script:names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $firstKeyring = $null
  foreach ($partialName in @('YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')) {
    [Environment]::SetEnvironmentVariable($partialName,'synthetic-existing-config','Process')
    $promptsBefore = $script:prompts
    $output = Initialize-YandexDevKeys | Out-String
    if ($output -notmatch 'EXISTING_KEYRING' -or $script:prompts -ne $promptsBefore -or
        [Environment]::GetEnvironmentVariable($partialName,'Process') -cne 'synthetic-existing-config') { throw 'PARTIAL_EXISTING_KEYRING' }
    [Environment]::SetEnvironmentVariable($partialName,$null,'Process')
  }
  $expectedReasons = @{ fail='SERVICE_ROLE_CHECK_FAILED'; existing='EXISTING_SESSION'; throw='LOCAL_CHECK_FAILED'; malformed='CHECK_FORMAT_INVALID'; empty='EMPTY_SERVICE_KEY' }
  foreach ($script:mode in @('fail','existing','throw','malformed','empty')) {
    $output = Initialize-YandexDevKeys | Out-String
    if (-not $output.Contains($expectedReasons[$script:mode]) -or $output.Contains($script:marker) -or $output -match 'SETUP PASS') { throw 'FAILURE_OUTPUT' }
    foreach ($name in $script:names) {
      if ([Environment]::GetEnvironmentVariable($name,'Process')) { throw 'FAILURE_RETAINED_KEY' }
    }
  }
  # A service key alone is reusable; setup generates no replacement service key.
  $script:mode = 'pass'; $promptsBefore = $script:prompts
  [Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY',$script:marker,'Process')
  $actualLines = @(Initialize-YandexDevKeys)
  if (($actualLines -join "`n") -cne ($expectedLines -join "`n") -or $script:prompts -ne $promptsBefore) { throw 'EXISTING_SERVICE_KEY' }
  foreach ($name in $script:names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  # Inject a failure after one write, then verify exact transactional rollback.
  function Set-YandexDevProcessValue {
    param([string] $Name, [string] $Value)
    if ($Name -eq 'YANDEX_SESSION_KEYS_JSON') { throw $script:marker }
    [Environment]::SetEnvironmentVariable($Name,$Value,'Process')
  }
  foreach ($hasOriginalService in @($false,$true)) {
    if ($hasOriginalService) { [Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY',$script:marker,'Process') }
    $output = Initialize-YandexDevKeys | Out-String
    if ($output -notmatch 'ENV_PUBLICATION_FAILED' -or $output.Contains($script:marker)) { throw 'PUBLICATION_ERROR_OUTPUT' }
    if ([bool][Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','Process') -ne $hasOriginalService) { throw 'SERVICE_ROLLBACK' }
    foreach ($name in @('YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')) {
      if ([Environment]::GetEnvironmentVariable($name,'Process')) { throw 'PARTIAL_PUBLISH' }
    }
    if ($hasOriginalService -and [Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','Process') -cne $script:marker) { throw 'SERVICE_CHANGED' }
    [Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY',$null,'Process')
  }
  # Test the version branch without changing automatic PowerShell system variables.
  function Get-YandexDevPowerShellMajor { return 5 }
  $promptsBefore = $script:prompts; $checksBefore = $script:checks
  $output = Initialize-YandexDevKeys | Out-String
  if ($output -notmatch 'POWERSHELL_7_REQUIRED' -or $output -notmatch 'Windows PowerShell 5.1' -or
      $script:prompts -ne $promptsBefore -or $script:checks -ne $checksBefore) { throw 'LEGACY_VERSION_GATE' }
  function Get-YandexDevPowerShellMajor { return 7 }
  $promptsBefore = $script:prompts
  [Environment]::SetEnvironmentVariable('YANDEX_LIVE_READ_APPROVAL','unit-test-blocker','Process')
  $output = Initialize-YandexDevKeys | Out-String
  [Environment]::SetEnvironmentVariable('YANDEX_LIVE_READ_APPROVAL',$null,'Process')
  if ($output -notmatch 'LIVE_APPROVAL_PRESENT' -or $script:prompts -ne $promptsBefore) { throw 'LIVE_GATE' }
  $source = Get-Content -LiteralPath $script:setupPath -Raw
  if ($source -match 'Set-Content|Out-File|Write-Host|Start-Transcript|yandex-session.mjs|yandex.ru|review_enqueue_due_syncs' -or
      $source -notmatch 'Environment.Clear\(\)' -or $source -notmatch 'RandomNumberGenerator' -or
      $source -notmatch 'GetBytes\(\$bytes\)' -or
      $source -notmatch 'Microsoft.PowerShell.Utility\\Read-Host[^\r\n]+-AsSecureString') { throw 'SETUP_BOUNDARY' }
  Write-Output 'PASS: private DEV key setup offline checks'
} catch {
  # No raw exception/assertion output, even if a future regression leaks a value.
  Write-Output 'FAIL: private DEV key setup offline checks'
  exit 1
} finally {
  foreach ($name in $script:names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $output = $null; $script:marker = $null
}
