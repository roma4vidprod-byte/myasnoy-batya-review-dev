# One hidden header + metadata-only local extension exchange. No shared/default metadata.
# Existing CLI remains the ONLY validator/encryption/CAS engine.
. (Join-Path $PSScriptRoot 'import-yandex-session.ps1')

function Read-YandexCookieField {
  param([string] $Prompt)
  $answer = Read-Host ($Prompt + ' (:cancel = отмена)')
  if ($null -eq $answer -or $answer -ceq ':cancel') { throw 'INPUT_STOP' }
  return $answer
}

function ConvertFrom-YandexCookieHeader {
  param([string] $Header)
  # Never decode values, unquote, log input or choose a winner among duplicate names.
  if (-not $Header -or $Header.Length -gt 60000 -or $Header -match '[^\x20-\x7E]') { throw 'INPUT_STOP' }
  $text = $Header.Trim(' ')
  $text = $text -replace '^(?i:cookie):[ ]*',''
  $parts = $text.Split(';')
  if ($parts.Count -gt 100) { throw 'INPUT_STOP' }
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $records = [Collections.Generic.List[object]]::new()
  try {
    foreach ($part in $parts) {
      $pair = $part.TrimStart(' ')
      $match = [regex]::Match($pair,'\A([A-Za-z0-9_-]{1,128})=([\x21-\x3A\x3C-\x7E]+)\z')
      if (-not $match.Success -or $match.Groups[2].Value.Length -gt 8192) { throw 'INPUT_STOP' }
      $name = $match.Groups[1].Value
      if (-not $names.Add($name)) { throw 'INPUT_STOP' }
      # Ambiguous Set-Cookie attributes are not accepted as request cookie names.
      if ($name -match '^(domain|path|expires|max-age|secure|httponly|samesite|partitioned)$') { throw 'INPUT_STOP' }
      if ($name -match 'csrf|xsrf|password|authorization|2fa|sms') { continue }
      $records.Add(@{name=$name;value=$match.Groups[2].Value})
    }
    if (-not $records.Count) { throw 'INPUT_STOP' }
    return ,$records.ToArray()
  } finally { $text=$null; $parts=$null; $pair=$null; $match=$null; $records.Clear() }
}

function Publish-YandexMetadataRequest {
  param($Request)
  # Only names and a non-secret correlation ID. Never put the header/pairs on clipboard.
  Set-Clipboard -Value ($Request | ConvertTo-Json -Depth 4 -Compress) -ErrorAction Stop
}

function Assert-YandexMetadataKeys {
  param($Object, [string[]] $Keys)
  if ($Object -isnot [Collections.IDictionary] -or $Object.Count -ne $Keys.Count) { throw 'INPUT_STOP' }
  foreach ($key in $Object.Keys) { if ($key -cnotin $Keys) { throw 'INPUT_STOP' } }
}

function Read-YandexMatchedMetadata {
  param($Request, $Pairs)
  $secure=$null; $pointer=[IntPtr]::Zero; $plain=$null; $map=$null
  try {
    $secure = Read-YandexImportJson -Prompt 'Вставьте МЕТАДАННЫЕ из расширения. Ctrl+D — закончить; Ctrl+C — отменить.'
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $map = $plain | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    Assert-YandexMetadataKeys $map @('version','requestId','url','capturedAt','cookies')
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if (($map.version -isnot [long] -and $map.version -isnot [int]) -or $map.version -ne 1 -or
        $map.requestId -isnot [string] -or $map.requestId -cne $Request.requestId -or
        $map.url -isnot [string] -or $map.url -cne $Request.url -or
        ($map.capturedAt -isnot [long] -and $map.capturedAt -isnot [int]) -or
        $map.capturedAt -lt $Request.issuedAt -or $map.capturedAt -gt $now -or $now-$Request.issuedAt -gt 300000 -or
        $map.cookies -isnot [array] -or $map.cookies.Count -ne $Pairs.Count) { throw 'INPUT_STOP' }
    $byName = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    foreach ($c in $map.cookies) {
      Assert-YandexMetadataKeys $c @('name','domain','path','secure','httpOnly','expirationDate','partitioned')
      if ($c.name -isnot [string] -or $c.name -cnotin $Request.names -or $byName.ContainsKey($c.name) -or
          $c.domain -isnot [string] -or $c.domain -cnotin @('yandex.ru','.yandex.ru') -or
          $c.path -isnot [string] -or $c.path -cnotin @('/','/sprav','/sprav/','/sprav/api','/sprav/api/') -or
          $c.secure -isnot [bool] -or -not $c.secure -or $c.httpOnly -isnot [bool] -or
          $c.partitioned -isnot [bool] -or $c.partitioned) { throw 'INPUT_STOP' }
      if ($null -ne $c.expirationDate -and
          (($c.expirationDate -isnot [double] -and $c.expirationDate -isnot [long] -and $c.expirationDate -isnot [int]) -or
           [double]::IsNaN($c.expirationDate) -or [double]::IsInfinity($c.expirationDate) -or $c.expirationDate*1000 -le $now)) { throw 'INPUT_STOP' }
      $byName.Add($c.name,$c)
    }
    $records = foreach ($pair in $Pairs) {
      if (-not $byName.ContainsKey($pair.name)) { throw 'INPUT_STOP' }
      $c = $byName[$pair.name]
      @{name=$pair.name;value=$pair.value;domain=$c.domain;path=$c.path;secure=$c.secure;httpOnly=$c.httpOnly;
        expires=$(if ($null -eq $c.expirationDate) { -1 } else { $c.expirationDate })}
    }
    return ,@($records)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secure) { $secure.Dispose() }
    $plain=$null; $map=$null; $records=$null; $byName=$null; $c=$null
  }
}

