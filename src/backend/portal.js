import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import { enrichApproval, resolveDisplayName } from './users.js';
import { writeApprovalAuditToForm } from './forms.js';
import {
  addPublicComment, approvalKey, clean, configKey, ensurePendingIndex, expireApproval,
  issueState, loadPending, nowIso, queryPrefix, resolveGroup, saveApproval,
} from './store.js';

const resolver = new Resolver();
const HISTORY_LIMIT = 50;
const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);

resolver.define('getMyApprovals', async ({ payload, context }) => {
  if (!context.accountId) throw new Error('You must be signed in to view approvals.');
  await ensurePendingIndex();
  const filter = clean(payload?.status, 30);
  // Pending approvals come from the pending-only index so none are ever hidden
  // behind older history; history is the newest decided records.
  const pending = filter && filter !== 'pending' ? [] : (await loadPending(`approverPending#${context.accountId}#`)).sort(byNewest);
  let history = [];
  if (filter !== 'pending') {
    const rows = await queryPrefix(`approver#${context.accountId}#`);
    history = rows.map((r) => r.value)
      .filter((r) => r && r.status !== 'pending' && (!filter || r.status === filter))
      .sort(byNewest)
      .slice(0, HISTORY_LIMIT);
  }
  return Promise.all([...pending, ...history].map(enrichApproval));
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

  // A late decision must not act on a finished ticket: its workflow transition
  // could reopen it. Withdraw the approval instead.
  const state = await issueState(record.issueKey);
  if (state !== 'open') {
    await expireApproval(record, state === 'done' ? 'ticket-resolved' : 'ticket-missing');
    throw new Error('This request has already been closed, so your approval is no longer needed.');
  }

  const at = nowIso();
  record.status = decision;
  record.decisionReason = reason;
  record.decidedAt = at;
  record.updatedAt = at;
  record.events = [...(record.events || []), { type: decision, at, by: context.accountId, reason }];
  await saveApproval(record);
  const approverName = await resolveDisplayName(record.approver.accountId);
  await addPublicComment(record.issueKey, `${approverName} ${decision === 'approved' ? 'approved' : 'declined'} this request${reason ? `: ${reason}` : '.'}`);

  // Where the rule maps dedicated audit questions, write the decision back onto
  // the same JSM Form instance. This is best-effort: the approval decision remains
  // authoritative even if Jira Forms rejects an update (for example a locked form).
  if (record.formSnapshot?.instanceId && record.formSnapshot?.auditFieldMap) {
    try {
      const writeBack = await writeApprovalAuditToForm(record.issueKey, record.formSnapshot.instanceId, record.formSnapshot.auditFieldMap, {
        approverName,
        decidedAt: at,
        decision: decision === 'approved' ? 'Approved' : 'Declined',
        comment: reason,
      });
      record.formAuditWritten = writeBack?.written === true;
      record.events = [...record.events, { type: record.formAuditWritten ? 'form-audit-written' : 'form-audit-skipped', at: nowIso(), by: 'system' }];
    } catch (error) {
      record.formAuditWritten = false;
      record.events = [...record.events, { type: 'form-audit-write-failed', at: nowIso(), by: 'system' }];
    }
    record.updatedAt = nowIso();
    await saveApproval(record);
  }

  await resolveGroup(record, settings);
  return enrichApproval(record);
});

export const handler = resolver.getDefinitions();
