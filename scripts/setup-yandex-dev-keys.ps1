# Run manually with & in a private PowerShell 7 window. No values in arguments/files.
# Do not run in an agent-controlled, recorded, transcribed or debug-traced terminal.
# Dot-sourcing loads functions only (used by offline tests).

function Get-YandexDevPowerShellMajor { return $PSVersionTable.PSVersion.Major }

function Read-YandexDevServiceKey {
  # Native secure input is not evaluated as a command or saved in PSReadLine history.
  return Microsoft.PowerShell.Utility\Read-Host 'Review Activator DEV SUPABASE_SERVICE_ROLE_KEY (hidden)' -AsSecureString
}

function Set-YandexDevProcessValue {
  param([string] $Name, [string] $Value)
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Invoke-YandexDevKeyCheck {
  param([hashtable] $Candidate)
  $child = $null
  try {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $start.WorkingDirectory = Split-Path $PSScriptRoot -Parent
    $start.ArgumentList.Add((Join-Path $PSScriptRoot 'check-yandex-dev-env.mjs'))
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    # No NODE_OPTIONS, network tracing, TLS key logs, proxies or alert credentials.
    $start.Environment.Clear()
    foreach ($name in @('PATH','SystemRoot','WINDIR','TEMP','TMP','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA')) {
      $value = [Environment]::GetEnvironmentVariable($name, 'Process')
      if ($value) { $start.Environment[$name] = $value }
    }
    foreach ($name in $Candidate.Keys) { $start.Environment[$name] = $Candidate[$name] }
    $child = [Diagnostics.Process]::Start($start)
    $stdout = $child.StandardOutput.ReadToEndAsync()
    $stderr = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit(25000)) { throw 'CHECK_TIMEOUT' }
    $parsed = $stdout.GetAwaiter().GetResult() | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    # Only exit code and parsed data go to the filtering layer; never forward stderr.
    return @{ Code = $child.ExitCode; Report = $parsed }
  } finally {
    if ($null -ne $child) {
      if (-not $child.HasExited) { $child.Kill() }
      $child.Dispose()
    }
    if ($null -ne $start) { $start.Environment.Clear() }
    $Candidate = $null; $parsed = $null; $stdout = $null; $stderr = $null
  }
}

