import { singleSyncRun } from '../../lib/server/single-sync-run.js';
import { connectPg, rpcAdapter, safeError } from './pg.mjs';

export const COMPANY = '60000000-0000-4000-8000-000000000006';
export const LOCATION = '61000000-0000-4000-8000-000000000006';
export const CONNECTION = '62000000-0000-4000-8000-000000000006';
export const ORG = 'vps06-synthetic-org';
export const LOCK = [1380013908, 6]; // Application namespace + VPS06; transaction scoped.
const need = (condition, code) => { if (!condition) throw safeError(code); };

export function profileGuard(env) {
  need(env.RA_RUNTIME_PROFILE === 'vps-lab', 'PROFILE_DENIED');
  need(env.RA_WORKER_PROVIDER === 'synthetic-vps06', 'SYNTHETIC_MODE_REQUIRED');
  for (const key of Object.keys(env)) {
    need(!/^(SUPABASE_|YANDEX_|TWOGIS_|VERCEL_|DATABASE_URL$|PGHOST$|PGSERVICE$)/.test(key), 'CLOUD_ENV_DENIED');
  }
}
export function validateSyntheticClaim(claim) {
  // 'yandex' is the existing DB queue enum only, NOT a selected transport.
  need(claim?.claimed === true && claim.company_id === COMPANY &&
    claim.provider_connection_id === CONNECTION && claim.provider === 'yandex' &&
    claim.external_account_id === 'vps06-synthetic' && claim.config?.location_id === LOCATION &&
    claim.config?.external_org_id === ORG && /^[a-f0-9-]{36}$/.test(claim.run_id), 'SYNTHETIC_SCOPE_INVALID');
  return claim;
}
export function validateConfig(config) {
  need(config && Object.keys(config).sort().join(',') === 'external_org_id,location_id,mode' &&
    config.mode === 'synthetic-vps06' && config.location_id === LOCATION && config.external_org_id === ORG,
  'SYNTHETIC_SCOPE_INVALID');
}
export async function processSynthetic(meta) {
  const fixture = meta?.vps06;
  need(fixture && Object.keys(fixture).sort().join(',') === 'delay_ms,operation' &&
    ['success','fail'].includes(fixture.operation) && Number.isSafeInteger(fixture.delay_ms) &&
    fixture.delay_ms >= 0 && fixture.delay_ms <= 8000, 'SYNTHETIC_JOB_INVALID');
  if (fixture.delay_ms) await new Promise(resolve => setTimeout(resolve, fixture.delay_ms));
  if (fixture.operation === 'fail') throw safeError('SYNTHETIC_PROCESS_FAILED');
  // No reviews, sessions, messages or external effects. Only queue lifecycle proof.
  return { ok: true, pages_fetched: 0, fetched_count: 0, inserted: 0, updated: 0, unchanged: 0, seen: 0 };
}

export async function runOnce({ env = process.env, connect = connectPg, processor = processSynthetic,
  signal } = {}) {
  profileGuard(env); // Must run BEFORE creating any DB/process/network resource.
  const db = connect();
  const abort = () => db.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let committed = false;
  let stage = 'DB_READINESS';
  try {
    need(!signal?.aborted, 'CANCELLED');
    const ready = await db.query(`select json_build_object('db',current_database(),'role',current_user,
      'version',current_setting('server_version_num')::int,'lab',
      (select version from vps_lab_private.version));`);
    need(ready?.db === 'review_activator_lab' && ready.role === 'review-activator' &&
      ready.version >= 170000 && ready.version < 180000 && ready.lab === 'vps04-auth-api-v1', 'DB_READINESS_FAILED');
    await db.query('begin;');
    stage = 'LOCK';
    if (!await db.query(`select to_json(pg_try_advisory_xact_lock(${LOCK.join(',')}));`)) {
      await db.query('rollback;');
      return { ok: true, code: 'ALREADY_RUNNING', claimed: false, provider_calls: 0 };
    }
    const rows = await db.query(`select coalesce(json_agg(json_build_object('id',id,'config',config,
      'enabled',enabled,'status',status)), '[]'::json) from public.review_provider_connections;`);
    need(Array.isArray(rows) && rows.length <= 1, 'SYNTHETIC_SCOPE_INVALID');
    if (rows.length) {
      need(rows[0].id === CONNECTION, 'SYNTHETIC_SCOPE_INVALID');
      validateConfig(rows[0].config);
      if (!rows[0].enabled || rows[0].status !== 'READY') {
        throw safeError('CONNECTION_NOT_READY');
      }
    }
    stage = 'ENQUEUE';
    const adapter = rpcAdapter(db);
    const rpc = (name, args) => {
      stage = ({ review_enqueue_due_syncs: 'ENQUEUE', review_claim_next_sync_run: 'CLAIM',
        review_complete_sync_run: 'COMPLETE', review_fail_sync_run: 'FAIL' })[name];
      return adapter(name, args);
    };
    const enqueued = await rpc('review_enqueue_due_syncs', { p_company_id: COMPANY });
    need(Number.isInteger(enqueued) && enqueued >= 0 && enqueued <= 1, 'ENQUEUE_CONTRACT_FAILED');
    const result = await singleSyncRun({ rpc, companyId: COMPANY, validateClaim: validateSyntheticClaim,
      completionFailure: 'rollback', successMode: 'synthetic', safeCode: () => 'SYNC_OPERATION_FAILED',
      errorState: () => 'ERROR', summarize: ({ ok, ...summary }) => summary,
      processClaim: async claim => {
        stage = 'PROCESS';
        // Validated UUID from the DB claim; no request/user SQL interpolation.
        const job = await db.query(`select json_build_object('meta',meta,'fresh',
          requested_at > now() - interval '1 day' and requested_at <= now())
          from public.review_sync_runs where id='${claim.run_id}'::uuid;`);
        need(job?.fresh === true, 'SYNTHETIC_JOB_STALE');
        return processor(job.meta);
      } });
    stage = 'COMMIT';
    await db.query('commit;');
    committed = true;
    return { ...result, enqueued, code: result.ok ? (result.claimed ? 'COMPLETED' : 'EMPTY') : 'PROCESS_FAILED',
      provider_calls: 0 };
  } catch (error) {
    if (!committed) { try { await db.query('rollback;'); } catch { /* disconnect also rolls back */ } }
    throw Object.assign(safeError(error?.code ?? 'INTERNAL_FAILURE'), { stage });
  } finally {
    signal?.removeEventListener('abort', abort);
    db.close();
  }
}
