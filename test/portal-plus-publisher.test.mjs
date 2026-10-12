import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/backend/portal-plus-publisher.js',import.meta.url),'utf8');

test('publishes approval snapshots through an app-scoped Jira issue property',()=>{
  assert.match(source,/api\.asApp\(\)\.requestJira/);
  assert.match(source,/\/rest\/api\/3\/issue\/\$\{key\}\/properties\/\$\{PORTAL_PLUS_PROPERTY_KEY\}/);
  assert.match(source,/method:'PUT'/);
  assert.match(source,/buildPortalPlusSnapshot/);
});

test('does not use asUser or expose a customer-driven transport',()=>{
  assert.doesNotMatch(source,/asUser\s*\(/);
});

test('validates issue keys and fails closed on Jira rejection',()=>{
  assert.match(source,/valid issue key is required/);
  assert.match(source,/if\(!response\.ok\)/);
  assert.match(source,/Unable to publish Portal\+ approval snapshot/);
});
