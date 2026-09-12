import { fail, scopeOf, serverOnly, validateSession } from './crypto.js';

export function createYandexReadTransport({ scope, session, allowRead = false, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  serverOnly();
  const target = scopeOf(scope);
  return async function read(request) {
    serverOnly();
    if (allowRead !== true) fail('LIVE_READ_NOT_APPROVED');
    const page = request?.page;
    if (!Number.isSafeInteger(page) || page < 0 || page > 100) fail('SESSION_REQUEST_INVALID');
    const url = `https://yandex.ru/sprav/api/${target.organizationId}/reviews?ranking=by_time&source=pagination&page=${page}`;
    if (request.method !== 'GET' || request.url !== url || request.permanentId !== target.organizationId) fail('SESSION_REQUEST_INVALID');
    const valid = validateSession(session);
    const cookie = valid.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET', headers: { Accept: 'application/json', Cookie: cookie },
        redirect: 'manual', signal: AbortSignal.timeout(10000)
      });
    } catch { fail('YANDEX_NETWORK_ERROR'); }
    if (response.status === 401) fail('YANDEX_HTTP_401');
    if (response.status === 403) fail('YANDEX_HTTP_403');
    if (response.status >= 300 && response.status < 400) fail('YANDEX_LOGIN_REDIRECT');
    let text;
    try {
      const reader = response.body?.getReader();
      if (!reader) fail('YANDEX_MALFORMED_JSON');
      const parts = []; let size = 0;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); fail('YANDEX_RESPONSE_TOO_LARGE'); }
        parts.push(Buffer.from(value));
      }
      text = Buffer.concat(parts).toString('utf8');
    } catch (error) {
      fail(['YANDEX_RESPONSE_TOO_LARGE','YANDEX_MALFORMED_JSON'].includes(error.code) ? error.code : 'YANDEX_NETWORK_ERROR');
    }
    if (/^\s*</.test(text)) fail(/captcha|challenge|smartcaptcha/i.test(text) ? 'YANDEX_CHALLENGE' : 'YANDEX_LOGIN_HTML');
    let data;
    try { data = JSON.parse(text); } catch { fail('YANDEX_MALFORMED_JSON'); }
    const marker = typeof data?.error === 'string' ? data.error : data?.error?.code;
    if (data?.captcha || data?.challenge || data?.captcha_url || /captcha|challenge/i.test(String(marker || ''))) fail('YANDEX_CHALLENGE');
    if (!response.ok) throw Object.assign(new Error('YANDEX_HTTP_ERROR'), { code: 'YANDEX_HTTP_ERROR', httpStatus: response.status });
    if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(response.headers.get('content-type') || '')) fail('YANDEX_MALFORMED_JSON');
    return data; // Consumed immediately by existing provider; never logged or persisted.
  };
}
