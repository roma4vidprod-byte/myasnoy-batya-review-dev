# Stage 9: one browser CSRF handoff, then explicit console gate, then one writer invocation.
function Invoke-YandexApprovedWrite {
  $ErrorActionPreference='Stop'
  $pipe=$null;$child=$null;$message=$null;$challenge=$null;$result=$null
  $executionReleased=$false
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) { throw 'STOP' }
    . (Join-Path $PSScriptRoot 'yandex-native-protocol.ps1')
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=(Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    $bridge=(Resolve-Path (Join-Path $PSScriptRoot '..\tools\vps14\vdsina-reply-approved-bridge.cjs')).Path
    $start.ArgumentList.Add($bridge)
    $start.Environment['NODE_PATH']='C:\Users\tasfo\BusinessOS\Review-Activator-Tools\vps\ssh2node\node_modules'
    $child=[Diagnostics.Process]::Start($start)
    $errors=$child.StandardError.ReadToEndAsync()
    $task=$child.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(20000)) { throw 'STOP' }
    $line=$task.GetAwaiter().GetResult()
    $challenge=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($challenge.Count -ne 3 -or $challenge.version -ne 1 -or
        $challenge.nonce -notmatch '^[A-Za-z0-9+/]{43}=$') { throw 'STOP' }
    $options=[IO.Pipes.PipeOptions]::Asynchronous -bor
      [IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::FirstPipeInstance
    $pipe=[IO.Pipes.NamedPipeServerStream]::new(
      $script:YandexPipeName,[IO.Pipes.PipeDirection]::InOut,1,
      [IO.Pipes.PipeTransmissionMode]::Byte,$options,65536,65536)
    Write-Output 'STAGE9_BROWSER_HANDOFF_READY. Click CSRF readiness in the extension.'
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
    $child.StandardInput.WriteLine($wire)
    $message.token=$null;$wire=$null
    $task=$child.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(15000)) { throw 'STOP' }
    $ready=$task.GetAwaiter().GetResult() | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($ready.ok -ne $true -or $ready.operation -cne 'csrf_ready' -or
        $ready.state -cne 'CSRF_READY' -or
        $ready.action_id -cne 'bd961975-5f88-44b6-b6b6-19ae626199b4' -or
        $ready.session_match -ne $true -or $ready.action_binding -ne $true -or
        $ready.provider_requests -ne 0 -or $ready.provider_writes -ne 0 -or
        $ready.queue_claims -ne 0) { throw 'STOP' }
    Write-YandexNativeFrame $pipe @{ok=$true;state='CSRF_READY'} $deadline
    $pipe.Dispose();$pipe=$null
    Write-Output 'STAGE9_CSRF_READY_WAITING_APPROVAL provider_requests=0 provider_writes=0 queue_claims=0'
    $goTask=[Console]::In.ReadLineAsync()
    if (-not $goTask.Wait(90000) -or $goTask.GetAwaiter().GetResult() -cne 'EXECUTE_APPROVED') {
      throw 'STOP'
    }
    $execute=@{
      version=1;op='execute'
      actionId='bd961975-5f88-44b6-b6b6-19ae626199b4'
      fingerprint='fd3cec79843a55631abc7fb81d8fc70a33a0ae18a5ed76f78c453f02d1bfcd08'
      idempotencyKey='703eafa5-be32-4480-9909-fd50a1a2b20b'
    } | ConvertTo-Json -Compress
    $executionReleased=$true
    $child.StandardInput.WriteLine($execute);$child.StandardInput.Close()
    $task=$child.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(90000)) { throw 'STOP' }
    $line=$task.GetAwaiter().GetResult()
    $result=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    Write-Output ('STAGE9_RESULT ' + ($result | ConvertTo-Json -Compress -Depth 4))
    if (-not $child.WaitForExit(5000)) { throw 'STOP' }
    $stderr=$errors.GetAwaiter().GetResult()
    if ($stderr -ne '') { throw 'STOP' }
    if ($result.ok -eq $true -and $result.status -ceq 'SENT' -and
        $result.providerWrites -eq 1 -and $child.ExitCode -eq 0) {
      Write-Output 'STAGE9_ONE_POST_CONFIRMED'
      return
    }
    Write-Output 'STAGE9_COMPLETED_WITH_NON_SUCCESS_NO_RETRY'
  } catch {
    if ($executionReleased) {
      Write-Output 'STAGE9_RESULT_UNKNOWN_NO_RETRY'
    } else {
      Write-Output 'STAGE9_STOPPED_BEFORE_EXECUTE'
    }
  } finally {
    if ($message -and $message.ContainsKey('token')) { $message.token=$null }
    if ($pipe) { $pipe.Dispose() }
    if ($child) { if (-not $child.HasExited) { $child.Kill() };$child.Dispose() }
    $challenge=$null;$result=$null;$message=$null
  }
}
if ($MyInvocation.InvocationName -ne '.') { Invoke-YandexApprovedWrite }
