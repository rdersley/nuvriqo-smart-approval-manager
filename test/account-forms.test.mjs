// Behaviour tests for "one form per account" rules: a separate JSM Form copy
// and a separate approval for each user account on one ticket. Runs the real
// resolvers and workers against in-memory KVS and Jira.
// Requires: node --experimental-test-module-mocks
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { beforeEach, mock, test } from 'node:test';
import { createFakeJira, createFakeKvs, route } from './helpers/fakes.mjs';

const PROJECT = '10000';
let jira;
let caller = '';
const store = createFakeKvs();
const { default: Resolver } = createRequire(import.meta.url)('@forge/resolver');
mock.module('@forge/resolver', { defaultExport: Resolver });
mock.module('@forge/api', {
  defaultExport: {
    asApp: () => ({ requestJira: (path, options) => jira.requestJira(path, options) }),
    asUser: () => ({ requestJira: (path, options) => jira.requestJira(path, options, caller) }),
  },
  namedExports: { route },
});
mock.module('@forge/kvs', { namedExports: { kvs: store.kvs, WhereConditions: store.WhereConditions } });

const { handler: agent } = await import('../src/backend/index.js');
const { handler: portal } = await import('../src/backend/portal.js');
const { run: runAutomation } = await import('../src/backend/automation.js');
const { run: runFormWorker } = await import('../src/backend/form-submission-worker.js');
const { MAX_ACCOUNT_FORMS } = await import('../src/backend/account-forms.js');

const call = (handler, functionKey, accountId, payload = {}) => {
  caller = accountId;
  return handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });
};
const copies = () => jira.forms['SD-1'] || [];
const sendForm = () => call(agent, 'sendApprovalFormToCustomer', 'agent-1', { issueKey: 'SD-1' });
const requestFor = (copyId, approvers = ['mgr']) => call(agent, 'createApproval', 'agent-1', {
  issueKey: 'SD-1', approvers: approvers.map((accountId) => ({ accountId })), preparedRuleId: 'r1', formInstanceId: copyId,
});
const decide = (approval, decision) => call(portal, 'decideApproval', approval.approver.accountId, { approvalId: approval.id, decision, reason: decision === 'declined' ? 'Not needed' : '' });
const submit = (copyId, username) => jira.submitForm('SD-1', copyId, { username, reason: 'Password not working' });
const issueUpdated = () => runAutomation({ issue: { key: 'SD-1', fields: { project: { id: PROJECT }, status: { name: 'Open', statusCategory: { key: 'new' } } } } });

function useRule(overrides = {}) {
  store.data.set(`config#${PROJECT}`, {
    requireDeclineReason: false,
    autoRules: [{
      id: 'r1', name: 'Vector password', approvalMode: 'all',
      conditions: [{ fieldId: 'summary', operator: 'notEmpty' }], approvers: [{ accountId: 'mgr' }],
      formEnabled: true, formPerAccount: true, formId: 'tpl-1', formAccountFieldKey: 'username', formFieldKeys: [],
      decisionFieldKey: 'decision', approveTargetStatus: 'Approved', declineTargetStatus: 'Declined',
      ...overrides,
    }],
  });
}

beforeEach(() => {
  store.data.clear();
  caller = '';
  jira = createFakeJira({
    issues: { 'SD-1': { projectId: PROJECT, status: 'Open', category: 'new', customers: ['cust'] } },
    transitions: { 'SD-1': [{ id: '31', to: 'Approved' }, { id: '41', to: 'Declined' }] },
  });
  useRule();
});

test('each send attaches another customer-visible copy of the form', async () => {
  await sendForm();
  await sendForm();
  await sendForm();
  assert.equal(copies().length, 3);
  assert.ok(copies().every((c) => c.external && c.formTemplate.id === 'tpl-1'));
  assert.equal(jira.comments.filter((c) => /separate form is required for each user account/.test(c.body)).length, 1, 'customer told once');
});

