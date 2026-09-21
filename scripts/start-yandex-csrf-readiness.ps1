# One-shot browser PRELOAD CSRF -> native pipe -> pinned SSH -> VPS readiness.
# No provider request, queue claim, token persistence or terminal token output.
function Invoke-YandexCsrfReadiness {
  $ErrorActionPreference='Stop'
  $pipe=$null;$child=$null;$message=$null;$challenge=$null;$result=$null
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) { throw 'STOP' }
    . (Join-Path $PSScriptRoot 'yandex-native-protocol.ps1')

    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=(Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    $bridge=(Resolve-Path (Join-Path $PSScriptRoot '..\tools\vps14\vdsina-reply-readiness-bridge.cjs')).Path
    $start.ArgumentList.Add($bridge)
    $start.Environment['NODE_PATH']='C:\Users\tasfo\BusinessOS\Review-Activator-Tools\vps\ssh2node\node_modules'
    $child=[Diagnostics.Process]::Start($start)
    $errors=$child.StandardError.ReadToEndAsync()
    $task=$child.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(20000)) { throw 'STOP' }
    $line=$task.GetAwaiter().GetResult()
    if (-not $line -or $line.Length -gt 1000) { throw 'STOP' }
    $challenge=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($challenge.Count -ne 3 -or $challenge.version -ne 1 -or
        $challenge.nonce -isnot [string] -or $challenge.nonce -notmatch '^[A-Za-z0-9+/]{43}=$' -or
        ($challenge.expiresAt -isnot [long] -and $challenge.expiresAt -isnot [int]) -or
        $challenge.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -or
        $challenge.expiresAt -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+120000) { throw 'STOP' }

    $options=[IO.Pipes.PipeOptions]::Asynchronous -bor
      [IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::FirstPipeInstance
    $pipe=[IO.Pipes.NamedPipeServerStream]::new(
      $script:YandexPipeName,[IO.Pipes.PipeDirection]::InOut,1,
      [IO.Pipes.PipeTransmissionMode]::Byte,$options,65536,65536)
    Write-Output 'CSRF readiness ready (60 seconds). Click CSRF readiness in the extension.'
    $wait=$pipe.WaitForConnectionAsync()
    if (-not $wait.Wait(60000)) { throw 'STOP' }
    $null=$wait.GetAwaiter().GetResult()
    $deadline=[long]$challenge.expiresAt
    $hello=Read-YandexNativeFrame $pipe $deadline
    Assert-YandexNativeKeys $hello @('version','op','origin')
    if ($hello.version -ne 1 -or $hello.op -cne 'hello' -or
        $hello.origin -cne $script:YandexNativeOrigin) { throw 'STOP' }
    Write-YandexNativeFrame $pipe @{
      version=1;nonce=$challenge.nonce;expiresAt=$challenge.expiresAt
    } $deadline
    $message=Read-YandexNativeFrame $pipe $deadline
    Assert-YandexNativeKeys $message @('version','op','nonce','organizationId','token')
    $wire=$message | ConvertTo-Json -Compress -Depth 4 -WarningAction Stop
    if ([Text.Encoding]::UTF8.GetByteCount($wire) -gt 4096) { throw 'STOP' }
    $child.StandardInput.WriteLine($wire);$child.StandardInput.Close()
    $message.token=$null;$wire=$null

    $task=$child.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(15000)) { throw 'STOP' }
    $line=$task.GetAwaiter().GetResult()
    if (-not $line -or $line.Length -gt 1000) { throw 'STOP' }
    $result=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($result.ok -ne $true -or $result.operation -cne 'csrf_ready' -or
        $result.state -cne 'CSRF_READY' -or $result.organization_id -cne '54309413522' -or
        $result.session_match -ne $true -or $result.action_binding -ne $true -or
        $result.csrf_present -ne $true -or $result.csrf_length -lt 8 -or
        $result.csrf_length -gt 1024 -or $result.provider_requests -ne 0 -or
        $result.provider_writes -ne 0 -or $result.queue_claims -ne 0) { throw 'STOP' }
    Write-YandexNativeFrame $pipe @{ok=$true;state='CSRF_READY'} $deadline
    Write-Output ('CSRF_HANDOFF_READY csrf_length=' + $result.csrf_length +
      ' provider_requests=0 provider_writes=0 queue_claims=0')
    if (-not $child.WaitForExit(5000) -or $child.ExitCode -ne 0 -or
        $errors.GetAwaiter().GetResult() -ne '') { throw 'STOP' }
  } catch {
    Write-Output 'CSRF readiness not confirmed. No provider write was authorized.'
  } finally {
    if ($message -and $message.ContainsKey('token')) { $message.token=$null }
    if ($pipe) { $pipe.Dispose() }
    if ($child) { if (-not $child.HasExited) { $child.Kill() };$child.Dispose() }
    $challenge=$null;$result=$null;$message=$null
  }
}
if ($MyInvocation.InvocationName -ne '.') { Invoke-YandexCsrfReadiness }
