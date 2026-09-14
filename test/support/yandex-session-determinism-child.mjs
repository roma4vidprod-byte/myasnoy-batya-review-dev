import { decryptSession } from '../../lib/server/yandex-session/crypto.js';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const payload = JSON.parse(await readStdin() || '{}');
const scope = payload.scope;
const snapshot = payload.snapshot;
const rounds = Number.isSafeInteger(payload.rounds) && payload.rounds > 0 ? payload.rounds : 0;
const keyring = {
  currentKid: payload?.keyring?.currentKid,
  keys: { [payload?.keyring?.currentKid]: Buffer.from(payload?.keyring?.keys?.[payload?.keyring?.currentKid] || '', 'base64') }
};

let pass = 0;
let fail = 0;
for (let i = 0; i < rounds; i++) {
  try {
    decryptSession(scope, snapshot, keyring);
    pass += 1;
  } catch {
    fail += 1;
  }
}

process.stdout.write(JSON.stringify({ pass, fail }));