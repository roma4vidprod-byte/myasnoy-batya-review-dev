# Decisions and blockers

Проверка: 2026-09-14.

## Decisions applied

- Continue from local `bd3d96a...`; do not reset to remote `main`.
- Keep the existing Yandex provider, session store, queue and scoped writer.
- Keep scheduler paused and all Yandex/provider writes disabled for this remediation run.
- Keep the existing read-only admin/reply-draft fence; AI never publishes a reply.
- Sanitize AI draft boundary errors; do not expose provider/database exception text.
- Do not create a matching engine, 2GIS engine, outbox, scheduler or Vercel project.

## Blockers

- `AUD-10`: matching source/contract is absent from this checkout; NULL-location behavior cannot be safely changed by inference.
- `AUD-12`/`AUD-29`: current external scheduler/plan/job configuration was not re-read; no scheduler is enabled.
- `AUD-16`/`AUD-17`/`AUD-24`: authoritative DEV DB function definitions and delivery/anti-abuse policy are not in the checkout; no remote mutation is justified.
- `AUD-18`/`AUD-19`: author proof and incentive policy require an owner decision.
- `AUD-21`: no approved Yandex write contract; read-only fence remains.
- `AUD-23`/`AUD-27`: remote data classification, schema ledger and restore evidence were not re-read.
- `AUD-28`: no confirmed 2GIS credentials or provider contract.

The separate `QUALITY GATE / REGRESSION HARNESS` is intentionally not built or run in this remediation.