test('the customer can add a form for another account, but only on their own request', async () => {
  await assert.rejects(call(portal, 'addAccountForm', 'cust', { issueKey: 'SD-1' }), /has not sent a form/);
  await sendForm();
  assert.deepEqual(await call(portal, 'getAccountForms', 'cust', { issueKey: 'SD-1' }), { enabled: true, max: MAX_ACCOUNT_FORMS, count: 1, submitted: 0, canAdd: true });

  await call(portal, 'addAccountForm', 'cust', { issueKey: 'SD-1' });
  assert.equal(copies().length, 2);
  assert.ok(copies()[1].external);

  await assert.rejects(call(portal, 'addAccountForm', 'stranger', { issueKey: 'SD-1' }), /Request not found/);
  assert.equal(copies().length, 2);
});

test('the customer cannot add forms beyond the cap or when the rule is not one-form-per-account', async () => {
  await sendForm();
  for (let i = 1; i < MAX_ACCOUNT_FORMS; i += 1) await call(portal, 'addAccountForm', 'cust', { issueKey: 'SD-1' });
  await assert.rejects(call(portal, 'addAccountForm', 'cust', { issueKey: 'SD-1' }), /maximum of 25/);
  assert.equal(copies().length, MAX_ACCOUNT_FORMS);

  useRule({ formPerAccount: false });
  assert.deepEqual(await call(portal, 'getAccountForms', 'cust', { issueKey: 'SD-1' }), { enabled: false });
  await assert.rejects(call(portal, 'addAccountForm', 'cust', { issueKey: 'SD-1' }), /does not use one form per account/);
});

test('each submitted form gets its own approval, labelled with its account, from the same approver', async () => {
  await sendForm(); await sendForm();
  const [first, second] = copies();
  submit(first.id, 'FCOpacker1@ryr.com');
  submit(second.id, 'FCOpacker2@ryr.com');

  const [a1] = await requestFor(first.id);
  const [a2] = await requestFor(second.id);
  assert.equal(a1.approver.accountId, 'mgr');
  assert.equal(a2.approver.accountId, 'mgr', 'same approver approves both accounts');
  assert.equal(a1.formAccountLabel, 'FCOpacker1@ryr.com');
  assert.equal(a2.formSnapshot.instanceId, second.id);
  assert.deepEqual(a2.formSnapshot.answers.map((r) => r.answer), ['FCOpacker2@ryr.com', 'Password not working']);
  assert.ok(jira.comments.some((c) => c.body.includes('Approval requested from mgr name for FCOpacker2@ryr.com.')));

  const mine = await call(portal, 'getMyApprovals', 'mgr', { status: 'pending' });
  assert.deepEqual(mine.map((a) => a.formAccountLabel).sort(), ['FCOpacker1@ryr.com', 'FCOpacker2@ryr.com']);
});

test('an account form cannot be approved twice, before it is submitted, or without saying which form', async () => {
  await sendForm(); await sendForm();
  const [first, second] = copies();
  submit(first.id, 'FCOpacker1@ryr.com');
  await requestFor(first.id);
  await assert.rejects(requestFor(first.id), /already has an approval/);
  await assert.rejects(requestFor(second.id), /has not submitted this account form/);
  await assert.rejects(requestFor(''), /Choose which account form/);
  await assert.rejects(requestFor('not-a-copy'), /not on this request/);
});

test('the ticket moves on only once every account form is decided, then reports declined accounts', async () => {
  for (let i = 0; i < 3; i += 1) await sendForm();
  const [f1, f2, f3] = copies();
  submit(f1.id, 'FCOpacker1@ryr.com');
  submit(f2.id, 'FCOpacker2@ryr.com');
  const [a1] = await requestFor(f1.id);
  const [a2] = await requestFor(f2.id);

  await decide(a1, 'approved');
  await decide(a2, 'approved');
  assert.deepEqual(jira.applied, [], 'form 3 has not been submitted yet');

  submit(f3.id, 'FCOpacker3@ryr.com');
  const [a3] = await requestFor(f3.id);
  assert.deepEqual(jira.applied, []);
  await decide(a3, 'declined');

  assert.deepEqual(jira.applied, [{ issueKey: 'SD-1', to: 'Approved' }], 'some accounts approved → approved status, once');
  assert.ok(jira.comments.some((c) => c.body === 'All account forms on this request have been decided: 2 approved, 1 declined. Declined: FCOpacker3@ryr.com.'));
  assert.ok(jira.comments.some((c) => c.body === 'Approval for FCOpacker1@ryr.com: approved.'));
});

