import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../tools/vps14/native-host-launcher.cs',import.meta.url),'utf8');

test('VPS14 native host wrapper forwards raw stdio and fixed script only',()=>{
  assert.match(src,/Console\.OpenStandardInput\(\)/);
  assert.match(src,/Console\.OpenStandardOutput\(\)/);
  assert.match(src,/StandardInput\.BaseStream/);
  assert.match(src,/StandardOutput\.BaseStream/);
  assert.match(src,/yandex-native-host\.ps1/);
  assert.doesNotMatch(src,/Console\.Write(Line)?\s*\(/);
  assert.doesNotMatch(src,/ReadToEnd/);
});

test('VPS14 native host wrapper restricts Chrome argv',()=>{
  assert.match(src,/SafeArg/);
  assert.match(src,/value\.Length > 512/);
  assert.match(src,/":\/-_\.="\.IndexOf/);
  assert.match(src,/return 113/);
});
