import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { stripStoredDisplayName } from './users.js';
import { publishPortalPlusApprovalSnapshot } from './portal-plus-publisher.js';

export const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
export const nowIso = () => new Date().toISOString();

export const approvalKey = (id) => `approval#${id}`;
export const issueIndexKey = (issueKey, createdAt, id) => `issue#${issueKey}#${createdAt}#${id}`;
export const approverIndexKey = (accountId, createdAt, id) => `approver#${accountId}#${createdAt}#${id}`;
// Pending-only pointer indexes. Every approval list that matters for action
// (reminders, "needs your decision") reads these, so they stay small no matter
// how many decided approvals accumulate.
export const pendingKey = (id) => `pending#${id}`;
export const approverPendingKey = (accountId, id) => `approverPending#${accountId}#${id}`;
export const configKey = (projectId) => `config#${projectId}`;
const PENDING_INDEX_MIGRATION_KEY = 'meta#pending-index-v1';

// Automatic reminders stop after this many; agents can still send manual ones.
export const MAX_AUTOMATIC_REMINDERS = 5;

export async function json(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(body || `Atlassian API error ${response.status}`);
  return body ? JSON.parse(body) : null;
}

// Reads every key under a prefix. Keys sort ascending (oldest first for our
// timestamped keys), so a cap here silently hides the newest records.
export async function queryPrefix(prefix) {
  let cursor;
  const out = [];
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...(page?.results || []));
    cursor = page?.nextCursor;
  } while (cursor);
  return out;
}

async function writePendingIndex(stored) {
  const pointer = { id: stored.id };
  if (stored.status === 'pending') {
    await Promise.all([
      kvs.set(pendingKey(stored.id), pointer),
      kvs.set(approverPendingKey(stored.approver.accountId, stored.id), pointer),
    ]);
  } else {
    await Promise.all([
      kvs.delete(pendingKey(stored.id)),
      kvs.delete(approverPendingKey(stored.approver.accountId, stored.id)),
    ]);
  }
}

export async function saveApproval(record) {
  const stored = stripStoredDisplayName(record);
  await Promise.all([
    kvs.set(approvalKey(stored.id), stored),
    kvs.set(issueIndexKey(stored.issueKey, stored.createdAt, stored.id), stored),
    kvs.set(approverIndexKey(stored.approver.accountId, stored.createdAt, stored.id), stored),
    writePendingIndex(stored),
  ]);
}

// Approvals created before the pending indexes existed have no pointer. Build
// them once from the full approval list; safe to run concurrently or repeatedly.
export async function ensurePendingIndex() {
  if (await kvs.get(PENDING_INDEX_MIGRATION_KEY)) return;
  const rows = await queryPrefix('approval#');
  for (const { value } of rows) {
    if (value?.id && value?.approver?.accountId) await writePendingIndex(value);
  }
  await kvs.set(PENDING_INDEX_MIGRATION_KEY, { at: nowIso() });
}

// Loads records behind pending pointers, dropping pointers that went stale.
export async function loadPending(prefix) {
  const pointers = await queryPrefix(prefix);
  const records = [];
  for (const { key, value } of pointers) {
    const record = await kvs.get(approvalKey(value?.id));
    if (record?.status === 'pending') records.push(record);
    else await kvs.delete(key);
  }
  return records;
}

export async function addPublicComment(issueKey, text) {
  try {
    await json(await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: text, public: true }),
    }));
  } catch (error) { console.warn('Unable to add JSM public comment', error?.message || error); }
}

export async function transitionIssue(issueKey, targetStatus, legacyTransitionId) {
  let transitionId = clean(legacyTransitionId, 100);
  const target = clean(targetStatus, 200);
  if (target) {
    const available = await json(await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`));
    const match = (available?.transitions || []).find((t) => clean(t?.to?.name, 200).toLowerCase() === target.toLowerCase());
    if (!match?.id) throw new Error(`No available Jira transition leads to status “${target}” from the ticket's current status.`);
    transitionId = String(match.id);
  }
  if (!transitionId) return false;
  await json(await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ transition: { id: transitionId } }),
  }));
  return true;
}

// Returns 'open', 'done' (status category Done) or 'missing' (deleted, or the
// app can no longer see it). Throws on other failures so callers can retry later.
export async function issueState(issueKey) {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=status`);
  if (response.status === 404) return 'missing';
  const issue = await json(response);
  return issue?.fields?.status?.statusCategory?.key === 'done' ? 'done' : 'open';
}

// Publishes the customer-safe approval snapshot Portal+ reads. Best-effort: a
// failure must never undo or block the approval change that triggered it.
export async function publishIssueSnapshot(issueKey) {
  try {
    const records = (await queryPrefix(`issue#${issueKey}#`)).map((r) => r.value);
    return await publishPortalPlusApprovalSnapshot({ issueKey, records });
  } catch (error) {
    console.warn('Unable to publish Portal+ approval snapshot', error?.message || error);
    return null;
  }
}

