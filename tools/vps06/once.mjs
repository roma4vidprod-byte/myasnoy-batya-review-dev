import { mkdir, writeFile, rename } from 'node:fs/promises';
import { runOnce } from './worker.mjs';

// Fixed local state only: safe operational metadata, never queue payloads or credentials.
const directory = '/var/lib/review-activator-worker';
const started = new Date().toISOString();
const allowed = new Set(['PROFILE_DENIED','SYNTHETIC_MODE_REQUIRED','CLOUD_ENV_DENIED',
  'SYNTHETIC_SCOPE_INVALID','SYNTHETIC_JOB_INVALID','CONNECTION_NOT_READY','DB_READINESS_FAILED',
  'DB_OPERATION_FAILED','DB_RESPONSE_INVALID','RPC_ARGUMENT_INVALID','RPC_NOT_ALLOWED',
  'ENQUEUE_CONTRACT_FAILED','CANCELLED']);
const controller = new AbortController();
let stopped = null;
const cancel = code => { stopped = code; controller.abort(); };
process.once('SIGTERM', () => cancel('SIGTERM'));
process.once('SIGINT', () => cancel('SIGINT'));
const timeout = setTimeout(() => cancel('WORKER_TIMEOUT'), 20000);
let result;
try {
  if (process.argv.length !== 3 || process.argv[2] !== '--once') throw { code: 'PROFILE_DENIED' };
  result = await runOnce({ signal: controller.signal });
} catch (error) {
  result = { ok: false, code: stopped || (allowed.has(error?.code) ? error.code : 'INTERNAL_FAILURE'),
    stage: ['DB_READINESS','LOCK','ENQUEUE','CLAIM','PROCESS','COMPLETE','FAIL','COMMIT'].includes(error?.stage) ? error.stage : 'GUARD',
    provider_calls: 0 };
} finally { clearTimeout(timeout); }
const report = { ...result, started_at: started, finished_at: new Date().toISOString() };
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = `${directory}/pending-${process.pid}.json`;
  await writeFile(temp, JSON.stringify(report), { mode: 0o600 });
  await rename(temp, `${directory}/latest.json`);
  // Lock refusals are observed but do not advance successful-work timestamps.
  if (result.ok && result.code !== 'ALREADY_RUNNING') {
    await writeFile(`${directory}/success.json`, JSON.stringify({ finished_at: report.finished_at }), { mode: 0o600 });
  }
} catch { result = { ok: false, code: 'STATUS_WRITE_FAILED', provider_calls: 0 }; }
console.log(JSON.stringify({ ...result, started_at: started, finished_at: report.finished_at }));
process.exitCode = result.ok ? 0 : 1;
