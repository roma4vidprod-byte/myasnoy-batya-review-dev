import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const diagnostics = readFileSync(new URL('./yandex-diagnostics.test.mjs', import.meta.url), 'utf8');

test('native host diagnostics use deterministic single-process test orchestration', () => {
  assert.match(packageJson.scripts.test, /--test-concurrency=1/);
  assert.match(diagnostics, /assert\.equal\(r\.status,0\)/);
  assert.match(diagnostics, /input:Buffer\.concat\(\[frame\(message\),frame\(/);
  assert.match(diagnostics, /timeout:8000/);
});
