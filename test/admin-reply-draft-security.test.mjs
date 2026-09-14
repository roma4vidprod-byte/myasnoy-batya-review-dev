import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/admin-review-reply-draft.js', import.meta.url), 'utf8');

test('AI draft endpoint never reflects raw exception text', () => {
  assert.match(source, /function safeErrorStatus\(/);
  assert.match(source, /function safeErrorCode\(/);
  assert.match(source, /safeErrorStatus\(e\)/);
  assert.match(source, /safeErrorCode\(e\)/);
  assert.doesNotMatch(source, /error:e\.message/);
  assert.doesNotMatch(source, /error:\s*String\(e/);
});

test('AI draft error mapping is an allowlisted server boundary', () => {
  for (const code of ['AUTH_REQUIRED', 'ADMIN_REQUIRED', 'REVIEW_NOT_FOUND', 'AI_NOT_CONFIGURED', 'AI_PROVIDER_FAILED', 'AI_DRAFT_FAILED']) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /reviewId=clean\(req\.body\?\.reviewId,100\)/);
  assert.doesNotMatch(source, /reviewRowId/);
});
