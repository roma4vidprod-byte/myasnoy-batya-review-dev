# VPS07 HipHosting recovery inspection

2026-09-19, authenticated read-only panel inspection of hiplet120706 /141.98.87.15. No panel button performing mutation was pressed; no ticket sent.

| Capability | Actual evidence / conclusion |
| --- | --- |
| Web/VNC console | Console tab and1024x768canvas present. Inspected region black, no guest identity. Click action failed with detached/missing browser node; guest input NOT_PROVEN. |
| Serial console | Not exposed in inspected server navigation; UNKNOWN. |
| Rescue environment / ISO | No verified account-specific activation or rollback path; UNKNOWN, not activated. |
| Power off | Visible Management control; NOT_USED. |
| Power on | Not tested; UNKNOWN while running. |
| Soft reboot | Visible ACPI-labeled control; NOT_USED. |
| Forced reboot | Visible with integrity warning; NOT_USED. |
| Password reset | Visible control on Information page; NOT_USED. |
| Reinstall | Visible navigation; NOT_USED, destructive and prohibited. |
| Snapshot/provider backup | No control in inspected navigation. Dedicated provider backup docs say no snapshots; another generic setup article mentions a snapshot. Documentation inconsistent; no account-specific snapshot/backup proven. |

`OUT_OF_BAND_METHOD = NOT_PROVEN`

The [provider connection guide](https://hip.hosting/docs/connect-to-your-server) describes the console as hypervisor-side, independent of guest network/SSH. This documents a capability, not successful recovery on this machine. [Dedicated backup guide](https://hip.hosting/en/docs/how-to-back-up-your-server) says customer-managed off-host backups are needed. Rescue mentioned generically in docs does not prove boot-disk/network/key/mount semantics or safe rollback for this hiplet.

## Exact support request — prepared, NOT SENT

Здравствуйте. Для hiplet120706, IPv4141.98.87.15, требуется безопасно проверить независимый аварийный доступ без перезагрузки. VPS работает, оба SSH-доступа исправны. В Console виден чёрный canvas; guest hostname/приглашение и ввод подтвердить не удалось. Подскажите, как проверить/восстановить web/VNC или serial console без изменений гостевой ОС. Доступен ли для этого VPS rescue/ISO? Уточните: сохраняется ли boot disk, что меняется в сети и SSH-ключах, как монтируются разделы (возможен ли read-only), как вернуться к обычному boot и требуется ли остановка. Уточните также наличие snapshot/provider backup: статьи дают противоречивые сведения. Не выполняйте reboot, power cycle, reinstall, password reset или restore; нужен только ответ о возможностях и неразрушающий порядок проверки. Паролей и ключей в запросе нет.