test('when every account is declined the ticket gets the declined status', async () => {
  await sendForm(); await sendForm();
  const [f1, f2] = copies();
  submit(f1.id, 'A'); submit(f2.id, 'B');
  const [a1] = await requestFor(f1.id);
  const [a2] = await requestFor(f2.id);
  await decide(a1, 'declined');
  await decide(a2, 'declined');
  assert.deepEqual(jira.applied, [{ issueKey: 'SD-1', to: 'Declined' }]);
});

test('each decision is written back onto its own form copy', async () => {
  await sendForm(); await sendForm();
  const [f1, f2] = copies();
  submit(f1.id, 'A'); submit(f2.id, 'B');
  await requestFor(f1.id);
  const [a2] = await requestFor(f2.id);
  await decide(a2, 'approved');
  assert.deepEqual(copies()[1].writtenBack, { decision: { text: 'Approved' } });
  assert.equal(copies()[0].writtenBack, undefined);
});

test('with auto-send, each copy sends its own approval when the customer submits it', async () => {
  useRule({ autoSendOnFormSubmit: true });
  await sendForm();
  await call(portal, 'addAccountForm', 'cust', { issueKey: 'SD-1' });
  await call(portal, 'addAccountForm', 'cust', { issueKey: 'SD-1' });
  const [f1, f2, f3] = copies();
  submit(f1.id, 'FCOpacker1@ryr.com');
  submit(f3.id, 'FCOpacker3@ryr.com');

  await runFormWorker();
  await runFormWorker(); // a second pass must not duplicate

  const approvals = [...store.data.entries()].filter(([k]) => k.startsWith('approval#')).map(([, v]) => v);
  assert.deepEqual(approvals.map((a) => a.formSnapshot.instanceId).sort(), [f1.id, f3.id].sort());
  assert.ok(store.data.get(`formwatch#SD-1#${f2.id}`), 'the unsubmitted copy is still watched');
  assert.equal(store.data.get(`formwatch#SD-1#${f1.id}`), undefined);
});

test('the agent panel lists each account form with its state', async () => {
  for (let i = 0; i < 3; i += 1) await sendForm();
  const [f1, f2] = copies();
  submit(f1.id, 'FCOpacker1@ryr.com');
  submit(f2.id, 'FCOpacker2@ryr.com');
  const [a1] = await requestFor(f1.id);
  await decide(a1, 'approved');
  await issueUpdated();

  const status = await call(agent, 'getApprovalFormStatus', 'agent-1', { issueKey: 'SD-1' });
  assert.equal(status.perAccount, true);
  assert.deepEqual(status.forms.map(({ number, label, state }) => ({ number, label, state })), [
    { number: 1, label: 'FCOpacker1@ryr.com', state: 'approved' },
    { number: 2, label: 'FCOpacker2@ryr.com', state: 'submitted' },
    { number: 3, label: '', state: 'waiting-for-customer' },
  ]);
  const defaults = await call(agent, 'getApprovalDefaults', 'agent-1', { issueKey: 'SD-1' });
  assert.deepEqual(defaults.suggestion.approvers.map((a) => a.accountId), ['mgr'], 'approver stays prepared for the remaining forms');
});

test('rules without one form per account still use a single form and a single approval', async () => {
  useRule({ formPerAccount: false });
  await sendForm();
  const again = await sendForm();
  assert.equal(again.alreadyAttached, true);
  assert.equal(copies().length, 1);

  submit(copies()[0].id, 'A');
  await call(agent, 'createApproval', 'agent-1', { issueKey: 'SD-1', approvers: [{ accountId: 'mgr' }], preparedRuleId: 'r1' });
  await assert.rejects(
    call(agent, 'createApproval', 'agent-1', { issueKey: 'SD-1', approvers: [{ accountId: 'mgr' }] }),
    /No new active approvers/,
    'an approver with a pending approval on the ticket is not asked twice',
  );
});
