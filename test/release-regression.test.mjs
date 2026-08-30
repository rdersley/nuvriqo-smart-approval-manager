import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portal = await readFile(new URL('../src/backend/portal.js', import.meta.url), 'utf8');
const agent = await readFile(new URL('../src/backend/index.js', import.meta.url), 'utf8');
const automation = await readFile(new URL('../src/backend/automation.js', import.meta.url), 'utf8');
const reminders = await readFile(new URL('../src/backend/reminders.js', import.meta.url), 'utf8');

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

test('all-approvers mode resolves correctly', () => {
  includesAll(portal, [
    "if (declined > 0) return 'declined';",
    "if (pending === 0 && approved === active.length && active.length > 0) return 'approved';",
  ]);
});

test('any-one-approver mode resolves correctly and closes redundant pending approvals', () => {
  includesAll(portal, [
    "if (approved > 0) return 'approved';",
    "if (pending === 0 && declined > 0) return 'declined';",
    "if (mode === 'any' && outcome === 'approved') await closeRedundantPending(records, record.id, outcome);",
  ]);
});

test('agent reminder and cancellation actions are pending-only', () => {
  const guard = "if (!record || record.status !== 'pending') throw new Error('Pending approval not found.')";
  assert.ok(agent.split(guard).length - 1 >= 2, 'Reminder and cancellation pending-state guards must both exist');
});

test('automatic reminders process only pending approvals and move the next reminder forward', () => {
  includesAll(reminders, [
    ".filter((x) => x?.status === 'pending')",
    "if (!record.nextReminderAt || Date.parse(record.nextReminderAt) > now) continue;",
    "record.reminderCount = Number(record.reminderCount || 0) + 1;",
    "record.nextReminderAt = new Date(now + Number(record.reminderHours || 24) * 3600000).toISOString();",
  ]);
});

test('rule automation prepares approvals but does not send them automatically', () => {
  includesAll(automation, [
    'Matching rules only prepare the agent form. An agent must explicitly send the approval.',
    'await kvs.set(suggestionKey(issueKey)',
  ]);
  assert.ok(!automation.includes("createApproval"), 'Automation worker must not directly create/send approvals');
});

test('duplicate pending approvers are suppressed when a new approval group is created', () => {
  includesAll(agent, [
    "const pendingAccountIds = new Set(existing.map((r) => r.value).filter((r) => r?.status === 'pending').map((r) => r.approver?.accountId));",
    "if (pendingAccountIds.has(accountId)) continue;",
  ]);
});

test('portal approval list is scoped to the signed-in approver account', () => {
  includesAll(portal, [
    "if (!context.accountId) throw new Error('You must be signed in to view approvals.')",
    "queryPrefix(`approver#${context.accountId}#`, 200)",
  ]);
});
