// Behaviour tests for approval scale and lifecycle. Runs the real resolvers and
// workers against in-memory KVS and Jira.
// Requires: node --experimental-test-module-mocks
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { beforeEach, mock, test } from 'node:test';
import { createFakeJira, createFakeKvs, route } from './helpers/fakes.mjs';

const PROJECT = '10000';
const OPEN = { projectId: PROJECT, status: 'Waiting for approval', category: 'indeterminate' };
const CLOSED = { projectId: PROJECT, status: 'Closed', category: 'done' };

let jira;
const store = createFakeKvs();
const { default: Resolver } = createRequire(import.meta.url)('@forge/resolver');
mock.module('@forge/resolver', { defaultExport: Resolver });
const product = { requestJira: (path, options) => jira.requestJira(path, options) };
mock.module('@forge/api', { defaultExport: { asApp: () => product, asUser: () => product }, namedExports: { route } });
mock.module('@forge/kvs', { namedExports: { kvs: store.kvs, WhereConditions: store.WhereConditions } });

const { handler: agent } = await import('../src/backend/index.js');
const { handler: portal } = await import('../src/backend/portal.js');
const { run: runReminders } = await import('../src/backend/reminders.js');
const { run: runAutomation } = await import('../src/backend/automation.js');
const { run: runFormWorker } = await import('../src/backend/form-submission-worker.js');
const { MAX_AUTOMATIC_REMINDERS } = await import('../src/backend/store.js');

const call = (handler, functionKey, accountId, payload = {}) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const get = (key) => store.data.get(key);
const approvals = () => [...store.data.entries()].filter(([k]) => k.startsWith('approval#')).map(([, v]) => v);
const commentsOn = (issueKey) => jira.comments.filter((c) => c.issueKey === issueKey).map((c) => c.body);
const makeOverdue = (id) => { for (const [k, v] of store.data) if (v?.id === id && !k.startsWith('pending')) v.nextReminderAt = '2000-01-01T00:00:00.000Z'; };

// A record as written before the pending indexes existed (no pending# pointers).
function seedLegacy(i, { issueKey = 'SD-1', approver = 'cust-a', status = 'approved', overdue = false } = {}) {
  const createdAt = new Date(Date.UTC(2025, 0, 1) + i * 60000).toISOString();
  const record = {
    id: `${1735689600000 + i}-legacy`, groupId: `g-${i}`, approvalMode: 'all', groupSize: 1,
    issueKey, projectId: PROJECT, summary: `${issueKey} summary`, approver: { accountId: approver },
    requestedBy: { accountId: 'agent' }, status, createdAt, updatedAt: createdAt, reminderHours: 24, reminderCount: 0,
    nextReminderAt: overdue ? '2000-01-01T00:00:00.000Z' : '2999-01-01T00:00:00.000Z', events: [],
  };
  store.data.set(`approval#${record.id}`, record);
  store.data.set(`issue#${issueKey}#${createdAt}#${record.id}`, record);
  store.data.set(`approver#${approver}#${createdAt}#${record.id}`, record);
  return record;
}

async function requestApproval(issueKey, approvers, approvalMode = 'all') {
  return call(agent, 'createApproval', 'agent-1', { issueKey, approvers: approvers.map((accountId) => ({ accountId })), approvalMode });
}

beforeEach(() => {
  store.data.clear();
  jira = createFakeJira({
    issues: { 'SD-1': { ...OPEN }, 'SD-2': { ...OPEN }, 'SD-3': { ...OPEN } },
    transitions: {
      'SD-1': [{ id: '31', to: 'Approved' }, { id: '41', to: 'Declined', category: 'done' }],
      'SD-2': [{ id: '31', to: 'Approved' }, { id: '41', to: 'Declined', category: 'done' }],
      'SD-3': [{ id: '31', to: 'Approved' }, { id: '41', to: 'Declined', category: 'done' }],
    },
  });
  store.data.set(`config#${PROJECT}`, { approveTargetStatus: 'Approved', declineTargetStatus: 'Declined', requireDeclineReason: true });
});

// 1. Automatic reminders at volume

test('reminders reach pending approvals created after 200+ older approvals (legacy data backfilled)', async () => {
  for (let i = 0; i < 250; i += 1) seedLegacy(i, { issueKey: 'SD-2' });
  const newest = seedLegacy(300, { issueKey: 'SD-1', status: 'pending', overdue: true });

  await runReminders();

  assert.deepEqual(commentsOn('SD-1'), ['Reminder: approval is still waiting for cust-a name. Please open My Approvals in the customer portal.']);
  assert.equal(get(`approval#${newest.id}`).reminderCount, 1);
  assert.ok(get(`pending#${newest.id}`), 'legacy pending approval was added to the pending index');
  assert.ok(!get(`pending#${seedLegacy(0).id}`), 'decided approvals are not indexed as pending');
});

