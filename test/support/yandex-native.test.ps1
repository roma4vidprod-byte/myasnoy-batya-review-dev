param([string] $Mode)
$ErrorActionPreference='Stop'
try {
  . (Join-Path $PSScriptRoot '../../scripts/yandex-native-protocol.ps1')
  . (Join-Path $PSScriptRoot '../../scripts/import-yandex-session.ps1')
  . (Join-Path $PSScriptRoot '../../scripts/install-yandex-native-host.ps1')
  $deadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+5000
  $hello=@{version=1;op='hello';origin=$script:YandexNativeOrigin}
  $material=@{account='myasnoibatya-zakaz';cookies=@(@{name='fixture';value='synthetic-cookie-native';domain='.yandex.ru';path='/';secure=$true;httpOnly=$true;expires=-1})}
  if ($Mode -eq 'registration') {
    $c=Get-YandexNativeRegistration (Join-Path $PSHOME 'pwsh.exe') (Join-Path $PSScriptRoot '../../scripts/yandex-native-host.ps1')
    if ($c.manifest.allowed_origins.Count -ne 1 -or $c.manifest.allowed_origins[0] -cne $hello.origin -or $c.launcher -match 'SYNTHETIC|BYPASS|Cookie|SERVICE_ROLE') { throw 'FAIL' }
  } elseif ($Mode -in @('framing','oversize','malformed','truncated','read_expired')) {
    $stream=[IO.MemoryStream]::new()
    try {
      if ($Mode -eq 'oversize') { $stream.Write([BitConverter]::GetBytes([uint32]65001)) }
      elseif ($Mode -eq 'malformed') { $stream.Write([BitConverter]::GetBytes([uint32]2));$stream.Write([byte[]]@(255,255)) }
      elseif ($Mode -eq 'truncated') { $stream.Write([byte[]]@(1,2)) }
      else { Write-YandexNativeFrame $stream $material $deadline }
      $stream.Position=0
      if ($Mode -eq 'read_expired') { $deadline=0 }
      $rejected=$false
      try { $decoded=Read-YandexNativeFrame $stream $deadline } catch { $rejected=$true }
      if ($Mode -eq 'framing') {
        if ($rejected -or $decoded.cookies[0].value -cne $material.cookies[0].value) { throw 'FAIL' }
      } elseif (-not $rejected) { throw 'FAIL' }
    } finally { $stream.Dispose() }
  } elseif ($Mode -in @('host_roundtrip','host_cancel')) {
    $options=[IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::FirstPipeInstance
    $server=[IO.Pipes.NamedPipeServerStream]::new($script:YandexPipeName,[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,$options,65536,65536)
    $child=$null
    try {
      $start=[Diagnostics.ProcessStartInfo]::new()
      $start.FileName=Join-Path $PSHOME 'pwsh.exe'
      foreach ($arg in @('-NoLogo','-NoProfile','-NonInteractive','-File',(Join-Path $PSScriptRoot '../../scripts/yandex-native-host.ps1'),$hello.origin)) { $start.ArgumentList.Add($arg) }
      $start.UseShellExecute=$false;$start.CreateNoWindow=$true
      $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
      $child=[Diagnostics.Process]::Start($start)
      $stderr=$child.StandardError.ReadToEndAsync()
      $wait=$server.WaitForConnectionAsync()
      $deadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+8000
      Write-YandexNativeFrame $child.StandardInput.BaseStream @{version=1;op='hello'} $deadline
      if (-not $wait.Wait(4000)) { throw 'FAIL' };$null=$wait.GetAwaiter().GetResult()
      $h=Read-YandexNativeFrame $server $deadline
      $challenge=New-YandexNativeChallenge $h $deadline
      Write-YandexNativeFrame $server @{version=1;nonce=$challenge.nonce;expiresAt=$deadline} $deadline
      $h=Read-YandexNativeFrame $child.StandardOutput.BaseStream $deadline
      if ($h.nonce -cne $challenge.nonce) { throw 'FAIL' }
      if ($Mode -eq 'host_cancel') {
        $child.StandardInput.Close()
        $denied=$false
        try { $null=Read-YandexNativeFrame $server $deadline } catch { $denied=$true }
        if (-not $denied -or $challenge.used) { throw 'FAIL' }
      } else {
        Write-YandexNativeFrame $child.StandardInput.BaseStream @{version=1;op='import';nonce=$h.nonce;session=$material} $deadline
        $message=Read-YandexNativeFrame $server $deadline
        $env:SUPABASE_SERVICE_ROLE_KEY='sb_secret_SYNTHETIC_NOT_VALID'
        $env:YANDEX_SESSION_KEYS_JSON=@{fixture=[Convert]::ToBase64String([byte[]]::new(32))} | ConvertTo-Json -Compress
        $env:YANDEX_SESSION_ACTIVE_KID='fixture'
        $script:original=(Get-Command New-YandexImportStartInfo).ScriptBlock
        function New-YandexImportStartInfo {
          $s=& $script:original
          $s.ArgumentList.Insert(0,'--import');$s.ArgumentList.Insert(1,'./test/support/yandex-import-rpc.mock.mjs')
          return $s
        }
        $reply=Invoke-YandexNativeImportMessage $message $challenge
        Write-YandexNativeFrame $server $reply $deadline
        $received=Read-YandexNativeFrame $child.StandardOutput.BaseStream $deadline
        if (-not $received.ok -or $received.state -cne 'NOT_CONFIGURED') { throw 'FAIL' }
      }
      if (-not $child.WaitForExit(3000) -or $stderr.GetAwaiter().GetResult() -cne '') { throw 'FAIL' }
    } finally {
      if ($child) { if (-not $child.HasExited) { $child.Kill() };$child.Dispose() }
      $server.Dispose()
    }
  } elseif ($Mode -eq 'pipe') {
    $pipeName='review-dev-test-'+[Guid]::NewGuid().ToString('N')
    $options=[IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::Asynchronous
    $server=[IO.Pipes.NamedPipeServerStream]::new($pipeName,[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,($options -bor [IO.Pipes.PipeOptions]::FirstPipeInstance),65536,65536)
    $client=[IO.Pipes.NamedPipeClientStream]::new('.',$pipeName,[IO.Pipes.PipeDirection]::InOut,$options)
    try {
      $wait=$server.WaitForConnectionAsync();$client.Connect(1000);$null=$wait.GetAwaiter().GetResult()
      Write-YandexNativeFrame $client $hello $deadline
      $received=Read-YandexNativeFrame $server $deadline
      if ($received.origin -cne $hello.origin) { throw 'FAIL' }
    } finally { $client.Dispose();$server.Dispose() }
  } else {
    if ($Mode -eq 'origin') { $hello.origin='chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' }
    if ($Mode -eq 'hello_expired') { $deadline=0 }
    $denied=$false
    try { $challenge=New-YandexNativeChallenge $hello $deadline } catch { $denied=$true }
    if ($Mode -in @('origin','hello_expired')) { if (-not $denied) { throw 'FAIL' } }
    else {
      if ($denied -or $challenge.nonce -notmatch '^[A-Za-z0-9+/]{43}=$') { throw 'FAIL' }
      $message=@{version=1;op='import';nonce=$challenge.nonce;session=$material}
      if ($Mode -eq 'nonce') { $message.nonce='bad' }
      if ($Mode -eq 'expired') { $challenge.deadline=0 }
      if ($Mode -eq 'extra') { $message.scope='wrong' }
      if ($Mode -eq 'version') { $message.version='1' }
      if ($Mode -eq 'cancel') { $message.op='cancel' }
      if ($Mode -in @('nonce','expired','extra','version','cancel','replay')) {
        $denied=$false
        try { $null=Take-YandexNativeSession $message $challenge } catch { $denied=$true }
        if ($Mode -ne 'replay' -and -not $denied) { throw 'FAIL' }
        $denied=$false
        try { $null=Take-YandexNativeSession $message $challenge } catch { $denied=$true }
        if (-not $denied -or -not $challenge.used) { throw 'FAIL' }
      } else {
        $env:SUPABASE_SERVICE_ROLE_KEY='sb_secret_SYNTHETIC_NOT_VALID'
        $env:YANDEX_SESSION_KEYS_JSON=@{fixture=[Convert]::ToBase64String([byte[]]::new(32))} | ConvertTo-Json -Compress
        $env:YANDEX_SESSION_ACTIVE_KID='fixture'
        $script:original=(Get-Command New-YandexImportStartInfo).ScriptBlock
        function New-YandexImportStartInfo {
          $s=& $script:original
          $s.ArgumentList.Insert(0,'--import');$s.ArgumentList.Insert(1,'./test/support/yandex-import-rpc.mock.mjs')
          return $s
        }
        $response=Invoke-YandexNativeImportMessage $message $challenge
        if ($response.ok -ne $true -or $response.state -cne 'NOT_CONFIGURED' -or -not $challenge.used) { throw 'FAIL' }
      }
    }
  }
  Write-Output 'PASS: native synthetic fixture'
} catch { Write-Output 'FAIL: native synthetic fixture'; exit 1 }
