# Run with & in the SAME private PS7 containing the existing process keys.
# This listener uses Windows same-user pipes, not localhost TCP.
function Invoke-YandexLocalImport {
  $ErrorActionPreference='Stop'
  $pipe=$null; $challenge=$null; $session=$null; $message=$null; $secure=$null; $result=$null
  $failure='NATIVE_WINDOWS_POWERSHELL_7_REQUIRED'
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) { throw 'STOP' }
    $failure='NATIVE_CONFIG_MISSING_USE_SAME_CONSOLE'
    foreach ($name in @('SUPABASE_SERVICE_ROLE_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID')) {
      if (-not [Environment]::GetEnvironmentVariable($name,'Process')) { throw 'STOP' }
    }
    . (Join-Path $PSScriptRoot 'yandex-native-protocol.ps1')
    . (Join-Path $PSScriptRoot 'import-yandex-session.ps1')
    $failure='NATIVE_NODE_UNAVAILABLE'
    $probe = New-YandexImportStartInfo
    $probe.Environment.Clear(); $probe=$null
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
    $challenge=New-YandexNativeChallenge $message $deadline
    Write-YandexNativeFrame $pipe @{version=1;nonce=$challenge.nonce;expiresAt=$deadline} $deadline
    $message=Read-YandexNativeFrame $pipe $deadline
    # Sole existing CLI owns validation, encryption and CAS; fixed scope/revision.
    $failure='NATIVE_IMPORT_NOT_CONFIRMED'
    $reply=Invoke-YandexNativeImportMessage $message $challenge
    # RPC may already have committed. Reply failure must not imply cancellation.
    Write-YandexNativeFrame $pipe $reply ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+5000)
    if ($reply.ok) { Write-Output 'Session imported'; Write-Output 'State: NOT_CONFIGURED' }
    else { Write-Output 'Import not confirmed. Stop; do not retry.' }
  } catch {
    Write-Output ('Import stopped ['+$failure+']. If submission started, check status before retry.')
  } finally {
    if ($pipe) { $pipe.Dispose() }
    if ($secure) { $secure.Dispose() }
    if ($challenge) { $challenge.nonce=$null; $challenge.used=$true }
    $session=$null; $message=$null; $result=$null; $reply=$null; $wait=$null
  }
}
if ($MyInvocation.InvocationName -ne '.') {
  if ($args.Count) { Write-Output 'Importer stopped: arguments are not accepted.' }
  else { Invoke-YandexLocalImport }
}