function Initialize-YandexDevKeys {
  $ErrorActionPreference = 'Stop'
  $names = @('SUPABASE_SERVICE_ROLE_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')
  $secure = $null; $bstr = [IntPtr]::Zero; $bytes = $null; $rng = $null
  $candidate = $null; $service = $null; $keyMap = $null; $published = $false
  $before = @{}; $publicationStarted = $false
  # Fixed stage messages only. Never expose an exception, input or child stderr.
  $failure = 'SETUP STOPPED [POWERSHELL_7_REQUIRED]. Windows PowerShell 5.1 is not supported. Open PowerShell 7 (pwsh); no secret was requested.'
  try {
    if ((Get-YandexDevPowerShellMajor) -lt 7) { throw 'STOP' }
    foreach ($name in $names) {
      $before[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $failure = 'SETUP STOPPED [EXISTING_KEYRING]. Existing or partial AES configuration was preserved. Do not regenerate a key for stored ciphertext.'
    if ($before.YANDEX_SESSION_KEYS_JSON -or $before.YANDEX_SESSION_ACTIVE_KID) { throw 'STOP' }
    $failure = 'SETUP STOPPED [LIVE_APPROVAL_PRESENT]. Use a fresh private PowerShell 7 window without live-read approval. No secret was requested.'
    if ([Environment]::GetEnvironmentVariable('YANDEX_LIVE_READ_APPROVAL', 'Process')) { throw 'STOP' }
    $failure = 'SETUP STOPPED [NODE_NOT_FOUND]. Install or select Node 22+ before setup. No secret was requested.'
    $null = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $service = $before.SUPABASE_SERVICE_ROLE_KEY
    if (-not $service) {
      $failure = 'SETUP STOPPED [SECURE_INPUT_UNAVAILABLE]. Use an interactive private PowerShell 7 console, not a NonInteractive job. No new configuration retained.'
      $secure = Read-YandexDevServiceKey
      if ($secure -isnot [Security.SecureString]) { throw 'STOP' }
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      $service = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    $failure = 'SETUP STOPPED [EMPTY_SERVICE_KEY]. Hidden input was empty. No new configuration retained.'
    if ([string]::IsNullOrWhiteSpace($service)) { throw 'STOP' }
    $failure = 'SETUP STOPPED [KEY_GENERATION_FAILED]. No new configuration retained.'
    $bytes = [byte[]]::new(32)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $kid = 'dev-smoke-' + [Guid]::NewGuid().ToString('N')
    $keyMap = @{ $kid = [Convert]::ToBase64String($bytes) }
    $candidate = @{
      SUPABASE_SERVICE_ROLE_KEY = $service
      YANDEX_SESSION_KEYS_JSON = ($keyMap | ConvertTo-Json -Compress)
      YANDEX_SESSION_ACTIVE_KID = $kid
    }
    $failure = 'SETUP STOPPED [LOCAL_CHECK_FAILED]. Local checker could not complete. No new configuration retained.'
    $result = Invoke-YandexDevKeyCheck -Candidate $candidate
    # Reconstruct an allowlisted, typed report; never print arbitrary child output.
    $failure = 'SETUP STOPPED [CHECK_FORMAT_INVALID]. Checker result was rejected. No new configuration retained.'
    foreach ($name in $names) {
      if ($result.Report.env_present[$name] -isnot [bool]) { throw 'CHECK_FORMAT' }
    }
    foreach ($field in @('keyring_parse','active_kid_exists','service_role_connection')) {
      if ($result.Report[$field] -isnot [string] -or $result.Report[$field] -cnotin @('PASS','FAIL')) { throw 'CHECK_FORMAT' }
    }
    $failure = 'SETUP STOPPED [EXISTING_SESSION]. Session storage is no longer empty. No new configuration retained; do not regenerate or reimport blindly.'
    if ($result.Code -eq 2) { throw 'STOP' }
    $failure = 'SETUP STOPPED [CONFIG_CHECK_FAILED]. Keyring or active KID check failed. No new configuration retained.'
    foreach ($name in $names) { if (-not $result.Report.env_present[$name]) { throw 'STOP' } }
    if ($result.Report.keyring_parse -ne 'PASS' -or $result.Report.active_kid_exists -ne 'PASS') { throw 'STOP' }
    $failure = 'SETUP STOPPED [SERVICE_ROLE_CHECK_FAILED]. DEV read-only connection was not confirmed. No new configuration retained.'
    if ($result.Code -ne 0 -or $result.Report.service_role_connection -ne 'PASS') { throw 'STOP' }
    # Publish only after every check passes. This changes this PowerShell process,
    # not User/Machine environment, not a file, not the Codex app process.
    $failure = 'SETUP STOPPED [ENV_PUBLICATION_FAILED]. Previous process configuration restored; no partial setup retained.'
    $publicationStarted = $true
    foreach ($name in $names) { Set-YandexDevProcessValue -Name $name -Value $candidate[$name] }
    foreach ($name in $names) {
      if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne $candidate[$name]) { throw 'STOP' }
    }
    $published = $true
  } catch {
    Write-Output $failure
  } finally {
    # Also roll back an interrupted publication (finally runs on pipeline stop).
    # Preserve the exact before-state, including a manually preconfigured service key.
    if ($publicationStarted -and -not $published) {
      foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $before[$name], 'Process') }
    }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($null -ne $secure) { $secure.Dispose() }
    if ($null -ne $rng) { $rng.Dispose() }
    if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    if ($null -ne $keyMap) { $keyMap.Clear() }
    if ($null -ne $candidate) { $candidate.Clear() }
    $before.Clear()
    $service = $null; $bytes = $null; $result = $null
  }
  if ($published) {
    Write-Output 'SUPABASE_SERVICE_ROLE_KEY present = true'
    Write-Output 'YANDEX_SESSION_KEYS_JSON present = true'
    Write-Output 'YANDEX_SESSION_ACTIVE_KID present = true'
    Write-Output 'keyring parse = PASS'
    Write-Output 'active kid = PASS'
    Write-Output 'service role connection = PASS'
    Write-Output 'SETUP PASS'
  }
}

if ($MyInvocation.InvocationName -ne '.') { Initialize-YandexDevKeys }
