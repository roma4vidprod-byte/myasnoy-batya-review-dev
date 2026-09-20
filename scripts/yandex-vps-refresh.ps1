# One-shot VDSina session refresh adapter. No Cloud fallback and no provider IO.
$script:YandexVpsChild=$null
$script:YandexVpsErrors=$null

function Close-YandexVpsImport {
  if ($script:YandexVpsChild) {
    if (-not $script:YandexVpsChild.HasExited) { $script:YandexVpsChild.Kill() }
    $script:YandexVpsChild.Dispose()
  }
  $script:YandexVpsChild=$null
  $script:YandexVpsErrors=$null
}

function Get-YandexVpsImportApproval {
  $line=$null; $approval=$null
  try {
    if ($script:YandexVpsChild) { throw 'VPS_REFRESH_ALREADY_STARTED' }
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=(Get-Command ssh.exe -CommandType Application -ErrorAction Stop).Source
    $start.UseShellExecute=$false
    $start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true
    $start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    $start.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    foreach ($arg in @(
      '-T','-4',
      '-o','BatchMode=yes',
      '-o','IdentitiesOnly=yes',
      '-o','StrictHostKeyChecking=yes',
      '-o','PasswordAuthentication=no',
      '-o','KbdInteractiveAuthentication=no',
      '-o','ConnectTimeout=12',
      '-o','UserKnownHostsFile=C:\Users\tasfo\BusinessOS\Review-Activator-Tools\vps\vdsina_known_hosts',
      '-i','C:\Users\tasfo\BusinessOS\Review-Activator-Tools\vps\reviewadmin_ed25519',
      'root@83.217.214.29',
      '/usr/sbin/runuser -u review-yandex-import -- /usr/bin/env -i PATH=/usr/bin:/bin RA_RUNTIME_PROFILE=vps-lab RA_YANDEX_MODE=read-only-admin /opt/node/bin/node /opt/review-activator-yandex/tools/vps14/session-refresh.mjs'
    )) { $start.ArgumentList.Add($arg) }

    $script:YandexVpsChild=[Diagnostics.Process]::Start($start)
    $script:YandexVpsErrors=$script:YandexVpsChild.StandardError.ReadToEndAsync()
    $task=$script:YandexVpsChild.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(20000)) { throw 'VPS_REFRESH_UNAVAILABLE' }
    $line=$task.GetAwaiter().GetResult()
    if (-not $line -or $line.Length -gt 1000) { throw 'VPS_REFRESH_UNAVAILABLE' }
    $approval=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($approval.ok -ne $true -or
        $approval.operation -cne 'refresh_prepare' -or
        $approval.expectedRevision -ne 4) {
      throw 'VPS_REFRESH_DENIED'
    }
    return @{
      nonce=$approval.nonce
      expiresAt=$approval.expiresAt
      expectedRevision=4
      capability='vps-private-ssh'
    }
  } catch {
    Close-YandexVpsImport
    throw 'VPS_REFRESH_UNAVAILABLE'
  } finally {
    $line=$null; $approval=$null; $task=$null
  }
}

function Invoke-YandexVpsSessionImport($Message,$Challenge) {
  $payload=$null; $line=$null; $result=$null
  try {
    if (-not $script:YandexVpsChild -or $Challenge.target -cne 'vps-lab' -or
        $Challenge.expectedRevision -ne 4) {
      throw 'VPS_REFRESH_DENIED'
    }
    $payload=@{nonce=$Message.nonce;session=$Message.session} |
      ConvertTo-Json -Compress -Depth 12 -WarningAction Stop
    if ([Text.Encoding]::UTF8.GetByteCount($payload) -gt 65000) {
      throw 'VPS_REFRESH_SIZE'
    }

    $task=$script:YandexVpsChild.StandardInput.WriteLineAsync($payload)
    if (-not $task.Wait(10000)) { throw 'VPS_REFRESH_NOT_CONFIRMED' }
    $script:YandexVpsChild.StandardInput.Close()
    $task=$script:YandexVpsChild.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(20000)) { throw 'VPS_REFRESH_NOT_CONFIRMED' }
    $line=$task.GetAwaiter().GetResult()
    if (-not $line -or $line.Length -gt 1000) { throw 'VPS_REFRESH_NOT_CONFIRMED' }

    $result=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($result.ok -ne $true -or
        $result.operation -cne 'refresh' -or
        $result.state -cne 'NOT_CONFIGURED' -or
        $result.revision -ne 5 -or
        $result.provider_requests -ne 0 -or
        $result.provider_writes -ne 0) {
      throw 'VPS_REFRESH_NOT_CONFIRMED'
    }
    return @{ok=$true;state='NOT_CONFIGURED';revision=5}
  } catch {
    throw 'VPS_REFRESH_NOT_CONFIRMED'
  } finally {
    $payload=$null; $line=$null; $result=$null; $task=$null
    Close-YandexVpsImport
  }
}
