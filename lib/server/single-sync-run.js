// Shared queue lifecycle. Provider validation/processing and transport are injected.
// No provider, cloud, notification, or credential dependencies in this module.
export async function singleSyncRun({ rpc, companyId, validateClaim, processClaim, summarize,
  safeCode, errorState, completionFailure = 'fail', successMode = 'persist' }) {
  const claim = await rpc('review_claim_next_sync_run', { p_company_id: companyId });
  if (!claim || claim.claimed === false) return { ok: true, claimed: false, queue: 'EMPTY' };
  let claimed = claim;
  let result;
  const failRun = code => rpc('review_fail_sync_run', {
    p_company_id: companyId, p_run_id: claimed.run_id, p_error_code: code
  });
  try {
    claimed = validateClaim(claim);
    result = await processClaim(claimed);
  } catch (error) {
    const code = safeCode(error?.code);
    if (claimed?.run_id) await failRun(code);
    return { ok: false, claimed: true, state: errorState(code), errorCode: code };
  }
  if (!result?.ok) {
    const code = safeCode(result?.errorCode);
    await failRun(code);
    return { ok: false, claimed: true, state: result?.state, errorCode: code };
  }
  const summary = summarize(result);
  let completed;
  try {
    completed = await rpc('review_complete_sync_run', {
      p_company_id: companyId, p_run_id: claimed.run_id, p_result: summary
    });
  } catch (error) {
    // A native transaction cannot continue after a SQL error; its owner rolls back.
    if (completionFailure === 'rollback') throw error;
    await failRun('SYNC_OPERATION_FAILED');
    return { ok: false, claimed: true, state: 'ERROR', errorCode: 'SYNC_OPERATION_FAILED' };
  }
  if (!completed || completed.status !== 'SUCCEEDED') {
    throw Object.assign(new Error('SYNC_OPERATION_FAILED'), { code: 'SYNC_OPERATION_FAILED' });
  }
  return { ok: true, claimed: true, state: 'READY', mode: successMode, ...summary };
}