test('reminders reach new approvals created through the agent panel', async () => {
  for (let i = 0; i < 250; i += 1) seedLegacy(i, { issueKey: 'SD-2' });
  const [created] = await requestApproval('SD-1', ['cust-b']);
  makeOverdue(created.id);
  jira.comments.length = 0;

  await runReminders();

  assert.equal(commentsOn('SD-1').length, 1);
  assert.equal(get(`approval#${created.id}`).reminderCount, 1);
});

// 2. My Approvals at volume

test('My Approvals shows a pending request even when the approver has 200+ older decisions', async () => {
  for (let i = 0; i < 250; i += 1) seedLegacy(i, { issueKey: 'SD-2', approver: 'cust-a' });
  const pending = seedLegacy(300, { issueKey: 'SD-1', approver: 'cust-a', status: 'pending' });

  const waiting = await call(portal, 'getMyApprovals', 'cust-a', { status: 'pending' });
  assert.deepEqual(waiting.map((a) => a.id), [pending.id]);

  const all = await call(portal, 'getMyApprovals', 'cust-a', {});
  assert.equal(all[0].id, pending.id, 'pending first');
  assert.equal(all.length, 1 + 50, 'history is capped to the newest 50');
  assert.equal(all[1].id, `${1735689600000 + 249}-legacy`, 'history starts with the newest decision');
});

test('My Approvals only lists approvals assigned to the signed-in customer', async () => {
  await requestApproval('SD-1', ['cust-a', 'cust-b']);
  const mine = await call(portal, 'getMyApprovals', 'cust-a', { status: 'pending' });
  assert.deepEqual(mine.map((a) => a.approver.accountId), ['cust-a']);
});

test('a customer cannot decide an approval assigned to someone else', async () => {
  const [forA] = await requestApproval('SD-1', ['cust-a']);
  await assert.rejects(call(portal, 'decideApproval', 'cust-b', { approvalId: forA.id, decision: 'approved' }), /not assigned to you/);
  assert.equal(get(`approval#${forA.id}`).status, 'pending');
});

test('a decided approval drops out of the pending indexes and cannot be decided twice', async () => {
  const [forA] = await requestApproval('SD-1', ['cust-a']);
  await call(portal, 'decideApproval', 'cust-a', { approvalId: forA.id, decision: 'approved' });
  assert.ok(!get(`pending#${forA.id}`));
  assert.ok(!get(`approverPending#cust-a#${forA.id}`));
  await assert.rejects(call(portal, 'decideApproval', 'cust-a', { approvalId: forA.id, decision: 'declined', reason: 'x' }), /already been decided/);
});

test('declining requires a reason when the project requires one', async () => {
  const [forA] = await requestApproval('SD-1', ['cust-a']);
  await assert.rejects(call(portal, 'decideApproval', 'cust-a', { approvalId: forA.id, decision: 'declined' }), /decline reason is required/);
});

// Group outcomes

test('all-approvers group completes only when everyone approves', async () => {
  const [a, b] = await requestApproval('SD-1', ['cust-a', 'cust-b'], 'all');
  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' });
  assert.deepEqual(jira.applied, []);
  await call(portal, 'decideApproval', 'cust-b', { approvalId: b.id, decision: 'approved' });
  assert.deepEqual(jira.applied, [{ issueKey: 'SD-1', to: 'Approved' }]);
});

test('any-one group completes on the first approval and closes the others', async () => {
  const [a, b] = await requestApproval('SD-1', ['cust-a', 'cust-b'], 'any');
  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' });
  assert.deepEqual(jira.applied, [{ issueKey: 'SD-1', to: 'Approved' }]);
  assert.equal(get(`approval#${b.id}`).status, 'not-required');
  assert.ok(!get(`pending#${b.id}`));
});

// 3. Cancellation completes a group

test('cancelling the last outstanding approver completes an all-approvers group', async () => {
  const [a, b, c] = await requestApproval('SD-1', ['cust-a', 'cust-b', 'cust-c'], 'all');
  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' });
  await call(portal, 'decideApproval', 'cust-b', { approvalId: b.id, decision: 'approved' });
  assert.deepEqual(jira.applied, []);

  await call(agent, 'cancelApproval', 'agent-1', { approvalId: c.id });

  assert.deepEqual(jira.applied, [{ issueKey: 'SD-1', to: 'Approved' }]);
  assert.ok(commentsOn('SD-1').includes('Approval complete. All required approvers have approved.'));
});

