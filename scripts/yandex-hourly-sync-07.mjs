// Explicit operator worker cycle. Fixed Asbest DEV scope; no scheduler mutation.
import { runReviewSyncWorker } from '../lib/server/review-sync-worker.js';

try {
  const result = await runReviewSyncWorker();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: 'REVIEW_SYNC_WORKER_FAILED' }) + '\n');
  process.exitCode = 1;
}
