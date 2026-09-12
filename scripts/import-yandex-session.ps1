# Manual operator input adapter ONLY; the existing Node CLI owns validation/encryption/CAS.
# Run with & in the already configured private PowerShell 7. No session/key arguments.

function Read-YandexImportBuffer {
  param([scriptblock] $ReadKey)
  $buffer = [Security.SecureString]::new()
  $completed = $false; $invalid = $false; $tooLarge = $false; $escape = ''
  try {
    while ($true) {
      $key = & $ReadKey
      if ($key -isnot [ConsoleKeyInfo]) { throw 'IMPORT_INPUT_UNAVAILABLE' }
      $control = ($key.Modifiers -band [ConsoleModifiers]::Control) -ne 0
      if ($control -and $key.Key -eq [ConsoleKey]::C) { throw 'IMPORT_CANCELLED' }
      if ($control -and $key.Key -eq [ConsoleKey]::D) {
        if ($tooLarge) { throw 'IMPORT_INPUT_TOO_LARGE' }
        if ($invalid -or $escape) { throw 'IMPORT_INPUT_INVALID' }
        if (-not $buffer.Length) { throw 'IMPORT_INPUT_EMPTY' }
        $buffer.MakeReadOnly(); $completed = $true
        return $buffer
      }
      # Consume the entire paste before returning to the shell, including multiline
      # JSON. Enter never submits. On oversize/bad controls, wait for Ctrl+D/Ctrl+C.
      if ($invalid -or $tooLarge) { continue }
      if ($escape -or [int]$key.KeyChar -eq 27) {
        $escape += $key.KeyChar
        $startPaste = [string][char]27 + '[200~'
        $endPaste = [string][char]27 + '[201~'
        if ($escape -ceq $startPaste -or $escape -ceq $endPaste) { $escape = ''; continue }
        if (-not $startPaste.StartsWith($escape) -and -not $endPaste.StartsWith($escape)) { $invalid = $true }
        continue
      }
      if ($key.Key -eq [ConsoleKey]::Backspace) {
        if ($buffer.Length) { $buffer.RemoveAt($buffer.Length - 1) }
        continue
      }
      $character = $key.KeyChar
      if ($key.Key -eq [ConsoleKey]::Enter) { $character = [char]10 }
      if ([int]$character -lt 32 -and [int]$character -notin @(9,10,13)) { $invalid = $true; continue }
      if ($buffer.Length -ge 60000) { $tooLarge = $true; continue }
      $buffer.AppendChar($character)
    }
  } finally { if (-not $completed) { $buffer.Dispose() } }
}

function Read-YandexImportJson {
  param([string] $Prompt = 'Session JSON input is HIDDEN. Paste/type JSON; Ctrl+D submits; Ctrl+C cancels. Enter adds a newline.')
  if ([Console]::IsInputRedirected) { throw 'IMPORT_INTERACTIVE_CONSOLE_REQUIRED' }
  $previousControlMode = [Console]::TreatControlCAsInput
  try {
    [Console]::TreatControlCAsInput = $true
    [Console]::WriteLine($Prompt)
    return Read-YandexImportBuffer -ReadKey { [Console]::ReadKey($true) }
  } finally { [Console]::TreatControlCAsInput = $previousControlMode }
}

function New-YandexImportStartInfo {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $start.WorkingDirectory = Split-Path $PSScriptRoot -Parent
  $start.ArgumentList.Add((Join-Path $PSScriptRoot 'yandex-session.mjs'))
  $start.ArgumentList.Add('import')
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
  $start.Environment.Clear()
  foreach ($name in @('PATH','SystemRoot','WINDIR','TEMP','TMP','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA','SUPABASE_SERVICE_ROLE_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')) {
    $value = [Environment]::GetEnvironmentVariable($name,'Process')
    if ($value) { $start.Environment[$name] = $value }
  }
  $value = $null
  return $start
}

