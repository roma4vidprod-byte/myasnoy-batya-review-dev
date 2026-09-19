# Synthetic Native Messaging dispatch only: no SSH/process/provider operation.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../scripts/yandex-native-protocol.ps1')
$script:cloudCalls=0; $script:vpsCalls=0
function Invoke-YandexRemoteSessionImport { $script:cloudCalls++; throw 'CLOUD_CALL_FORBIDDEN' }
function Invoke-YandexManualImport { throw 'LOCAL_AES_FORBIDDEN' }
function Invoke-YandexVpsSessionImport($Message,$Challenge) {
  if ($Challenge.target -cne 'vps-lab' -or -not $Challenge.used) { throw 'INVALID_DISPATCH' }
  $script:vpsCalls++
  return @{ok=$true;state='NOT_CONFIGURED';revision=1}
}
$now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$approval=@{nonce=[Convert]::ToBase64String([byte[]]::new(32));expiresAt=$now+30000;expectedRevision=0;capability='vps-private-ssh'}
$challenge=New-YandexNativeChallenge @{version=1;op='hello';origin=$script:YandexNativeOrigin} ($now+60000) $approval
$challenge.target='vps-lab'
$message=@{version=1;op='import';nonce=$approval.nonce;session=@{account='synthetic';cookies=@()}}
$result=Invoke-YandexNativeImportMessage $message $challenge
if($result.ok -ne $true -or $result.revision -ne 1 -or $script:vpsCalls -ne 1 -or $script:cloudCalls -ne 0){throw 'DISPATCH_FAILED'}
$denied=$false
try{Invoke-YandexNativeImportMessage $message $challenge | Out-Null}catch{$denied=$true}
if(-not $denied -or $script:vpsCalls -ne 1){throw 'REPLAY_FAILED'}
Write-Output 'VPS_NATIVE_DISPATCH_PASS'
