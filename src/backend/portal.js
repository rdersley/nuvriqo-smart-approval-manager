import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { enrichApproval, resolveDisplayName, stripStoredDisplayName } from './users.js';

const resolver = new Resolver();
const approvalKey = (id) => `approval#${id}`;
const approverIndexKey = (accountId, createdAt, id) => `approver#${accountId}#${createdAt}#${id}`;
const issueIndexKey = (issueKey, createdAt, id) => `issue#${issueKey}#${createdAt}#${id}`;
const configKey = (projectId) => `config#${projectId}`;
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();

async function json(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(body || `Atlassian API error ${response.status}`);
  return body ? JSON.parse(body) : null;
}

async function queryPrefix(prefix, max = 200) {
  let cursor;
  const out = [];
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(20);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...(page?.results || []));
    cursor = page?.nextCursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

async function saveApproval(record) {
  const stored = stripStoredDisplayName(record);
  await Promise.all([
    kvs.set(approvalKey(stored.id), stored),
    kvs.set(issueIndexKey(stored.issueKey, stored.createdAt, stored.id), stored),
    kvs.set(approverIndexKey(stored.approver.accountId, stored.createdAt, stored.id), stored),
  ]);
}

async function addPublicComment(issueKey, text) {
  try {
    await json(await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: text, public: true }),
    }));
  } catch (error) { console.warn('Unable to add JSM public comment', error?.message || error); }
}

async function transitionIssue(issueKey, targetStatus, legacyTransitionId) {
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

async function groupRecords(record) {
  const rows = await queryPrefix(`issue#${record.issueKey}#`, 200);
  const all = rows.map((r) => r.value);
  if (!record.groupId) return [record];
  return all.filter((r) => r?.groupId === record.groupId);
}

function groupOutcome(records, mode) {
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

async function closeRedundantPending(records, winnerId, outcome) {
  const at = nowIso();
  for (const sibling of records) {
    if (sibling.id === winnerId || sibling.status !== 'pending') continue;
    sibling.status = outcome === 'approved' ? 'not-required' : 'cancelled';
    sibling.updatedAt = at;
    sibling.events = [...(sibling.events || []), { type: sibling.status, at, by: 'system', reason: `Group resolved as ${outcome}` }];
    await saveApproval(sibling);
  }
}

resolver.define('getMyApprovals', async ({ payload, context }) => {
  if (!context.accountId) throw new Error('You must be signed in to view approvals.');
  const rows = await queryPrefix(`approver#${context.accountId}#`, 200);
  const all = rows.map((r) => r.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const filter = clean(payload?.status, 30);
  const selected = filter ? all.filter((r) => r.status === filter) : all;
  return Promise.all(selected.map(enrichApproval));
});

resolver.define('decideApproval', async ({ payload, context }) => {
  const id = clean(payload?.approvalId, 200);
  const decision = payload?.decision === 'approved' ? 'approved' : payload?.decision === 'declined' ? 'declined' : null;
  if (!id || !decision) throw new Error('Invalid approval decision.');
  if (!context.accountId) throw new Error('You must be signed in to decide an approval.');

  const record = await kvs.get(approvalKey(id));
  if (!record) throw new Error('Approval not found.');
  if (record.approver?.accountId !== context.accountId) throw new Error('This approval is not assigned to you.');
  if (record.status !== 'pending') throw new Error('This approval has already been decided.');

  const settings = (await kvs.get(configKey(record.projectId))) || {};
  const reason = clean(payload?.reason, 2000);
  if (decision === 'declined' && settings.requireDeclineReason && !reason) throw new Error('A decline reason is required.');

  const at = nowIso();
  record.status = decision;
  record.decisionReason = reason;
  record.decidedAt = at;
  record.updatedAt = at;
  record.events = [...(record.events || []), { type: decision, at, by: context.accountId, reason }];
  await saveApproval(record);
  const approverName = await resolveDisplayName(record.approver.accountId);
  await addPublicComment(record.issueKey, `${approverName} ${decision === 'approved' ? 'approved' : 'declined'} this request${reason ? `: ${reason}` : '.'}`);

  const records = await groupRecords(record);
  const mode = record.approvalMode === 'any' ? 'any' : 'all';
  const outcome = groupOutcome(records, mode);
  record.groupOutcome = outcome;
  record.updatedAt = nowIso();
  await saveApproval(record);

  if (outcome !== 'pending') {
    if (mode === 'any' && outcome === 'approved') await closeRedundantPending(records, record.id, outcome);
    if (mode === 'all' && outcome === 'declined') await closeRedundantPending(records, record.id, outcome);

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
  }
  return enrichApproval(record);
});

export const handler = resolver.getDefinitions();