function Get-YandexImportPowerShellMajor { return $PSVersionTable.PSVersion.Major }

function Invoke-YandexManualImport {
  param([scriptblock] $InputReader = { Read-YandexImportJson })
  $ErrorActionPreference = 'Stop'
  $secure = $null; $bstr = [IntPtr]::Zero; $plain = $null; $session = $null; $payload = $null
  $child = $null; $start = $null; $started = $false; $confirmed = $false
  $failure = 'IMPORT_POWERSHELL_7_REQUIRED'
  try {
    if ((Get-YandexImportPowerShellMajor) -lt 7) { throw 'STOP' }
    $failure = 'IMPORT_CONFIG_MISSING'
    foreach ($name in @('SUPABASE_SERVICE_ROLE_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')) {
      if (-not [Environment]::GetEnvironmentVariable($name,'Process')) { throw 'STOP' }
    }
    $failure = 'IMPORT_LOCAL_RUNTIME_UNAVAILABLE'
    $start = New-YandexImportStartInfo
    $failure = 'IMPORT_SECURE_INPUT_FAILED'
    $secure = & $InputReader
    if ($secure -isnot [Security.SecureString]) { throw 'STOP' }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $failure = 'IMPORT_JSON_INVALID'
    $session = $plain | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    $payload = @{
      scope = @{ companyId='13f3cb80-487a-4a19-96a1-fb3103200230'; locationId='9a95f63b-18e6-447b-a449-8530b67ddbae'; organizationId='54309413522' }
      expectedRevision = 0
      session = $session
    } | ConvertTo-Json -Compress -Depth 12 -WarningAction Stop
    $failure = 'IMPORT_INPUT_TOO_LARGE'
    if ([Text.Encoding]::UTF8.GetByteCount($payload) -gt 70000) { throw 'STOP' }
    $failure = 'IMPORT_CLI_START_FAILED'
    $child = [Diagnostics.Process]::Start($start)
    $started = $true
    $failure = 'IMPORT_STDIN_TRANSFER_FAILED'
    $stdout = $child.StandardOutput.ReadToEndAsync()
    $stderr = $child.StandardError.ReadToEndAsync()
    $inputWrite = $child.StandardInput.WriteAsync($payload)
    if (-not $inputWrite.Wait(10000)) { throw 'STOP' }
    $child.StandardInput.Close()
    $failure = 'IMPORT_CLI_TIMEOUT'
    if (-not $child.WaitForExit(25000)) { throw 'STOP' }
    $failure = 'IMPORT_CLI_FAILED'
    if ($child.ExitCode -ne 0) { throw 'STOP' }
    $failure = 'IMPORT_STATUS_INVALID'
    $result = $stdout.GetAwaiter().GetResult() | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($result -isnot [Collections.IDictionary] -or $result.state -isnot [string] -or
        ($result.revision -isnot [long] -and $result.revision -isnot [int]) -or
        $result.state -cne 'NOT_CONFIGURED' -or $result.revision -ne 1 -or $result.errorCode) { throw 'STOP' }
    $confirmed = $true
  } catch {
    # Do not replay an uncertain request: the server may have committed before a timeout.
    if ($started) { Write-Output 'session imported = NOT_CONFIRMED' }
    else { Write-Output 'session imported = false' }
    Write-Output 'state = UNKNOWN'
    Write-Output ('error = ' + $failure)
  } finally {
    if ($null -ne $child) {
      if (-not $child.HasExited) { $child.Kill() }
      $child.Dispose()
    }
    if ($null -ne $start) { $start.Environment.Clear() }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($null -ne $secure) { $secure.Dispose() }
    $plain=$null; $session=$null; $payload=$null; $stdout=$null; $stderr=$null; $result=$null; $inputWrite=$null
  }
  if ($confirmed) {
    Write-Output 'session imported = true'
    Write-Output 'state = NOT_CONFIGURED'
    Write-Output 'revision = 1'
  }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-YandexManualImport }