test('cancelling the last pending approver resolves an any-one group whose others declined', async () => {
  const [a, b] = await requestApproval('SD-1', ['cust-a', 'cust-b'], 'any');
  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'declined', reason: 'Too expensive' });
  assert.deepEqual(jira.applied, []);

  await call(agent, 'cancelApproval', 'agent-1', { approvalId: b.id });

  assert.deepEqual(jira.applied, [{ issueKey: 'SD-1', to: 'Declined' }]);
});

test('cancelling while other approvers are still pending does not complete the group', async () => {
  const [a, b, c] = await requestApproval('SD-1', ['cust-a', 'cust-b', 'cust-c'], 'all');
  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' });
  await call(agent, 'cancelApproval', 'agent-1', { approvalId: c.id });
  assert.deepEqual(jira.applied, []);
  assert.equal(get(`approval#${b.id}`).status, 'pending');
});

test('cancelling on a closed ticket never runs the completion transition', async () => {
  const [a, b] = await requestApproval('SD-1', ['cust-a', 'cust-b'], 'all');
  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' });
  Object.assign(jira.issues['SD-1'], CLOSED);

  await call(agent, 'cancelApproval', 'agent-1', { approvalId: b.id });

  assert.deepEqual(jira.applied, []);
});

// 4. Closed tickets and reminder limits

