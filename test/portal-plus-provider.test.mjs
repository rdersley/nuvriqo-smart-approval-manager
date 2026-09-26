import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortalPlusSnapshot, portalPlusModuleForAccount, PORTAL_PLUS_PROPERTY_KEY } from '../src/backend/portal-plus-provider.js';

test('builds customer-safe Portal+ approval snapshot', () => {
  const snapshot = buildPortalPlusSnapshot('TEST-1', [
    { id: 'a1', status: 'pending', approver: { accountId: 'acct-1' }, createdAt: '2026-09-01T00:00:00Z' },
    { id: 'a2', status: 'approved', approver: { accountId: 'acct-2' }, createdAt: '2026-09-02T00:00:00Z' },
  ], '2026-09-06T12:00:00Z');
  assert.equal(snapshot.issueKey, 'TEST-1');
  assert.equal(snapshot.approvals.length, 2);
  assert.equal(snapshot.approvals[0].approverAccountId, 'acct-1');
  assert.equal('message' in snapshot.approvals[0], false);
  assert.equal(PORTAL_PLUS_PROPERTY_KEY, 'nuvriqo.smart-approval.portal');
});

test('builds module only for the signed-in approver', () => {
  const snapshot = buildPortalPlusSnapshot('TEST-9', [
    { id: 'p1', status: 'pending', approver: { accountId: 'me' }, createdAt: '2026-09-01T00:00:00Z' },
    { id: 'p2', status: 'pending', approver: { accountId: 'someone-else' }, createdAt: '2026-09-01T00:00:00Z' },
  ]);
  const module = portalPlusModuleForAccount(snapshot, 'me', '/servicedesk/customer/portal/1/TEST-9');
  assert.equal(module.id, 'smart-approval');
  assert.equal(module.counters[0].value, 1);
  assert.equal(module.items.length, 1);
  assert.equal(portalPlusModuleForAccount(snapshot, 'missing'), null);
});
