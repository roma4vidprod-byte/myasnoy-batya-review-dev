import { createReviewSyncWorkerHandler } from '../../lib/server/review-sync-worker.js';

// Server-only worker boundary. No browser caller, public RPC, or Yandex write path.
export default createReviewSyncWorkerHandler();
