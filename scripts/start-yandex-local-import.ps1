# Run with & in PowerShell 7. Only REVIEW_WORKER_SECRET is needed locally.
# This listener uses Windows same-user pipes, not localhost TCP; Vercel Preview
# owns validation, encryption and CAS.
function Invoke-YandexLocalImport {
  $ErrorActionPreference='Stop'
  $pipe=$null; $challenge=$null; $remoteApproval=$null; $message=$null; $secure=$null; $result=$null; $wireReply=$null
  $failure='NATIVE_WINDOWS_POWERSHELL_7_REQUIRED'
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) { throw 'STOP' }
    $failure='NATIVE_CONFIG_MISSING_USE_SAME_CONSOLE'
    foreach ($name in @('REVIEW_WORKER_SECRET')) {
      if (-not [Environment]::GetEnvironmentVariable($name,'Process')) { throw 'STOP' }
    }
    . (Join-Path $PSScriptRoot 'yandex-native-protocol.ps1')
    . (Join-Path $PSScriptRoot 'import-yandex-session.ps1')
    $failure='NATIVE_REMOTE_APPROVAL_FAILED'
    $remoteApproval=Get-YandexRemoteImportApproval
    $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+120000
    $options = [IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::FirstPipeInstance
    $failure='NATIVE_PIPE_UNAVAILABLE'
    $pipe = [IO.Pipes.NamedPipeServerStream]::new($script:YandexPipeName,[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,$options,65536,65536)
    Write-Output 'Importer ready (120 seconds). Click Connect in the extension. Ctrl+C cancels before import.'
    $failure='NATIVE_CANCELLED_EXPIRED_OR_INVALID'
    $wait=$pipe.WaitForConnectionAsync()
    if (-not $wait.Wait(120000)) { throw 'STOP' }
    $null=$wait.GetAwaiter().GetResult()
    $message=Read-YandexNativeFrame $pipe $deadline
    $challenge=New-YandexNativeChallenge $message $deadline $remoteApproval
    Write-YandexNativeFrame $pipe @{version=1;nonce=$challenge.nonce;expiresAt=$challenge.deadline} $deadline
    $message=Read-YandexNativeFrame $pipe $deadline
    # Vercel Preview owns validation, encryption and CAS; scope/revision are fixed there.
    $failure='NATIVE_IMPORT_NOT_CONFIRMED'
    $reply=Invoke-YandexNativeImportMessage $message $challenge
    # RPC may already have committed. Reply failure must not imply cancellation.
    $wireReply=@{ok=($reply.ok -eq $true);state=if($reply.ok -eq $true){'NOT_CONFIGURED'}else{'NOT_CONFIRMED'}}
    Write-YandexNativeFrame $pipe $wireReply ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+5000)
    if ($reply.ok) {
      if ($reply.revision -ne ([long]$challenge.expectedRevision+1)) { throw 'STOP' }
      Write-Output 'session imported = true'
      Write-Output 'state = NOT_CONFIGURED'
      Write-Output ('revision = ' + $reply.revision)
    }
    else { Write-Output 'Import not confirmed. Stop; do not retry.' }
  } catch {
    Write-Output ('Import stopped ['+$failure+']. If submission started, check status before retry.')
  } finally {
    if ($pipe) { $pipe.Dispose() }
    if ($secure) { $secure.Dispose() }
    if ($challenge) { $challenge.nonce=$null; $challenge.capability=$null; $challenge.used=$true }
    if ($remoteApproval) { $remoteApproval.nonce=$null; $remoteApproval.capability=$null }
    $script:YandexRemoteImportContext=$null
    $message=$null; $result=$null; $reply=$null; $wireReply=$null; $wait=$null
  }
}
if ($MyInvocation.InvocationName -ne '.') {
  if ($args.Count) { Write-Output 'Importer stopped: arguments are not accepted.' }
  else { Invoke-YandexLocalImport }
}
