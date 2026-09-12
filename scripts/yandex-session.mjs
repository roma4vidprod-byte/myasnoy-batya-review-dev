// Trusted operator CLI only. Never pass session material in command-line arguments.
// Noninteractive stdin avoids terminal echo. The session/key must not be pasted into chat.
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { createSessionStore } from '../lib/server/yandex-session/store.js';
import { keyringFromEnv, fail } from '../lib/server/yandex-session/crypto.js';

try {
  if (process.argv.length !== 3 || !['status','import','health','probe','dry-run','rotate-key','disable'].includes(process.argv[2])) fail('CLI_OPERATION_REQUIRED');
  if (process.stdin.isTTY) fail('CLI_NONINTERACTIVE_STDIN_REQUIRED');
  let input = ''; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length; if (bytes > 70000) fail('CLI_INPUT_TOO_LARGE');
    input += chunk.toString('utf8');
  }
  let data;
  try { data = JSON.parse(input); } catch { fail('CLI_INPUT_INVALID'); }
  const op = process.argv[2];
  if (!data || Object.keys(data).some(k => !['scope','session','expectedRevision','pageBase'].includes(k))) fail('CLI_INPUT_INVALID');
  if (op !== 'import' && Object.hasOwn(data,'session')) fail('CLI_SESSION_NOT_ALLOWED');
  const service = createYandexSessionService({
    store: createSessionStore(),
    keyring: ['status','disable'].includes(op) ? null : keyringFromEnv(),
    allowRead: process.env.YANDEX_LIVE_READ_APPROVAL === 'asbest-read-only-v1'
  });
  let result;
  if (op === 'import') result = await service.importSession(data.scope, data.session, data.expectedRevision);
  else if (op === 'status') result = await service.status(data.scope);
  else if (op === 'disable') result = await service.disable(data.scope, data.expectedRevision);
  else if (op === 'rotate-key') result = await service.rotateKey(data.scope, data.expectedRevision);
  else result = await service.run(data.scope, { mode: op === 'dry-run' ? 'dry_run' : op, pageBase: data.pageBase });
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.ok === false) process.exitCode = 1;
} catch (error) {
  // Never print raw parsing/network/crypto errors or input, even for operator troubleshooting.
  const allowed = /^(?:CLI_[A-Z_]+|SESSION_[A-Z_]+|LIVE_READ_NOT_APPROVED|YANDEX_PAGE_BASE_INVALID)$/;
  const code = typeof error.code === 'string' && allowed.test(error.code) ? error.code : 'SESSION_OPERATION_FAILED';
  process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n');
  process.exitCode = 1;
}
