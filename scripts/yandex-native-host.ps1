# Chrome stdio binary protocol ONLY: never terminal output or raw errors.
# Chrome supplies a public origin argument, never cookies/keys in argv.
function Invoke-YandexNativeHost([string] $Origin) {
  $ErrorActionPreference='Stop'
  $pipe=$null; $message=$null; $reply=$null; $inputStream=$null; $outputStream=$null
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) { throw 'STOP' }
    . (Join-Path $PSScriptRoot 'yandex-native-protocol.ps1')
    if ($Origin -cne $script:YandexNativeOrigin) { throw 'STOP' }
    $inputStream=[Console]::OpenStandardInput(); $outputStream=[Console]::OpenStandardOutput()
    $deadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+120000
    $message=Read-YandexNativeFrame $inputStream $deadline
    Assert-YandexNativeKeys $message @('version','op')
    # Diagnostic terminates HERE: no pipe/importer connection, nonce, keys or RPC.
    if (($message.version -is [int] -or $message.version -is [long]) -and $message.version -eq 1 -and $message.op -ceq 'diagnose') {
      Write-YandexNativeFrame $outputStream @{version=1;diagnostic=$true;stage='NATIVE_HOST';code='PASS';import_calls=0} $deadline
      return
    }
    if ($message.version -cne 1 -or $message.op -cne 'hello') { throw 'STOP' }
    # CurrentUserOnly on CLIENT verifies server owner AND elevation; no TCP fallback.
    $options=[IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::CurrentUserOnly
    $pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$script:YandexPipeName,[IO.Pipes.PipeDirection]::InOut,$options)
    $pipe.Connect(3000)
    Write-YandexNativeFrame $pipe @{version=1;op='hello';origin=$Origin} $deadline
    $reply=Read-YandexNativeFrame $pipe $deadline
    Assert-YandexNativeKeys $reply @('version','nonce','expiresAt')
    Write-YandexNativeFrame $outputStream $reply $deadline
    $message=Read-YandexNativeFrame $inputStream $deadline
    Write-YandexNativeFrame $pipe $message $deadline
    $message=$null
    $reply=Read-YandexNativeFrame $pipe $deadline
    Assert-YandexNativeKeys $reply @('ok','state')
    if ($reply.ok -isnot [bool] -or $reply.state -cnotin @('NOT_CONFIGURED','NOT_CONFIRMED','CSRF_READY')) { throw 'STOP' }
    Write-YandexNativeFrame $outputStream $reply $deadline
  } catch {
    # Fixed response only, including malformed input/pipe failures. No exception replay.
    if ($outputStream) {
      try { Write-YandexNativeFrame $outputStream @{ok=$false;state='NOT_CONFIRMED'} ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+1000) } catch { }
    }
  } finally {
    if ($pipe) { $pipe.Dispose() }
    $message=$null; $reply=$null
  }
}
if ($MyInvocation.InvocationName -ne '.') { Invoke-YandexNativeHost $args[0] }
