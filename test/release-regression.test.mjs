import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portal = await readFile(new URL('../src/backend/portal.js', import.meta.url), 'utf8');
const agent = await readFile(new URL('../src/backend/index.js', import.meta.url), 'utf8');
const automation = await readFile(new URL('../src/backend/automation.js', import.meta.url), 'utf8');

// Group outcomes, reminders and My Approvals scoping are covered by behaviour
// tests in approval-lifecycle.test.mjs.

function includesAll(source, fragments) {
  for (const fragment of fragments) assert.ok(source.includes(fragment), `Missing release safeguard: ${fragment}`);
}

test('portal decisions enforce assignee ownership and pending-only action', () => {
  includesAll(portal, [
    "if (!context.accountId) throw new Error('You must be signed in to decide an approval.')",
    "if (record.approver?.accountId !== context.accountId) throw new Error('This approval is not assigned to you.')",
    "if (record.status !== 'pending') throw new Error('This approval has already been decided.')",
  ]);
});

test('decline reason is enforced when project configuration requires it', () => {
  assert.ok(portal.includes("if (decision === 'declined' && settings.requireDeclineReason && !reason) throw new Error('A decline reason is required.')"));
});

test('agent reminder and cancellation actions are pending-only', () => {
  const guard = "if (!record || record.status !== 'pending') throw new Error('Pending approval not found.')";
  assert.ok(agent.split(guard).length - 1 >= 2, 'Reminder and cancellation pending-state guards must both exist');
});

test('rule automation prepares approvals but does not send them automatically', () => {
  includesAll(automation, [
    'Matching rules only prepare the agent form. An agent must explicitly send the approval.',
    'await kvs.set(suggestionKey(issueKey)',
  ]);
  assert.ok(!automation.includes("createApproval"), 'Automation worker must not directly create/send approvals');
});

test('agent panel re-evaluates rules for tickets already in the configured trigger status', () => {
  includesAll(agent, [
    "import { run as prepareRuleSuggestion } from './automation.js';",
    "if (!suggestion && Array.isArray(settings.autoRules) && settings.autoRules.length > 0)",
    "await prepareRuleSuggestion({ issue: { key: issueKey, fields: { project: { id: projectId } } } });",
    "suggestion = await kvs.get(suggestionKey(issueKey));",
  ]);
});

test('duplicate pending approvers are suppressed when a new approval group is created', () => {
  includesAll(agent, [
    "const pendingAccountIds = new Set(existing.map((r) => r.value).filter((r) => r?.status === 'pending').map((r) => r.approver?.accountId));",
    "if (pendingAccountIds.has(accountId)) continue;",
  ]);
});
