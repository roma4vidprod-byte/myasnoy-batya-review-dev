# Explicit one-shot refresh of the existing VDSina session (revision 4 -> 5).
# Reuses the same-user Native Messaging pipe; no cookie CLI/clipboard path.
if ($args.Count) { throw 'VPS_REFRESH_ARGUMENTS_DENIED' }
. (Join-Path $PSScriptRoot 'start-yandex-local-import.ps1')
Invoke-YandexLocalImport -Target 'vps-refresh'
