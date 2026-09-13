# Run manually from a private/private PowerShell 7 window.
# Transfers server-only Review Activator DEV runtime secrets to Vercel Preview env.
# No secrets are printed, logged, or written to files.

function Read-PlainSecret {
  param([string] $Prompt)
  $secure = Read-Host $Prompt -AsSecureString
  if (-not $secure) { throw "SYNC_SETUP_STOPPED [NO_INPUT]" }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Resolve-SecretValue {
  param([string] $Name, [string] $Prompt, [string] $Default = $null)
  $existing = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ($existing) { return $existing }
  if ($null -ne $Default) { return $Default }
  return Read-PlainSecret -Prompt $Prompt
}

function Set-PreviewEnv {
  param([string] $Name, [string] $Value, [string] $Project)
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "SYNC_SETUP_STOPPED [EMPTY_$Name]" }
  $Value | vercel env add $Name preview --project $Project --sensitive --force --yes | Out-Null
}

$ErrorActionPreference = 'Stop'
$project = 'myasnoy-batya-review-dev'

$values = [ordered]@{
  SUPABASE_SERVICE_ROLE_KEY = Resolve-SecretValue -Name 'SUPABASE_SERVICE_ROLE_KEY' -Prompt 'Review Activator DEV SUPABASE_SERVICE_ROLE_KEY (hidden)'
  YANDEX_SESSION_KEYS_JSON  = Resolve-SecretValue -Name 'YANDEX_SESSION_KEYS_JSON' -Prompt 'Review Activator DEV YANDEX_SESSION_KEYS_JSON (hidden JSON)'
  YANDEX_SESSION_ACTIVE_KID = Resolve-SecretValue -Name 'YANDEX_SESSION_ACTIVE_KID' -Prompt 'Review Activator DEV YANDEX_SESSION_ACTIVE_KID (hidden)'
  YANDEX_LIVE_READ_APPROVAL = Resolve-SecretValue -Name 'YANDEX_LIVE_READ_APPROVAL' -Prompt '' -Default 'asbest-read-only-v1'
  REVIEW_WORKER_SECRET      = Resolve-SecretValue -Name 'REVIEW_WORKER_SECRET' -Prompt 'Review Activator DEV REVIEW_WORKER_SECRET (hidden)'
}

$values.Keys | ForEach-Object {
  Set-PreviewEnv -Name $_ -Value $values[$_] -Project $project
}

Write-Output 'SUPABASE_SERVICE_ROLE_KEY present = true'
Write-Output 'YANDEX_SESSION_KEYS_JSON present = true'
Write-Output 'YANDEX_SESSION_ACTIVE_KID present = true'
Write-Output 'YANDEX_LIVE_READ_APPROVAL present = true'
Write-Output 'REVIEW_WORKER_SECRET present = true'
Write-Output 'Vercel preview env sync pass'
