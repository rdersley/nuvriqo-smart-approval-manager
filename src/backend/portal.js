import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { enrichApproval, resolveDisplayName } from './users.js';
import { writeApprovalAuditToForm } from './forms.js';
import { run as prepareRuleSuggestion } from './automation.js';
import { MAX_ACCOUNT_FORMS, attachAccountForm, isSubmitted, listAccountForms } from './account-forms.js';
import {
  addPublicComment, approvalKey, clean, configKey, ensurePendingIndex, expireApproval,
  issueState, json, loadPending, nowIso, publishIssueSnapshot, queryPrefix, resolveGroup, saveApproval,
} from './store.js';

const resolver = new Resolver();
const HISTORY_LIMIT = 50;
const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);

// The portal summary card can be limited per project (Configuration → Portal card).
// The portal only tells us its service desk ID, so map it to the project (cached).
export const PORTAL_CARD_MODES = ['always', 'pending', 'never'];
async function projectForPortal(portalId) {
  if (!/^\d+$/.test(portalId)) return '';
  const key = `portal-project#${portalId}`;
  const cached = await kvs.get(key);
  if (cached) return String(cached);
  try {
    const desk = await json(await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk/${portalId}`, { headers: { Accept: 'application/json' } }));
    const projectId = clean(desk?.projectId, 100);
    if (projectId) await kvs.set(key, projectId);
    return projectId;
  } catch (_) { return ''; }
}

resolver.define('getPortalCardMode', async ({ context }) => {
  const projectId = await projectForPortal(clean(context?.extension?.portal?.id, 30));
  if (!projectId) return { mode: 'always' };
  const settings = (await kvs.get(configKey(projectId))) || {};
  return { mode: PORTAL_CARD_MODES.includes(settings.portalCard) ? settings.portalCard : 'always' };
});

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
  const what = record.formAccountLabel ? `the form for ${record.formAccountLabel}` : 'this request';
  await addPublicComment(record.issueKey, `${approverName} ${decision === 'approved' ? 'approved' : 'declined'} ${what}${reason ? `: ${reason}` : '.'}`);

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
  await publishIssueSnapshot(record.issueKey);
  return enrichApproval(record);
});

// --- One form per account: customer side ---------------------------------
// Customers cannot add forms to a request in JSM themselves, so the request
// page offers "Add a form for another account". Only for someone who can see
// the request (checked as that customer), only while an account-form rule
// still matches, only after an agent sent the first form, and up to a cap.
async function accountFormContext(issueKey, accountId) {
  if (!accountId) throw new Error('You must be signed in.');
  const key = clean(issueKey, 100);
  const visible = await api.asUser().requestJira(route`/rest/servicedeskapi/request/${key}`, { headers: { Accept: 'application/json' } });
  if (!visible.ok) throw new Error('Request not found.');
  // This panel loads on every portal request page, so stop cheaply on closed
  // tickets and on projects with no account-form rule.
  const issue = await json(await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=project,status`));
  if (issue?.fields?.status?.statusCategory?.key === 'done') return { key, enabled: false };
  const projectId = String(issue?.fields?.project?.id || '');
  const rules = (await kvs.get(configKey(projectId)))?.autoRules || [];
  if (!rules.some((rule) => rule?.formEnabled === true && rule?.formPerAccount === true)) return { key, enabled: false };
  await prepareRuleSuggestion({ issue: { key, fields: { project: { id: projectId } } } });
  const suggestion = await kvs.get(`suggestion#${key}`);
  if (!suggestion?.formEnabled || !suggestion?.formPerAccount || !suggestion?.formId) return { key, enabled: false };
  return { key, enabled: true, projectId, suggestion, forms: await listAccountForms(key, suggestion.formId) };
}

resolver.define('getAccountForms', async ({ payload, context }) => {
  const ctx = await accountFormContext(payload?.issueKey, context.accountId);
  if (!ctx.enabled || !ctx.forms.length) return { enabled: false };
  return {
    enabled: true, max: MAX_ACCOUNT_FORMS, count: ctx.forms.length,
    submitted: ctx.forms.filter(isSubmitted).length, canAdd: ctx.forms.length < MAX_ACCOUNT_FORMS,
  };
});

resolver.define('addAccountForm', async ({ payload, context }) => {
  const ctx = await accountFormContext(payload?.issueKey, context.accountId);
  if (!ctx.enabled) throw new Error('This request does not use one form per account.');
  if (!ctx.forms.length) throw new Error('The service desk has not sent a form for this request yet.');
  const attached = await attachAccountForm({ issueKey: ctx.key, projectId: ctx.projectId, suggestion: ctx.suggestion });
  return { added: true, number: attached.number, max: MAX_ACCOUNT_FORMS };
});

export const handler = resolver.getDefinitions();
