# Fixed private SSH target. No plaintext disk/argv/env, HTTP or Cloud fallback.
$script:YandexVpsChild=$null
$script:YandexVpsErrors=$null
function Close-YandexVpsImport {
  if ($script:YandexVpsChild) {
    if (-not $script:YandexVpsChild.HasExited) { $script:YandexVpsChild.Kill() }
    $script:YandexVpsChild.Dispose()
  }
  $script:YandexVpsChild=$null; $script:YandexVpsErrors=$null
}
function Get-YandexVpsImportApproval {
  $line=$null; $approval=$null
  try {
    if ($script:YandexVpsChild) { throw 'VPS_IMPORT_ALREADY_STARTED' }
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=(Get-Command ssh.exe -CommandType Application -ErrorAction Stop).Source
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $start.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    foreach ($arg in @('-T','-4','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
      '-o','ConnectTimeout=10','-o','UserKnownHostsFile=C:\Users\tasfo\BusinessOS\Review-Activator-Tools\vps\known_hosts',
      '-o','KexAlgorithms=curve25519-sha256','-i','C:\Users\tasfo\BusinessOS\Review-Activator-Tools\vps\reviewadmin_ed25519',
      'reviewadmin@141.98.87.15',
      'sudo -n -u review-yandex-import -- env -i PATH=/usr/bin:/bin RA_RUNTIME_PROFILE=vps-lab RA_YANDEX_MODE=read-only-admin /opt/node/bin/node /opt/review-activator-yandex/tools/vps08a/session.mjs import')) { $start.ArgumentList.Add($arg) }
    $script:YandexVpsChild=[Diagnostics.Process]::Start($start)
    $script:YandexVpsErrors=$script:YandexVpsChild.StandardError.ReadToEndAsync()
    $task=$script:YandexVpsChild.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(20000)) { throw 'VPS_IMPORT_UNAVAILABLE' }
    $line=$task.GetAwaiter().GetResult()
    if (-not $line -or $line.Length -gt 1000) { throw 'VPS_IMPORT_UNAVAILABLE' }
    $approval=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($approval.ok -ne $true -or $approval.operation -cne 'import_prepare' -or $approval.expectedRevision -ne 0) { throw 'VPS_IMPORT_DENIED' }
    return @{ nonce=$approval.nonce;expiresAt=$approval.expiresAt;expectedRevision=0;capability='vps-private-ssh' }
  } catch { Close-YandexVpsImport; throw 'VPS_IMPORT_UNAVAILABLE' }
  finally { $line=$null; $approval=$null; $task=$null }
}
function Invoke-YandexVpsSessionImport($Message,$Challenge) {
  $payload=$null; $line=$null; $result=$null
  try {
    if (-not $script:YandexVpsChild -or $Challenge.target -cne 'vps-lab') { throw 'VPS_IMPORT_DENIED' }
    $payload=@{nonce=$Message.nonce;session=$Message.session} | ConvertTo-Json -Compress -Depth 12 -WarningAction Stop
    if ([Text.Encoding]::UTF8.GetByteCount($payload) -gt 65000) { throw 'VPS_IMPORT_SIZE' }
    $task=$script:YandexVpsChild.StandardInput.WriteLineAsync($payload)
    if (-not $task.Wait(10000)) { throw 'VPS_IMPORT_NOT_CONFIRMED' }
    $script:YandexVpsChild.StandardInput.Close()
    $task=$script:YandexVpsChild.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(20000)) { throw 'VPS_IMPORT_NOT_CONFIRMED' }
    $line=$task.GetAwaiter().GetResult()
    if (-not $line -or $line.Length -gt 1000) { throw 'VPS_IMPORT_NOT_CONFIRMED' }
    $result=$line | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($result.ok -ne $true -or $result.state -cne 'NOT_CONFIGURED' -or $result.revision -ne 1) { throw 'VPS_IMPORT_NOT_CONFIRMED' }
    return @{ok=$true;state='NOT_CONFIGURED';revision=1}
  } catch { throw 'VPS_IMPORT_NOT_CONFIRMED' }
  finally { $payload=$null; $line=$null; $result=$null; $task=$null; Close-YandexVpsImport }
}
