import { randomBytes, createHmac } from 'node:crypto';
import { parseYandexReviewsPayload } from '../../providers/yandex.js';
import { fail } from './crypto.js';

// Diagnostic only: existing transport/parser injected by the session service.
// Hashes are comparable only within this invocation; the random key is never output.
export async function probePagination(read, organizationId) {
  const key = randomBytes(32), pages = [], fingerprints = [];
  const hash = value => createHmac('sha256', key).update(value).digest('hex');
  const finish = (rule, pageBase = null) => ({ confirmed: pageBase !== null, rule, pageBase, pages });
  try {
    for (let page = 0; page <= 3; page++) {
      const parsed = parseYandexReviewsPayload(await read(page), organizationId);
      const { limit, offset, total } = parsed.pagination;
      const ids = parsed.reviews.map(r => r.externalReviewId);
      fingerprints.push(hash(JSON.stringify(ids)));
      pages.push({ requestedPage: page, limit, offset, total, items: ids.length,
        firstIdHash: ids.length ? hash(ids[0]) : null,
        lastIdHash: ids.length ? hash(ids.at(-1)) : null });
      ids.fill(null);
      if (page === 0) {
        if (offset !== 0) return finish('OTHER_CONTRACT');
        continue;
      }
      const first = pages[0];
      if (limit !== first.limit || total !== first.total) fail('YANDEX_PAGINATION_CHANGED');
      if (total <= limit) return finish('INSUFFICIENT_MULTI_PAGE_EVIDENCE');
      if (page === 1 && offset === limit && fingerprints[1] !== fingerprints[0])
        return finish('ZERO_BASED', 0);
      if (offset === 0 && fingerprints[page] !== fingerprints[0])
        return finish('OTHER_CONTRACT_CHANGED_FIRST_PAGE');
      if (page === 2 && pages[1].offset === 0 && offset === limit && fingerprints[2] !== fingerprints[0])
        return finish('ONE_BASED_PAGE_ZERO_ALIAS', 1);
      if (offset !== 0) return finish('OTHER_CONTRACT');
    }
    return finish('OTHER_CONTRACT_ALL_FIRST_PAGE');
  } finally { key.fill(0); fingerprints.fill(null); }
}
