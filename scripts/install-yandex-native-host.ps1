# One-time user-operated HKCU registration. Writes NONSECRET launcher/manifest only.
# Never run automatically from the importer; no session/key/environment persistence.
function Get-YandexNativeRegistration([string] $PowerShellPath, [string] $ScriptPath) {
  foreach ($path in @($PowerShellPath,$ScriptPath)) {
    if (-not [IO.Path]::IsPathFullyQualified($path) -or $path -match '["%\r\n]') { throw 'INSTALL_PATH_INVALID' }
  }
  return @{
    manifest=@{name='com.review_activator.dev_yandex';description='Review Activator DEV local import';path='host.cmd';type='stdio';allowed_origins=@('chrome-extension://gdjhmlbffahmpnphfoogegihhnfkoojm/')}
    launcher="@echo off`r`n`"$PowerShellPath`" -NoLogo -NoProfile -NonInteractive -File `"$ScriptPath`" %* 2>nul`r`n"
  }
}
function Install-YandexNativeHost {
  $ErrorActionPreference='Stop'
  try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) { throw 'STOP' }
    $config=Get-YandexNativeRegistration (Join-Path $PSHOME 'pwsh.exe') (Join-Path $PSScriptRoot 'yandex-native-host.ps1')
    $directory=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ReviewActivatorDev\YandexNativeV4'
    $manifestPath=Join-Path $directory 'host.json'
    $registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.review_activator.dev_yandex'
    # Do not overwrite an unrelated registration or installation.
    if ((Test-Path -LiteralPath $directory) -or (Test-Path -LiteralPath $registry)) { throw 'STOP' }
    $null=New-Item -ItemType Directory -Path $directory
    [IO.File]::WriteAllText((Join-Path $directory 'host.cmd'),$config.launcher,[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($manifestPath,($config.manifest | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    $null=New-Item -Path $registry
    Set-Item -LiteralPath $registry -Value $manifestPath
    Write-Output 'Native host registered for Review Activator DEV only.'
  } catch { Write-Output 'Native registration stopped. Do not import; inspect nonsecret registration before retry.' }
}
if ($MyInvocation.InvocationName -ne '.') {
  if ($args.Count) { Write-Output 'Installer stopped: arguments are not accepted.' }
  else { Install-YandexNativeHost }
}
