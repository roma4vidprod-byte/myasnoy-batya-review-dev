# Review Activator DEV only. Password is entered locally and never written to disk.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectUrl = 'https://ykiubttldgyjpajmsuas.supabase.co'
$TargetEmail = 'myasnoibatya@yandex.ru'

function Stop-Safely([string]$Code) {
  throw $Code
}

function Convert-SecureStringToPlainText([Security.SecureString]$Value) {
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

function Invoke-SupabaseAdminApi(
  [string]$Method,
  [string]$Uri,
  [hashtable]$Headers,
  [string]$Body
) {
  try {
    $request = @{
      Method = $Method
      Uri = $Uri
      Headers = $Headers
      ErrorAction = 'Stop'
      ContentType = 'application/json'
    }
    if ($null -ne $Body) { $request.Body = $Body }
    return Invoke-RestMethod @request
  } catch {
    Stop-Safely 'SUPABASE_ADMIN_API_FAILED'
  }
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Output 'SETUP STOPPED [POWERSHELL_7_REQUIRED]'
  exit 1
}

$serviceKey = [Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY', 'Process')
if ([string]::IsNullOrWhiteSpace($serviceKey)) {
  Write-Output 'SETUP STOPPED [SERVICE_ROLE_ENV_MISSING]'
  exit 1
}

$securePassword = $null
$securePasswordConfirmation = $null
$plainPassword = $null
$plainPasswordConfirmation = $null
$headers = $null
$body = $null

try {
  $securePassword = Microsoft.PowerShell.Utility\Read-Host 'New DEV admin password (hidden)' -AsSecureString
  $securePasswordConfirmation = Microsoft.PowerShell.Utility\Read-Host 'Repeat DEV admin password (hidden)' -AsSecureString
  $plainPassword = Convert-SecureStringToPlainText $securePassword
  $plainPasswordConfirmation = Convert-SecureStringToPlainText $securePasswordConfirmation

  if ([string]::IsNullOrWhiteSpace($plainPassword) -or $plainPassword.Length -lt 10) {
    Stop-Safely 'PASSWORD_POLICY_FAILED'
  }
  if ($plainPassword -cne $plainPasswordConfirmation) {
    Stop-Safely 'PASSWORD_CONFIRMATION_FAILED'
  }

  $headers = @{
    apikey = $serviceKey
    Authorization = 'Bearer ' + $serviceKey
  }

  $user = $null
  for ($page = 1; $page -le 10 -and $null -eq $user; $page++) {
    $listUri = $ProjectUrl + '/auth/v1/admin/users?page=' + $page + '&per_page=1000'
    $response = Invoke-SupabaseAdminApi 'GET' $listUri $headers $null
    $batch = @($response.users)
    $user = $batch | Where-Object { $_.email -and $_.email.ToString().Equals($TargetEmail, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
    if ($batch.Count -lt 1000) { break }
  }

  if ($null -eq $user -or [string]::IsNullOrWhiteSpace([string]$user.id)) {
    Stop-Safely 'TARGET_USER_NOT_FOUND'
  }

  $body = @{ password = $plainPassword } | ConvertTo-Json -Compress
  $updateUri = $ProjectUrl + '/auth/v1/admin/users/' + [uri]::EscapeDataString([string]$user.id)
  [void](Invoke-SupabaseAdminApi 'PUT' $updateUri $headers $body)

  $adminUri = $ProjectUrl + '/rest/v1/review_admins?select=user_id,active&user_id=eq.' + [uri]::EscapeDataString([string]$user.id) + '&active=eq.true'
  $adminRows = @(Invoke-SupabaseAdminApi 'GET' $adminUri $headers $null)
  if ($adminRows.Count -ne 1) {
    Stop-Safely 'ACTIVE_ADMIN_NOT_CONFIRMED'
  }

  Write-Output 'user exists = true'
  Write-Output 'active admin = true'
  Write-Output 'password updated = true'
  Write-Output 'DEV PASSWORD UPDATE PASS'
  exit 0
} catch {
  $code = if ($_.Exception.Message -match '^[A-Z0-9_\[\]-]+$') { $_.Exception.Message } else { 'SAFE_FAILURE' }
  Write-Output ('SETUP STOPPED [' + $code + ']')
  exit 1
} finally {
  $securePassword = $null
  $securePasswordConfirmation = $null
  $plainPassword = $null
  $plainPasswordConfirmation = $null
  $body = $null
  $headers = $null
  $serviceKey = $null
}