async function withdraw(record, reason) {
  const at = nowIso();
  record.status = 'cancelled';
  record.cancelReason = reason;
  record.cancelledAt = at;
  record.updatedAt = at;
  record.nextReminderAt = null;
  record.events = [...(record.events || []), { type: 'expired', at, by: 'system', reason }];
  await saveApproval(record);
}

// Withdraws a pending approval because its ticket is finished. No public comment:
// the ticket is already closed and the customer does not need another notification.
export async function expireApproval(record, reason) {
  await withdraw(record, reason);
  await publishIssueSnapshot(record.issueKey);
  return record;
}

export async function expirePendingForIssue(issueKey, reason) {
  const rows = await queryPrefix(`issue#${issueKey}#`);
  const pending = rows.map((r) => r.value).filter((r) => r?.status === 'pending');
  for (const record of pending) await withdraw(record, reason);
  if (pending.length) await publishIssueSnapshot(issueKey);
  return pending.length;
}

export async function groupRecords(record) {
  if (!record.groupId) return [record];
  const rows = await queryPrefix(`issue#${record.issueKey}#`);
  return rows.map((r) => r.value).filter((r) => r?.groupId === record.groupId);
}

export function groupOutcome(records, mode) {
  const active = records.filter((r) => r.status !== 'cancelled');
  const approved = active.filter((r) => r.status === 'approved').length;
  const declined = active.filter((r) => r.status === 'declined').length;
  const pending = active.filter((r) => r.status === 'pending').length;
  if (mode === 'any') {
    if (approved > 0) return 'approved';
    if (pending === 0 && declined > 0) return 'declined';
    return 'pending';
  }
  if (declined > 0) return 'declined';
  if (pending === 0 && approved === active.length && active.length > 0) return 'approved';
  return 'pending';
}

async function closeRedundantPending(records, outcome) {
  const at = nowIso();
  for (const sibling of records) {
    if (sibling.status !== 'pending') continue;
    sibling.status = outcome === 'approved' ? 'not-required' : 'cancelled';
    sibling.updatedAt = at;
    sibling.events = [...(sibling.events || []), { type: sibling.status, at, by: 'system', reason: `Group resolved as ${outcome}` }];
    await saveApproval(sibling);
  }
}

// Re-evaluates the approval group after `record` changed (a decision or a
// cancellation) and, once the group is complete, applies the configured workflow
// transition and posts the completion comment. Saves `record`.
export async function resolveGroup(record, settings) {
  const records = (await groupRecords(record)).map((r) => (r.id === record.id ? record : r));
  const mode = record.approvalMode === 'any' ? 'any' : 'all';
  const outcome = groupOutcome(records, mode);
  record.groupOutcome = outcome;
  record.updatedAt = nowIso();
  await saveApproval(record);
  if (outcome === 'pending') return outcome;

  await closeRedundantPending(records.filter((r) => r.id !== record.id), outcome);

  const targetStatus = outcome === 'approved'
    ? clean(record.ruleTargetStatuses?.approved || settings.approveTargetStatus, 200)
    : clean(record.ruleTargetStatuses?.declined || settings.declineTargetStatus, 200);
  const transitionId = outcome === 'approved'
    ? clean(record.ruleTransitionIds?.approved || settings.approveTransitionId, 100)
    : clean(record.ruleTransitionIds?.declined || settings.declineTransitionId, 100);

  if (targetStatus || transitionId) {
    try {
      await transitionIssue(record.issueKey, targetStatus, transitionId);
      record.transitionApplied = true;
      record.events = [...record.events, { type: 'transition-applied', at: nowIso(), by: 'system', targetStatus, transitionId, groupOutcome: outcome }];
    } catch (error) {
      record.transitionApplied = false;
      record.transitionError = clean(error?.message || error, 500);
      record.events = [...record.events, { type: 'transition-failed', at: nowIso(), by: 'system', error: record.transitionError }];
    }
    record.updatedAt = nowIso();
    await saveApproval(record);
  }
  await addPublicComment(record.issueKey, outcome === 'approved'
    ? `Approval complete. ${mode === 'all' && records.length > 1 ? 'All required approvers have approved.' : 'The required approval has been granted.'}`
    : `Approval declined. ${mode === 'all' && records.length > 1 ? 'A required approver declined the request.' : 'The approval requirement was not met.'}`);
  return outcome;
}
