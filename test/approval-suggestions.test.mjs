// Behaviour tests for rule-prepared approver suggestions shown in the agent
// panel. Runs the real resolvers against in-memory KVS and Jira.
// Requires: node --experimental-test-module-mocks
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { beforeEach, mock, test } from 'node:test';
import { createFakeJira, createFakeKvs, route } from './helpers/fakes.mjs';

const PROJECT = '10000';
let jira;
const store = createFakeKvs();
const { default: Resolver } = createRequire(import.meta.url)('@forge/resolver');
mock.module('@forge/resolver', { defaultExport: Resolver });
const product = { requestJira: (path, options) => jira.requestJira(path, options) };
mock.module('@forge/api', { defaultExport: { asApp: () => product, asUser: () => product }, namedExports: { route } });
mock.module('@forge/kvs', { namedExports: { kvs: store.kvs, WhereConditions: store.WhereConditions } });

const { handler: agent } = await import('../src/backend/index.js');
const { handler: portal } = await import('../src/backend/portal.js');
const { run: runAutomation } = await import('../src/backend/automation.js');

const call = (handler, functionKey, accountId, payload = {}) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });
const suggested = async (issueKey = 'SD-1') => {
  const defaults = await call(agent, 'getApprovalDefaults', 'agent-1', { issueKey });
  return defaults.suggestion ? defaults.suggestion.approvers.map((a) => a.accountId) : null;
};
const send = (approvers, preparedRuleId = '') =>
  call(agent, 'createApproval', 'agent-1', { issueKey: 'SD-1', approvers: approvers.map((accountId) => ({ accountId })), preparedRuleId });
const issueUpdated = () => runAutomation({ issue: { key: 'SD-1', fields: { project: { id: PROJECT }, status: { name: 'Open', statusCategory: { key: 'new' } } } } });

function useRule(approvers) {
  store.data.set(`config#${PROJECT}`, {
    requireDeclineReason: false,
    autoRules: [{ id: 'r1', name: 'Manager approval', approvalMode: 'all', conditions: [{ fieldId: 'summary', operator: 'notEmpty' }], approvers: approvers.map((accountId) => ({ accountId })) }],
  });
}

beforeEach(() => {
  store.data.clear();
  jira = createFakeJira({ issues: { 'SD-1': { projectId: PROJECT, status: 'Open', category: 'new' } } });
});

test('a rule prepares its approvers for the agent', async () => {
  useRule(['mgr-a', 'mgr-b']);
  assert.deepEqual(await suggested(), ['mgr-a', 'mgr-b']);
});

test('after sending the prepared approvers, the panel is not re-filled with them', async () => {
  useRule(['mgr-a', 'mgr-b']);
  await suggested();
  await send(['mgr-a', 'mgr-b'], 'r1');

  assert.equal(await suggested(), null, 'panel load does not re-prepare');
  await issueUpdated();
  assert.equal(store.data.get('suggestion#SD-1'), undefined, 'a later ticket update does not re-prepare either');
  assert.equal(await suggested(), null);
});

test('sending the same people manually also clears the suggestion', async () => {
  useRule(['mgr-a']);
  await suggested();
  await send(['mgr-a']); // not via the prepared rule, so the stored suggestion is kept
  assert.ok(store.data.get('suggestion#SD-1'));
  assert.equal(await suggested(), null);
});

test('only approvers who have not been asked yet are still suggested', async () => {
  useRule(['mgr-a', 'mgr-b']);
  await send(['mgr-a']);
  assert.deepEqual(await suggested(), ['mgr-b']);
});

test('approvers already approved are not suggested again', async () => {
  useRule(['mgr-a']);
  const [a] = await send(['mgr-a'], 'r1');
  await call(portal, 'decideApproval', 'mgr-a', { approvalId: a.id, decision: 'approved' });
  await issueUpdated();
  assert.equal(await suggested(), null);
});

test('after a decline or cancellation the rule can suggest the approver again', async () => {
  useRule(['mgr-a', 'mgr-b']);
  const [a, b] = await send(['mgr-a', 'mgr-b'], 'r1');
  await call(portal, 'decideApproval', 'mgr-a', { approvalId: a.id, decision: 'declined', reason: 'Not yet' });
  await issueUpdated();
  assert.deepEqual(await suggested(), ['mgr-a', 'mgr-b'], 'declined, and the other approver closed with the group');
  assert.equal(store.data.get(`approval#${b.id}`).status, 'cancelled');
});