function Read-YandexBrowserSession {
  $secret=$null; $pointer=[IntPtr]::Zero; $header=$null; $pairs=$null; $records=$null; $json=$null
  try {
    [Console]::WriteLine('Асбест DEV / myasnoibatya-zakaz. Одна вставка Cookie, без JSON и отдельных значений.')
    [Console]::WriteLine('Только приватное окно без transcript/отладки/записи экрана и истории/синхронизации буфера обмена.')
    [Console]::WriteLine('Chrome Network: УЖЕ успешный GET /sprav/api/54309413522/reviews > Headers > Request Headers > Cookie > Copy value.')
    [Console]::WriteLine('Не обновляйте страницу и не повторяйте запрос. Без HAR/Copy-as-cURL/файлов. Пароль не нужен.')
    if ((Read-YandexCookieField 'Аккаунт myasnoibatya-zakaz, URL https://yandex.ru/sprav/api/54309413522/reviews, GET успешен? ДА') -cne 'ДА') { throw 'INPUT_STOP' }
    $secret = Read-YandexImportJson -Prompt 'Вставьте Cookie СЮДА СКРЫТО. Ctrl+D — закончить; Ctrl+C — отменить. Enter не отправляет.'
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $header = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $pairs = ConvertFrom-YandexCookieHeader -Header $header
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $pointer=[IntPtr]::Zero
    $secret.Dispose(); $secret=$null; $header=$null
    $request = @{version=1;requestId=[Guid]::NewGuid().ToString();url='https://yandex.ru/sprav/api/54309413522/reviews';
      issuedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();names=@($pairs | ForEach-Object { $_.name })}
    Publish-YandexMetadataRequest $request
    [Console]::WriteLine('В буфер помещён только блок ИМЁН без значений. Вставьте его в локальное расширение и нажмите «Скопировать метаданные».')
    [Console]::WriteLine('Вернитесь сюда в течение 5 минут. Ни Cookie header, ни ключи расширению не передавайте.')
    $records = Read-YandexMatchedMetadata -Request $request -Pairs $pairs
    if ((Read-YandexCookieField 'Всё сверено. ИМПОРТ — зашифровать в DEV и остановиться БЕЗ GET; иначе отмена') -cne 'ИМПОРТ') { throw 'INPUT_STOP' }
    $json = @{account='myasnoibatya-zakaz';cookies=$records} | ConvertTo-Json -Depth 5 -Compress -WarningAction Stop
    return ConvertTo-SecureString -String $json -AsPlainText -Force
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secret) { $secret.Dispose() }
    $header=$null; $pairs=$null; $records=$null; $json=$null; $pair=$null
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  if ($args.Count) {
    Write-Output 'session imported = false'
    Write-Output 'state = UNKNOWN'
    Write-Output 'error = IMPORT_ARGUMENTS_NOT_ALLOWED'
  } else { Invoke-YandexManualImport -InputReader { Read-YandexBrowserSession } }
}
