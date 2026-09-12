# Operator UI only. No browser/profile access. Existing CLI owns final validation,
# AES encryption and atomic expectedRevision=0 import. No secret arguments.
. (Join-Path $PSScriptRoot 'import-yandex-session.ps1')

function Read-YandexCookieField {
  param([string] $Prompt)
  $answer = Read-Host ($Prompt + ' (:cancel = отмена)')
  if ($null -eq $answer -or $answer -ceq ':cancel') { throw 'INPUT_STOP' }
  return $answer
}

function Read-YandexBrowserSession {
  $records = [Collections.Generic.List[object]]::new()
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $secret = $null; $pointer = [IntPtr]::Zero; $value = $null; $json = $null
  try {
    [Console]::WriteLine('Асбест DEV / myasnoibatya-zakaz. JSON составлять не нужно. Пароль не нужен.')
    [Console]::WriteLine('Работайте без записи экрана, transcript, отладки и истории/синхронизации буфера обмена.')
    [Console]::WriteLine('Откройте DevTools уже авторизованной вкладки. Не обновляйте страницу и не повторяйте запрос.')
    [Console]::WriteLine('В Network выберите УЖЕ успешный GET /sprav/api/54309413522/reviews, вкладку Cookies / Request Cookies.')
    [Console]::WriteLine('Далее в Application > Cookies > https://yandex.ru найдите метаданные только этих отправленных cookies.')
    [Console]::WriteLine('Не используйте HAR, Copy-as-cURL, Console, файлы или экспорт профиля. CSRF и данные других сайтов не переносите.')
    [Console]::WriteLine('Если нет записи запроса/метаданных, есть partitioned cookie или неоднозначные одинаковые имена — отмените ввод.')
    if ((Read-YandexCookieField 'Вы проверили аккаунт и имеющуюся запись GET? Введите ДА') -cne 'ДА') { throw 'INPUT_STOP' }
    while ($true) {
      if ($records.Count -ge 100) { throw 'INPUT_STOP' }
      [Console]::WriteLine('Следующая cookie: вводите наблюдаемые данные, не подбирайте имена и не меняйте флаги.')
      $name = Read-YandexCookieField 'Name'
      if ($name -cnotmatch '^[A-Za-z0-9_-]{1,128}$' -or $name -match 'csrf|xsrf|password|authorization|2fa|sms' -or
          -not $names.Add($name)) { throw 'INPUT_STOP' }
      $domain = Read-YandexCookieField 'Domain: yandex.ru или .yandex.ru, как в браузере'
      if ($domain -cnotin @('yandex.ru','.yandex.ru')) { throw 'INPUT_STOP' }
      $path = Read-YandexCookieField 'Path: скопируйте наблюдаемый путь'
      if ($path -cnotin @('/','/sprav','/sprav/','/sprav/api','/sprav/api/')) { throw 'INPUT_STOP' }
      if ((Read-YandexCookieField 'Secure: если отмечен, введите true; иначе отмените') -cne 'true') { throw 'INPUT_STOP' }
      $httpOnly = Read-YandexCookieField 'HttpOnly: true если отмечен, false если нет'
      if ($httpOnly -cnotin @('true','false')) { throw 'INPUT_STOP' }
      $expiry = Read-YandexCookieField 'Expires: session для Session; иначе Unix seconds или ISO дата с Z/смещением'
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
      [Console]::WriteLine('Теперь перенесите только raw Value этой cookie, без URL-декодирования. Значение НЕ отображается.')
      $secret = Read-YandexImportJson -Prompt 'СКРЫТЫЙ VALUE: Ctrl+D — закончить, Ctrl+C — отменить. Enter не отправляет.'
      $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
      $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
      if ($value.Length -gt 8192 -or $value -cnotmatch '^[\x21-\x3A\x3C-\x7E]+$') { throw 'INPUT_STOP' }
      $records.Add(@{name=$name;value=$value;domain=$domain;path=$path;secure=$true;httpOnly=($httpOnly -ceq 'true');expires=$expires})
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $pointer = [IntPtr]::Zero
      $secret.Dispose(); $secret = $null; $value = $null
      $next = Read-YandexCookieField 'Ещё cookie из этого запроса? ДА / НЕТ'
      if ($next -ceq 'НЕТ') { break }
      if ($next -cne 'ДА') { throw 'INPUT_STOP' }
    }
    [Console]::WriteLine('Все записи будут проверены существующим валидатором. Только encrypted DEV import; запросов к Яндексу не будет.')
    if ((Read-YandexCookieField 'Для импорта введите ИМПОРТ; любое другое значение отменяет') -cne 'ИМПОРТ') { throw 'INPUT_STOP' }
    $json = @{account='myasnoibatya-zakaz';cookies=@($records.ToArray())} | ConvertTo-Json -Depth 5 -Compress -WarningAction Stop
    return ConvertTo-SecureString -String $json -AsPlainText -Force
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secret) { $secret.Dispose() }
    $records.Clear(); $value=$null; $json=$null
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  if ($args.Count) {
    Write-Output 'session imported = false'
    Write-Output 'state = UNKNOWN'
    Write-Output 'error = IMPORT_ARGUMENTS_NOT_ALLOWED'
  } else { Invoke-YandexManualImport -InputReader { Read-YandexBrowserSession } }
}
