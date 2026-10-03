import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The entry must match Portal+'s companion menu contract (version 1).
const source = readFileSync(new URL('../src/backend/portal-plus-menu.js', import.meta.url), 'utf8');

test('announces an Approvals tab under the Portal+ menu key', () => {
  assert.match(source, /'nuvriqo\.portalplus\.menu\.smart-approval'/);
  assert.match(source, /version: 1,/);
  assert.match(source, /label: 'Approvals',/);
  assert.match(source, /section: 'smart-approval',/);
});

test('saving settings announces to Portal+ without letting a failure block the save', () => {
  const config = readFileSync(new URL('../src/backend/config.js', import.meta.url), 'utf8');
  assert.match(config, /await kvs\.set\(configKey\(projectId\), settings\);\s*await announceToPortalPlus\(projectId\);/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /api\.asUser\(\)/);
});
