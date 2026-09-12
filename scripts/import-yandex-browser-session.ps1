# One header paste; existing CLI remains the ONLY validator/encryption/CAS engine.
# Header attributes cannot be inferred. Fast path requires confirmed shared metadata.
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

function Read-YandexSharedCookieMetadata {
  [Console]::WriteLine('Заголовок не содержит атрибутов. Сверьте показанные имена в Application > Cookies > https://yandex.ru.')
  [Console]::WriteLine('Быстрый путь: у ВСЕХ оставшихся cookies одинаковые Domain, Path, Secure, HttpOnly и Expires.')
  [Console]::WriteLine('Если атрибуты разные, неизвестны, истекли или есть Partition Key — отмените. Не угадывайте.')
  if ((Read-YandexCookieField 'Все эти атрибуты одинаковы, проверены и нет partitioned cookies? ДА') -cne 'ДА') { throw 'INPUT_STOP' }
  $domain = Read-YandexCookieField 'Общий Domain: yandex.ru или .yandex.ru, как в браузере'
  if ($domain -cnotin @('yandex.ru','.yandex.ru')) { throw 'INPUT_STOP' }
  $path = Read-YandexCookieField 'Общий Path: наблюдаемый путь'
  if ($path -cnotin @('/','/sprav','/sprav/','/sprav/api','/sprav/api/')) { throw 'INPUT_STOP' }
  if ((Read-YandexCookieField 'Общий Secure: true только если отмечен у всех') -cne 'true') { throw 'INPUT_STOP' }
  $httpOnly = Read-YandexCookieField 'Общий HttpOnly: true если отмечен, false если нет'
  if ($httpOnly -cnotin @('true','false')) { throw 'INPUT_STOP' }
  $expiry = Read-YandexCookieField 'Общий Expires: session для Session; иначе Unix seconds или ISO дата с Z/смещением'
  $expires = [double]0
  if ($expiry -ceq 'session') { $expires = [double]-1 }
  else {
    if ($expiry -cmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$') {
      $date = [DateTimeOffset]::MinValue
      if (-not [DateTimeOffset]::TryParse($expiry,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$date)) { throw 'INPUT_STOP' }
      $expires = $date.ToUnixTimeMilliseconds() / 1000.0
    } elseif (-not [double]::TryParse($expiry,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$expires)) { throw 'INPUT_STOP' }
    if ([double]::IsNaN($expires) -or [double]::IsInfinity($expires) -or
        $expires -le ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0)) { throw 'INPUT_STOP' }
  }
  return @{domain=$domain;path=$path;secure=$true;httpOnly=($httpOnly -ceq 'true');expires=$expires}
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
    [Console]::WriteLine('Запрещённые имена исключены. Для сверки атрибутов оставлены только имена, БЕЗ значений:')
    foreach ($pair in $pairs) { [Console]::WriteLine($pair.name) }
    $metadata = Read-YandexSharedCookieMetadata
    $records = @($pairs | ForEach-Object { @{name=$_.name;value=$_.value;domain=$metadata.domain;path=$metadata.path;secure=$metadata.secure;httpOnly=$metadata.httpOnly;expires=$metadata.expires} })
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
