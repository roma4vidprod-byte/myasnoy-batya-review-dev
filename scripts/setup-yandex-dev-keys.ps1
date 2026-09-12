# Run manually with & in a private PowerShell 7 window. No values in arguments/files.
# Do not run in an agent-controlled, recorded, transcribed or debug-traced terminal.
# Dot-sourcing loads functions only (used by offline tests).

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
  $safe = [ordered]@{
    env_present = [ordered]@{}
    keyring_parse = 'FAIL'; active_kid_exists = 'FAIL'; service_role_connection = 'FAIL'
  }
  foreach ($name in $names) { $safe.env_present[$name] = $false }
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'POWERSHELL_7_REQUIRED' }
    foreach ($name in $names) {
      if ([Environment]::GetEnvironmentVariable($name, 'Process')) { throw 'EXISTING_CONFIG_STOP' }
    }
    if ([Environment]::GetEnvironmentVariable('YANDEX_LIVE_READ_APPROVAL', 'Process')) { throw 'LIVE_APPROVAL_STOP' }
    # Prompt input is not a shell command: no key in PSReadLine history or argv.
    $secure = Read-Host 'Review Activator DEV service_role key (hidden; never paste into chat)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $service = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($service)) { throw 'EMPTY_KEY' }
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
    $result = Invoke-YandexDevKeyCheck -Candidate $candidate
    # Reconstruct an allowlisted, typed report; never print arbitrary child output.
    foreach ($name in $names) {
      if ($result.Report.env_present[$name] -isnot [bool]) { throw 'CHECK_FORMAT' }
    }
    foreach ($field in @('keyring_parse','active_kid_exists','service_role_connection')) {
      if ($result.Report[$field] -isnot [string] -or $result.Report[$field] -cnotin @('PASS','FAIL')) { throw 'CHECK_FORMAT' }
    }
    foreach ($name in $names) { $safe.env_present[$name] = $result.Report.env_present[$name] }
    foreach ($field in @('keyring_parse','active_kid_exists','service_role_connection')) { $safe[$field] = $result.Report[$field] }
    if ($result.Code -ne 0 -or $safe.env_present.Values -contains $false -or
        $safe.keyring_parse -ne 'PASS' -or $safe.active_kid_exists -ne 'PASS' -or
        $safe.service_role_connection -ne 'PASS') { throw 'CHECK_FAILED' }
    # Publish only after every check passes. This changes this PowerShell process,
    # not User/Machine environment, not a file, not the Codex app process.
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $candidate[$name], 'Process') }
    $published = $true
  } catch {
    # Roll back only values created by this invocation; preserve pre-existing config.
    if ($null -ne $candidate) {
      foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    }
    Write-Output 'SETUP STOPPED. No new configuration retained. Do not import or retry blindly.'
  } finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($null -ne $secure) { $secure.Dispose() }
    if ($null -ne $rng) { $rng.Dispose() }
    if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    if ($null -ne $keyMap) { $keyMap.Clear() }
    if ($null -ne $candidate) { $candidate.Clear() }
    $service = $null; $bytes = $null; $result = $null
  }
  # Presence here means retained configuration in THIS process, not the candidate.
  foreach ($name in $names) { $safe.env_present[$name] = [bool][Environment]::GetEnvironmentVariable($name, 'Process') }
  Write-Output ($safe | ConvertTo-Json -Depth 4 -Compress)
  if ($published) { Write-Output 'SETUP PASS. Keep this private window open. STOP: session import needs separate confirmation.' }
}

if ($MyInvocation.InvocationName -ne '.') { Initialize-YandexDevKeys }
