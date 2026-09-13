# Local binary framing only. No HTTP, files, logging or credential engine.
$script:YandexNativeOrigin = 'chrome-extension://gdjhmlbffahmpnphfoogegihhnfkoojm/'
$script:YandexPipeName = 'review_activator_dev_yandex_v4_gdjhmlbffahmpnphfoogegihhnfkoojm'

function Assert-YandexNativeKeys($Object, [string[]] $Keys) {
  if ($Object -isnot [Collections.IDictionary] -or $Object.Count -ne $Keys.Count) { throw 'NATIVE_INVALID' }
  foreach ($key in $Object.Keys) { if ($key -cnotin $Keys) { throw 'NATIVE_INVALID' } }
}
function Read-YandexNativeFrame([IO.Stream] $Stream, [long] $Deadline) {
  $head = [byte[]]::new(4); $body = $null
  try {
    foreach ($part in @(0,1)) {
      $buffer = $head
      if ($part -eq 1) { $buffer = $body }
      $offset = 0
      while ($offset -lt $buffer.Length) {
        $remaining = $Deadline - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($remaining -le 0) { throw 'NATIVE_EXPIRED' }
        $task = $Stream.ReadAsync($buffer,$offset,$buffer.Length-$offset)
        if (-not $task.Wait([int][Math]::Min($remaining,120000))) { throw 'NATIVE_EXPIRED' }
        $read = $task.GetAwaiter().GetResult()
        if ($read -le 0) { throw 'NATIVE_CANCELLED' }
        $offset += $read
      }
      if ($part -eq 0) {
        $length = [BitConverter]::ToUInt32($head,0)
        if ($length -lt 2 -or $length -gt 65000) { throw 'NATIVE_SIZE' }
        $body = [byte[]]::new($length)
      }
    }
    $encoding = [Text.UTF8Encoding]::new($false,$true)
    return ($encoding.GetString($body) | ConvertFrom-Json -AsHashtable -ErrorAction Stop)
  } finally {
    [Array]::Clear($head,0,$head.Length)
    if ($body) { [Array]::Clear($body,0,$body.Length) }
    $buffer=$null; $task=$null
  }
}
function Write-YandexNativeFrame([IO.Stream] $Stream, $Message, [long] $Deadline) {
  $bytes=$null; $text=$null
  try {
    $text = $Message | ConvertTo-Json -Compress -Depth 12 -WarningAction Stop
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text)
    if ($bytes.Length -gt 65000) { throw 'NATIVE_SIZE' }
    foreach ($buffer in @([BitConverter]::GetBytes([uint32]$bytes.Length),$bytes)) {
      $remaining = $Deadline - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      if ($remaining -le 0) { throw 'NATIVE_EXPIRED' }
      $task = $Stream.WriteAsync($buffer,0,$buffer.Length)
      if (-not $task.Wait([int][Math]::Min($remaining,120000))) { throw 'NATIVE_EXPIRED' }
      $null=$task.GetAwaiter().GetResult()
    }
    $Stream.Flush()
  } finally { if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }; $text=$null; $buffer=$null; $task=$null }
}
function New-YandexNativeChallenge($Hello, [long] $Deadline, $RemoteApproval = $null) {
  Assert-YandexNativeKeys $Hello @('version','op','origin')
  if (($Hello.version -isnot [int] -and $Hello.version -isnot [long]) -or $Hello.version -ne 1 -or $Hello.op -cne 'hello' -or $Hello.origin -cne $script:YandexNativeOrigin -or
      [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $Deadline) { throw 'NATIVE_DENIED' }
  if ($null -ne $RemoteApproval) {
    if ($RemoteApproval.nonce -isnot [string] -or $RemoteApproval.nonce -notmatch '^[A-Za-z0-9+/]{43}=$' -or
        ($RemoteApproval.expiresAt -isnot [long] -and $RemoteApproval.expiresAt -isnot [int]) -or
        $RemoteApproval.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -or
        $RemoteApproval.expiresAt -gt $Deadline -or $RemoteApproval.capability -isnot [string] -or
        ($RemoteApproval.expectedRevision -isnot [long] -and $RemoteApproval.expectedRevision -isnot [int]) -or
        $RemoteApproval.expectedRevision -lt 0) { throw 'NATIVE_DENIED' }
    return @{ nonce=$RemoteApproval.nonce; deadline=[long]$RemoteApproval.expiresAt;
      capability=$RemoteApproval.capability; expectedRevision=[long]$RemoteApproval.expectedRevision; used=$false }
  }
  $random = [byte[]]::new(32)
  try {
    [Security.Cryptography.RandomNumberGenerator]::Fill($random)
    return @{ nonce=[Convert]::ToBase64String($random); deadline=$Deadline; used=$false }
  } finally { [Array]::Clear($random,0,$random.Length) }
}
function Take-YandexNativeSession($Message, $Challenge) {
  if ($Challenge.used) { throw 'NATIVE_REPLAY' }
  # Consume even an invalid first attempt. No retry, no parallel import.
  $Challenge.used=$true
  Assert-YandexNativeKeys $Message @('version','op','nonce','session')
  if (($Message.version -isnot [int] -and $Message.version -isnot [long]) -or $Message.version -ne 1 -or $Message.op -cne 'import' -or
      $Message.nonce -isnot [string] -or $Message.nonce -cne $Challenge.nonce -or
      [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $Challenge.deadline) { throw 'NATIVE_DENIED' }
  return $Message.session
}

function Invoke-YandexNativeImportMessage($Message, $Challenge) {
  $material=$null; $result=$null
  try {
    $material=Take-YandexNativeSession $Message $Challenge
    if ($Challenge.capability) { return (Invoke-YandexRemoteSessionImport -Message $Message -Challenge $Challenge) }
    $result=@(Invoke-YandexManualImport -InputReader {
      $json=$null
      try {
        $json=$material | ConvertTo-Json -Compress -Depth 12 -WarningAction Stop
        return (ConvertTo-SecureString -String $json -AsPlainText -Force)
      } finally { $json=$null }
    })
    $success=($result.Count -eq 3 -and $result[0] -ceq 'session imported = true' -and
      $result[1] -ceq 'state = NOT_CONFIGURED' -and $result[2] -match '^revision = [1-9][0-9]*$')
    if ($success) { return @{ok=$true;state='NOT_CONFIGURED'} }
    return @{ok=$false;state='NOT_CONFIRMED'}
  } finally { $material=$null; $result=$null }
}