test('a late decision on a closed ticket is refused and the approval withdrawn, with no transition', async () => {
  const [a] = await requestApproval('SD-1', ['cust-a']);
  Object.assign(jira.issues['SD-1'], CLOSED);

  await assert.rejects(call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' }), /already been closed/);

  assert.deepEqual(jira.applied, []);
  assert.equal(get(`approval#${a.id}`).status, 'cancelled');
  assert.equal(get(`approval#${a.id}`).cancelReason, 'ticket-resolved');
  assert.deepEqual(await call(portal, 'getMyApprovals', 'cust-a', { status: 'pending' }), []);
});

test('the reminder worker withdraws approvals on closed or deleted tickets without commenting', async () => {
  const [onClosed] = await requestApproval('SD-1', ['cust-a']);
  const [onDeleted] = await requestApproval('SD-2', ['cust-a']);
  makeOverdue(onClosed.id); makeOverdue(onDeleted.id);
  Object.assign(jira.issues['SD-1'], CLOSED);
  delete jira.issues['SD-2'];
  jira.comments.length = 0;

  await runReminders();

  assert.deepEqual(jira.comments, []);
  assert.equal(get(`approval#${onClosed.id}`).cancelReason, 'ticket-resolved');
  assert.equal(get(`approval#${onDeleted.id}`).cancelReason, 'ticket-missing');
  assert.ok(!get(`pending#${onClosed.id}`) && !get(`pending#${onDeleted.id}`));
});

test(`automatic reminders stop after ${MAX_AUTOMATIC_REMINDERS}; manual reminders still work`, async () => {
  const [a] = await requestApproval('SD-1', ['cust-a']);
  jira.comments.length = 0;
  for (let i = 0; i < MAX_AUTOMATIC_REMINDERS + 3; i += 1) { makeOverdue(a.id); await runReminders(); }

  assert.equal(commentsOn('SD-1').length, MAX_AUTOMATIC_REMINDERS);
  assert.equal(get(`approval#${a.id}`).nextReminderAt, null);
  assert.equal(get(`approval#${a.id}`).status, 'pending', 'the approval itself stays open');

  await call(agent, 'sendReminder', 'agent-1', { approvalId: a.id });
  assert.equal(commentsOn('SD-1').length, MAX_AUTOMATIC_REMINDERS + 1);
});

test('closing a ticket withdraws its pending approvals immediately', async () => {
  const [a, b] = await requestApproval('SD-1', ['cust-a', 'cust-b']);
  const [other] = await requestApproval('SD-2', ['cust-a']);

  await runAutomation({ issue: { key: 'SD-1', fields: { project: { id: PROJECT }, status: { name: 'Closed', statusCategory: { key: 'done' } } } } });

  assert.equal(get(`approval#${a.id}`).status, 'cancelled');
  assert.equal(get(`approval#${b.id}`).status, 'cancelled');
  assert.equal(get(`approval#${other.id}`).status, 'pending');
});

test('approvals cannot be requested on a closed ticket', async () => {
  Object.assign(jira.issues['SD-1'], CLOSED);
  await assert.rejects(requestApproval('SD-1', ['cust-a']), /already closed/);
  assert.deepEqual(approvals(), []);
});

// Form-submission worker (same unbounded-queue problem)

test('the form worker checks every watch, not just the first 100, and drops watches on closed tickets', async () => {
  for (let i = 0; i < 120; i += 1) {
    jira.issues[`SD-${100 + i}`] = { ...OPEN };
    store.data.set(`formwatch#SD-${100 + i}`, { issueKey: `SD-${100 + i}`, projectId: PROJECT, formId: 'f1', instanceId: `i${i}`, ruleId: 'r1' });
  }
  jira.issues['SD-900'] = { ...CLOSED };
  store.data.set('formwatch#SD-900', { issueKey: 'SD-900', projectId: PROJECT, formId: 'f1', instanceId: 'x', ruleId: 'r1' });

  await runFormWorker();

  const formChecks = jira.calls.filter((c) => /^\/forms\/issue\/[^/]+\/form$/.test(c.path)).length;
  assert.equal(formChecks, 120, 'every open watch was checked');
  assert.ok(!get('formwatch#SD-900'), 'closed-ticket watch removed');
  assert.ok(get('formwatch#SD-219'), 'unsubmitted open watches are kept');
});

// Portal+ approval snapshot (issue property read by Portal+)

const snapshot = (issueKey) => jira.properties[`${issueKey}/nuvriqo.smart-approval.portal`];
const statuses = (issueKey) => Object.fromEntries((snapshot(issueKey)?.approvals || []).map((a) => [a.approverAccountId, a.status]));

test('the Portal+ snapshot follows create, decide and cancel, including siblings closed by the group', async () => {
  const [a, b, c] = await requestApproval('SD-1', ['cust-a', 'cust-b', 'cust-c'], 'all');
  assert.deepEqual(statuses('SD-1'), { 'cust-a': 'pending', 'cust-b': 'pending', 'cust-c': 'pending' });

  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' });
  await call(portal, 'decideApproval', 'cust-b', { approvalId: b.id, decision: 'approved' });
  await call(agent, 'cancelApproval', 'agent-1', { approvalId: c.id });
  assert.deepEqual(statuses('SD-1'), { 'cust-a': 'approved', 'cust-b': 'approved', 'cust-c': 'cancelled' });

  const [x, y] = await requestApproval('SD-2', ['cust-a', 'cust-b'], 'any');
  await call(portal, 'decideApproval', 'cust-a', { approvalId: x.id, decision: 'approved' });
  assert.equal(statuses('SD-2')['cust-b'], 'not-required', 'the closed sibling is no longer shown as waiting');
  assert.ok(y.id);
});

test('withdrawing approvals on a closed ticket updates the Portal+ snapshot', async () => {
  await requestApproval('SD-1', ['cust-a', 'cust-b']);
  const [late] = await requestApproval('SD-2', ['cust-a']);
  const [overdue] = await requestApproval('SD-3', ['cust-a']);

  await runAutomation({ issue: { key: 'SD-1', fields: { project: { id: PROJECT }, status: { name: 'Closed', statusCategory: { key: 'done' } } } } });
  assert.deepEqual(statuses('SD-1'), { 'cust-a': 'cancelled', 'cust-b': 'cancelled' });

  Object.assign(jira.issues['SD-2'], CLOSED);
  await assert.rejects(call(portal, 'decideApproval', 'cust-a', { approvalId: late.id, decision: 'approved' }));
  assert.deepEqual(statuses('SD-2'), { 'cust-a': 'cancelled' });

  Object.assign(jira.issues['SD-3'], CLOSED);
  makeOverdue(overdue.id);
  await runReminders();
  assert.deepEqual(statuses('SD-3'), { 'cust-a': 'cancelled' });
});

test('a Portal+ snapshot failure never blocks the approval change', async () => {
  const original = jira.requestJira;
  jira.requestJira = async (path, options) => (String(path).includes('/properties/') ? { ok: false, status: 500, text: async () => 'boom' } : original(path, options));
  const [a] = await requestApproval('SD-1', ['cust-a']);
  await call(portal, 'decideApproval', 'cust-a', { approvalId: a.id, decision: 'approved' });
  assert.equal(get(`approval#${a.id}`).status, 'approved');
  assert.deepEqual(jira.applied, [{ issueKey: 'SD-1', to: 'Approved' }]);
});
