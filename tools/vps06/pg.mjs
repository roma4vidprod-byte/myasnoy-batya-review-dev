import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const safeError = code => Object.assign(new Error(code), { code });
// One psql process = one backend = one transaction and native advisory lock.
// Only a fixed Unix socket/database/peer role. Never inherit PG*, cloud or provider env.
export function connectPg() {
  const child = spawn('/usr/lib/postgresql/17/bin/psql', [
    '-X', '-qAt', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql',
    '-p', '5432', '-U', 'review-activator', '-d', 'review_activator_lab'
  ], { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PGAPPNAME: 'vps06-single-run',
    PGCONNECT_TIMEOUT: '3', PGOPTIONS: '-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000' },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = null;
  let dead = false;
  let serial = 0;
  const reject = () => { dead = true; pending?.reject(safeError('DB_OPERATION_FAILED')); pending = null; };
  child.on('error', reject);
  child.on('exit', reject);
  child.stdin.on('error', reject);
  child.stderr.resume(); // Never emit raw SQL/errors or database payloads.
  createInterface({ input: child.stdout }).on('line', line => {
    if (!pending) return;
    if (line === pending.marker) {
      const task = pending;
      pending = null;
      try { task.resolve(task.lines.length ? JSON.parse(task.lines.join('\n')) : null); }
      catch { task.reject(safeError('DB_RESPONSE_INVALID')); }
    } else if (pending.lines.join('').length > 16000) {
      pending.reject(safeError('DB_RESPONSE_INVALID')); pending = null; child.kill();
    } else pending.lines.push(line);
  });
  return {
    query(sql) {
      if (dead || pending) return Promise.reject(safeError('DB_OPERATION_FAILED'));
      return new Promise((resolve, rejectPromise) => {
        const marker = `VPS06_END_${++serial}`;
        pending = { marker, lines: [], resolve, reject: rejectPromise };
        child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    close() { child.stdin.end(); },
    abort() { child.kill('SIGKILL'); reject(); }
  };
}

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function uuidSql(value) {
  if (!uuid.test(value)) throw safeError('RPC_ARGUMENT_INVALID');
  return `'${value}'::uuid`;
}
export function rpcAdapter(db) {
  return async (name, args) => {
    const company = uuidSql(args.p_company_id);
    if (name === 'review_enqueue_due_syncs' || name === 'review_claim_next_sync_run') {
      return db.query(`select to_json(public.${name}(${company}));`);
    }
    const run = uuidSql(args.p_run_id);
    if (name === 'review_fail_sync_run' && args.p_error_code === 'SYNC_OPERATION_FAILED') {
      return db.query(`select public.review_fail_sync_run(${company},${run},'SYNC_OPERATION_FAILED');`);
    }
    if (name === 'review_complete_sync_run') {
      const keys = ['pages_fetched','fetched_count','inserted','updated','unchanged','seen'];
      const value = args.p_result;
      if (!value || Object.keys(value).length !== keys.length || keys.some(k =>
        !Number.isSafeInteger(value[k]) || value[k] < 0)) throw safeError('RPC_ARGUMENT_INVALID');
      return db.query(`select public.review_complete_sync_run(${company},${run},'${JSON.stringify(value)}'::jsonb);`);
    }
    throw safeError('RPC_NOT_ALLOWED');
  };
}
