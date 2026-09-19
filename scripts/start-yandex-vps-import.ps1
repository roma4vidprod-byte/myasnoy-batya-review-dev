# Explicit private VPS target. Reuses the existing same-user Native Messaging
# listener; does not load the Cloud adapter or require any local AES key.
if ($args.Count) { throw 'VPS_IMPORT_ARGUMENTS_DENIED' }
. (Join-Path $PSScriptRoot 'start-yandex-local-import.ps1')
Invoke-YandexLocalImport -Target 'vps-lab'
