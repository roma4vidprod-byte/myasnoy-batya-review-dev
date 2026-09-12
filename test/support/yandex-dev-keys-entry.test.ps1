# Actual & script entry point; injected SecureString and checker, SYNTHETIC only.
# No valid credential, no real RPC, no Yandex. Raw diagnostics never leave this test.
param([switch] $NoInput)
$ErrorActionPreference = 'Stop'
$testNames = @('SUPABASE_SERVICE_ROLE_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')
$transcriptDirectory = $null; $transcriptPath = $null; $transcriptStarted = $false
$testChild = $null
$testStage = 'PREPARE'
try {
  foreach ($name in @($testNames) + 'YANDEX_LIVE_READ_APPROVAL') { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
  $script:testMarker = 'SYNTHETIC_INPUT_INVALID_AS_A_SERVICE_KEY'
  $global:reviewDevSetupTestCalls = 0
  function Invoke-OfflineKeyCheck {
    param([hashtable] $Candidate)
    $global:reviewDevSetupTestCalls++
    if ($Candidate.SUPABASE_SERVICE_ROLE_KEY -cne 'SYNTHETIC_INPUT_INVALID_AS_A_SERVICE_KEY') { throw 'TEST_INPUT_UNEXPECTED' }
    return @{ Code=0; Report=@{
      env_present=@{SUPABASE_SERVICE_ROLE_KEY=$true; YANDEX_SESSION_KEYS_JSON=$true; YANDEX_SESSION_ACTIVE_KID=$true}
      keyring_parse='PASS'; active_kid_exists='PASS'; service_role_connection='PASS'
    } }
  }
  # Alias precedence injects a test double at the existing checker boundary,
  # without replacing the native secure Read-Host cmdlet or modifying the script.
  Set-Alias -Name Invoke-YandexDevKeyCheck -Value Invoke-OfflineKeyCheck
  if (-not $NoInput) {
    function Read-OfflineServiceKey { return ConvertTo-SecureString 'SYNTHETIC_INPUT_INVALID_AS_A_SERVICE_KEY' -AsPlainText -Force }
    Set-Alias -Name Read-YandexDevServiceKey -Value Read-OfflineServiceKey
    $transcriptDirectory = Join-Path ([IO.Path]::GetTempPath()) ('review-dev-prompt-test-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $transcriptDirectory
    $transcriptPath = Join-Path $transcriptDirectory 'synthetic-transcript.txt'
    $null = Start-Transcript -Path $transcriptPath
    $transcriptStarted = $true
  }
  $testPidBefore = $PID
  $testStage = 'ENTRY'
  $setupLines = @(& (Join-Path $PSScriptRoot '../../scripts/setup-yandex-dev-keys.ps1'))
  if ($PID -ne $testPidBefore) { throw 'DIFFERENT_PROCESS' }
  if ($NoInput) {
    if ($setupLines.Count -ne 1 -or $setupLines[0] -notmatch 'SECURE_INPUT_UNAVAILABLE' -or $global:reviewDevSetupTestCalls -ne 0) { throw 'NONINTERACTIVE_GATE' }
    foreach ($name in $testNames) { if ([Environment]::GetEnvironmentVariable($name,'Process')) { throw 'NONINTERACTIVE_ENV' } }
    Write-Output 'PASS: noninteractive prompt refusal is explicit and atomic'
  } else {
    $testStage = 'EXACT_OUTPUT'
    $expectedLines = @(
      'SUPABASE_SERVICE_ROLE_KEY present = true', 'YANDEX_SESSION_KEYS_JSON present = true',
      'YANDEX_SESSION_ACTIVE_KID present = true', 'keyring parse = PASS', 'active kid = PASS',
      'service role connection = PASS', 'SETUP PASS'
    )
    if (($setupLines -join "`n") -cne ($expectedLines -join "`n") -or $global:reviewDevSetupTestCalls -ne 1) { throw 'ENTRY_OUTPUT' }
    $testStage = 'RETAINED_ENV'
    foreach ($name in $testNames) { if (-not [Environment]::GetEnvironmentVariable($name,'Process')) { throw 'NOT_RETAINED_AFTER_SCRIPT' } }
    $testRing = [Environment]::GetEnvironmentVariable('YANDEX_SESSION_KEYS_JSON','Process') | ConvertFrom-Json -AsHashtable
    $testKid = [Environment]::GetEnvironmentVariable('YANDEX_SESSION_ACTIVE_KID','Process')
    if (-not $testRing.ContainsKey($testKid) -or [Convert]::FromBase64String($testRing[$testKid]).Length -ne 32) { throw 'KEYRING_FORMAT' }
    $testStage = 'CHILD_INHERITANCE'
    # Prove a subsequently started child inherits the successful setup. The child
    # only inspects env in memory; it cannot import sessions or make requests.
    $childStart = [Diagnostics.ProcessStartInfo]::new()
    $childStart.FileName = (Get-Command node -CommandType Application | Select-Object -First 1).Source
    $childStart.UseShellExecute = $false; $childStart.CreateNoWindow = $true
    $childStart.RedirectStandardOutput = $true; $childStart.RedirectStandardError = $true
    foreach ($name in @('NODE_OPTIONS','NODE_DEBUG','SSLKEYLOGFILE')) { $null = $childStart.Environment.Remove($name) }
    $childStart.ArgumentList.Add('-e')
    $childStart.ArgumentList.Add('const e=process.env; const r=JSON.parse(e.YANDEX_SESSION_KEYS_JSON); process.stdout.write(e.SUPABASE_SERVICE_ROLE_KEY && Buffer.from(r[e.YANDEX_SESSION_ACTIVE_KID],"base64").length===32 ? "INHERITED" : "FAIL");')
    $testChild = [Diagnostics.Process]::Start($childStart)
    $childOutput = $testChild.StandardOutput.ReadToEnd()
    $childError = $testChild.StandardError.ReadToEnd()
    $testChild.WaitForExit()
    if ($testChild.ExitCode -ne 0 -or $childOutput -cne 'INHERITED' -or $childError) { throw 'CHILD_INHERITANCE' }
    $testStage = 'HISTORY'
    $historyText = (Get-History | ForEach-Object { $_.CommandLine }) -join "`n"
    if ($historyText.Contains($script:testMarker) -or $historyText.Contains($testRing[$testKid])) { throw 'HISTORY_EXPOSURE' }
    $null = Stop-Transcript
    $transcriptStarted = $false
    $testStage = 'TRANSCRIPT'
    $transcriptText = Get-Content -LiteralPath $transcriptPath -Raw
    if ($transcriptText.Contains($script:testMarker) -or $transcriptText.Contains($testRing[$testKid])) { throw 'TRANSCRIPT_EXPOSURE' }
    Write-Output 'PASS: secure input, exact output, same-process env, child inheritance, transcript and history'
  }
} catch {
  Write-Output ('FAIL: isolated setup regression at ' + $testStage)
  exit 1
} finally {
  if ($transcriptStarted) { $null = Stop-Transcript }
  if ($null -ne $testChild) { $testChild.Dispose() }
  if ($null -ne $childStart) { $childStart.Environment.Clear() }
  foreach ($name in $testNames) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
  # Only remove the exact synthetic transcript created by this isolated test.
  if ($transcriptPath -and (Test-Path -LiteralPath $transcriptPath)) {
    if ([IO.Path]::GetFullPath($transcriptPath) -eq [IO.Path]::GetFullPath((Join-Path $transcriptDirectory 'synthetic-transcript.txt'))) {
      Remove-Item -LiteralPath $transcriptPath
      Remove-Item -LiteralPath $transcriptDirectory
    }
  }
  $script:testMarker=$null; $transcriptText=$null; $testRing=$null; $historyText=$null
  $global:reviewDevSetupTestCalls=$null
}
