param([string] $Mode)
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot '../../scripts/import-yandex-browser-session.ps1')
  if ($Mode -eq 'publish') {
    $script:captured=$null
    function Set-Clipboard { param([string] $Value,[string] $ErrorAction); $script:captured=$Value }
    $request=@{version=1;requestId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';url='https://yandex.ru/sprav/api/54309413522/reviews';issuedAt=1900000000000;names=@('fixture')}
    Publish-YandexMetadataRequest $request
    $sent=$script:captured | ConvertFrom-Json -AsHashtable
    if ($sent.Count -ne 5 -or $sent.names[0] -cne 'fixture' -or $script:captured -match 'value|Cookie:|SYNTHETIC_PRIVATE') { throw 'PUBLISH_FAIL' }
    Write-Output 'PASS: browser input fixture'
    exit 0
  }
  if ($Mode -eq 'old_version') { function Get-YandexImportPowerShellMajor { return 5 } }
  $env:SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_SYNTHETIC_NOT_VALID'
  $env:YANDEX_SESSION_KEYS_JSON = @{fixture=[Convert]::ToBase64String([byte[]]::new(32))} | ConvertTo-Json -Compress
  $env:YANDEX_SESSION_ACTIVE_KID = 'fixture'
  $script:valueCalls=0; $script:startCalls=0; $script:published=$null; $script:answers=0
  $script:header='fixture=synthetic-cookie-one==; fixture_two=synthetic-cookie-%2F+two; csrf_fixture=synthetic-cookie-excluded'
  switch ($Mode) {
    'missing' { $env:YANDEX_SESSION_ACTIVE_KID=$null }
    'prohibited' { $script:header='csrf_fixture=synthetic-cookie-excluded; password=synthetic-cookie-excluded' }
    'duplicate' { $script:header='fixture=synthetic-cookie-one; fixture=synthetic-cookie-two' }
    'malformed' { $script:header='fixture=synthetic-cookie-one; broken' }
    'newline' { $script:header="fixture=synthetic-cookie-one`r`nAuthorization: SECRET_SYNTHETIC" }
    'empty_value' { $script:header='fixture=' }
    'trailing' { $script:header='fixture=synthetic-cookie-one;' }
    'set_cookie' { $script:header='fixture=synthetic-cookie-one; Domain=example.com' }
    'prefix' { $script:header='Cookie: ' + $script:header }
    'duplicate_prohibited' { $script:header+='; csrf_fixture=synthetic-cookie-duplicate' }
    'oversize' { $script:header='fixture=' + ('x' * 8193) }
  }
  function Read-Host {
    param([string] $Prompt)
    $script:answers++
    if ($script:answers -eq 1) { return 'ДА' }
    if ($Mode -eq 'cancel') { return ':cancel' }
    return 'ИМПОРТ'
  }
  function Publish-YandexMetadataRequest {
    param($Request)
    $encoded = $Request | ConvertTo-Json -Depth 4 -Compress
    if ($encoded -match 'synthetic-cookie|value|csrf_fixture' -or $Request.names.Count -ne 2) { throw 'REQUEST_LEAK' }
    $script:published=$Request
  }
  function Read-YandexImportJson {
    param([string] $Prompt)
    $script:valueCalls++
    if ($Mode -eq 'value_cancel' -or ($Mode -eq 'metadata_cancel' -and $script:valueCalls -eq 2)) { throw 'SYNTHETIC_PRIVATE_ERROR' }
    if ($script:valueCalls -eq 1) { return ConvertTo-SecureString $script:header -AsPlainText -Force }
    $cookies = @(
      @{name='fixture';domain='.yandex.ru';path='/sprav/api/';secure=$true;httpOnly=$false;expirationDate=$null;partitioned=$false},
      @{name='fixture_two';domain='yandex.ru';path='/';secure=$true;httpOnly=$true;expirationDate=4070934000;partitioned=$false}
    )
    switch ($Mode) {
      'domain' { $cookies[0].domain='example.com' }
      'path' { $cookies[0].path='/mail' }
      'expired' { $cookies[0].expirationDate=1 }
      'secure' { $cookies[0].secure=$false }
      'httpOnly' { $cookies[0].httpOnly='false' }
      'expiry' { $cookies[0].expirationDate='tomorrow' }
      'date' { $cookies[0].expirationDate=4070934000 }
      'metadata_duplicate' { $cookies[1].name='fixture' }
      'metadata_missing' { $cookies=@($cookies[0]) }
      'metadata_extra' { $cookies[1].name='unrequested' }
      'partitioned' { $cookies[0].partitioned=$true }
      'metadata_value' { $cookies[0].value='SYNTHETIC_PRIVATE_FORBIDDEN' }
    }
    $response=@{version=1;requestId=$script:published.requestId;url=$script:published.url;capturedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();cookies=$cookies}
    if ($Mode -eq 'wrong_nonce') { $response.requestId=[Guid]::NewGuid().ToString() }
    if ($Mode -eq 'wrong_url') { $response.url='https://example.com/' }
    if ($Mode -eq 'stale') { $response.capturedAt=0 }
    if ($Mode -eq 'metadata_only') { $response.Remove('cookies'); $response['metadata']=@() }
    return ConvertTo-SecureString ($response | ConvertTo-Json -Depth 6 -Compress) -AsPlainText -Force
  }
  $script:originalStart=(Get-Command New-YandexImportStartInfo).ScriptBlock
  function New-YandexImportStartInfo {
    param([ValidateSet('status','import')][string] $Operation = 'import')
    $script:startCalls++
    $start=& $script:originalStart -Operation $Operation
    $start.ArgumentList.Insert(0,'--import')
    $start.ArgumentList.Insert(1,'./test/support/yandex-header-import-rpc.mock.mjs')
    $start.Environment['IMPORT_TEST_MODE']='success'
    return $start
  }
  $before=@($env:SUPABASE_SERVICE_ROLE_KEY,$env:YANDEX_SESSION_KEYS_JSON,$env:YANDEX_SESSION_ACTIVE_KID) -join '|'
  $output=@(Invoke-YandexManualImport -InputReader { Read-YandexBrowserSession }) -join "`n"
  if ($Mode -in @('valid','date','prefix','mixed_metadata')) {
    if ($output -cne "session imported = true`nstate = NOT_CONFIGURED`nrevision = 8" -or $script:valueCalls -ne 2) { throw 'VALID_FAIL' }
  } else {
    $code=if ($Mode -eq 'old_version') { 'IMPORT_POWERSHELL_7_REQUIRED' } elseif ($Mode -eq 'missing') { 'IMPORT_CONFIG_MISSING' } else { 'IMPORT_SECURE_INPUT_FAILED' }
    if ($output -cne "session imported = false`nstate = UNKNOWN`nerror = $code") { throw 'INVALID_FAIL' }
  }
  if ($Mode -in @('missing','old_version') -and ($script:valueCalls -ne 0 -or $script:startCalls -ne 0)) { throw 'EARLY_INPUT' }
  if ((@($env:SUPABASE_SERVICE_ROLE_KEY,$env:YANDEX_SESSION_KEYS_JSON,$env:YANDEX_SESSION_ACTIVE_KID) -join '|') -cne $before) { throw 'ENV_CHANGED' }
  Write-Output 'PASS: browser input fixture'
} catch { Write-Output 'FAIL: browser input fixture'; exit 1 }
