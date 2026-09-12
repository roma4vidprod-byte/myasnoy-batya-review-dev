// Pure preflight only. NOT a writer, database transaction, or authorization check.
// Until the scoped-index migration/atomic writer is approved, persistence stays disabled.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function keys(row) {
  if (!row || typeof row.company_id !== 'string' || !uuid.test(row.company_id) ||
      typeof row.location_id !== 'string' || !uuid.test(row.location_id) ||
      !['yandex', '2gis'].includes(row.provider) ||
      typeof row.external_review_id !== 'string' || !row.external_review_id.trim() ||
      typeof row.external_location_id !== 'string' || !row.external_location_id.trim()) fail('REVIEW_SCOPE_REQUIRED');
  return {
    global: JSON.stringify([row.provider, row.external_review_id]),
    scope: JSON.stringify([row.company_id.toLowerCase(), row.location_id.toLowerCase(), row.provider, row.external_location_id])
  };
}
export function planReviewPersistence(rows, existingRows = []) {
  if (!Array.isArray(rows) || !Array.isArray(existingRows)) fail('REVIEW_ROWS_REQUIRED');
  const known = new Map();
  for (const row of existingRows) {
    const key = keys(row);
    if (known.has(key.global)) fail('REVIEW_EXISTING_CONTRACT_DRIFT');
    known.set(key.global, key.scope);
  }
  const seen = new Map(), operations = [];
  for (const row of rows) {
    const key = keys(row);
    if ((known.has(key.global) && known.get(key.global) !== key.scope) ||
        (seen.has(key.global) && seen.get(key.global) !== key.scope)) fail('REVIEW_SCOPE_COLLISION');
    if (seen.has(key.global)) continue; // Deterministic first observation wins.
    seen.set(key.global, key.scope);
    operations.push({ kind: known.has(key.global) ? 'update_same_scope' : 'insert', row: structuredClone(row) });
  }
  return Object.freeze({ persistenceEnabled: false, operations });
}
