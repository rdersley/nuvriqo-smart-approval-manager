import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { enrichApproval, resolveDisplayName, stripStoredDisplayName } from './users.js';
import { run as prepareRuleSuggestion } from './automation.js';
import { getFormPreview, attachExternalFormToIssue, listIssueForms } from './forms.js';

const resolver = new Resolver();
const nowIso = () => new Date().toISOString();
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const approvalKey = (id) => `approval#${id}`;
const issueIndexKey = (issueKey, createdAt, id) => `issue#${issueKey}#${createdAt}#${id}`;
const approverIndexKey = (accountId, createdAt, id) => `approver#${accountId}#${createdAt}#${id}`;
const configKey = (projectId) => `config#${projectId}`;
const suggestionKey = (issueKey) => `suggestion#${issueKey}`;
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);

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

async function getIssueAsUser(issueKey) {
  return json(await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,project,status,reporter`));
}

async function getCanonicalUser(accountId) {
  return json(await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`));
}

async function addPublicComment(issueKey, text) {
  try {
    await json(await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: text, public: true }),
    }));
  } catch (error) { console.warn('Unable to add JSM public comment', error?.message || error); }
}

async function addParticipant(issueKey, accountId) {
  try {
    await json(await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/participant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ accountIds: [accountId] }),
    }));
    return true;
  } catch (error) { console.warn('Unable to add approver as request participant', error?.message || error); return false; }
}

async function transitionIssue(issueKey, targetStatus, legacyTransitionId) {
  let transitionId = clean(legacyTransitionId, 100);
  const target = clean(targetStatus, 200);
  if (target) {
    const available = await json(await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`));
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

resolver.define('searchApprovers', async ({ payload }) => {
  const query = clean(payload?.query, 100);
  if (query.length < 2) return [];
  const result = await json(await api.asUser().requestJira(route`/rest/api/3/user/picker?query=${query}&maxResults=20&showAvatar=true`));
  return (result?.users || []).filter((u) => u.accountId && u.active !== false).map((u) => ({ accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrl }));
});

resolver.define('getIssueApprovals', async ({ payload }) => {
  const issueKey = clean(payload?.issueKey, 100);
  if (!issueKey) return [];
  await getIssueAsUser(issueKey);
  const rows = await queryPrefix(`issue#${issueKey}#`, 200);
  const records = rows.map((r) => r.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Promise.all(records.map(enrichApproval));
});

resolver.define('getApprovalDefaults', async ({ payload }) => {
  const issueKey = clean(payload?.issueKey, 100);
  if (!issueKey) return { defaultApprovalMode: 'all', reminderHours: 24, suggestion: null };
  const issue = await getIssueAsUser(issueKey);
  const projectId = String(issue.fields.project.id);
  const settings = (await kvs.get(configKey(projectId))) || {};
  let suggestion = await kvs.get(suggestionKey(issueKey));

  // A rule may have been created or changed after a ticket was already sitting in
  // its configured trigger status. Re-evaluate the current ticket when the agent
  // opens the panel so matching approvers are prepared without requiring another
  // Jira field/status change. The automation worker still only prepares; it never sends.
  if (!suggestion && Array.isArray(settings.autoRules) && settings.autoRules.length > 0) {
    try {
      await prepareRuleSuggestion({ issue: { key: issueKey, fields: { project: { id: projectId } } } });
      suggestion = await kvs.get(suggestionKey(issueKey));
    } catch (error) {
      console.warn('Smart Approval: unable to refresh rule suggestion on panel load', error?.message || error);
    }
  }

  let enrichedSuggestion = null;
  if (suggestion) {
    enrichedSuggestion = {
      ...suggestion,
      approvers: await Promise.all((suggestion.approvers || []).map(async (a) => ({
        accountId: a.accountId,
        displayName: await resolveDisplayName(a.accountId),
      }))),
    };
  }
  return {
    defaultApprovalMode: settings.defaultApprovalMode === 'any' ? 'any' : 'all',
    reminderHours: Math.min(720, Math.max(1, Number(settings.reminderHours || 24))),
    suggestion: enrichedSuggestion,
  };
});


resolver.define('getApprovalFormStatus', async ({ payload }) => {
  const issueKey = clean(payload?.issueKey, 100);
  if (!issueKey) return { configured: false };
  await getIssueAsUser(issueKey);
  const suggestion = await kvs.get(suggestionKey(issueKey));
  if (!suggestion?.formEnabled || !suggestion?.formId) return { configured: false };
  const forms = await listIssueForms(issueKey);
  const existing = forms.find((form) => clean(form?.formTemplate?.id || form?.id, 300) === clean(suggestion.formId, 300));
  return {
    configured: true,
    ruleName: clean(suggestion.ruleName, 200),
    formId: clean(suggestion.formId, 300),
    attached: Boolean(existing),
    instanceId: clean(existing?.id, 300),
    name: clean(existing?.name || 'Configured JSM Form', 500),
    submitted: existing?.submitted === true || existing?.state?.status === 's',
  };
});

resolver.define('sendApprovalFormToCustomer', async ({ payload }) => {
  const issueKey = clean(payload?.issueKey, 100);
  if (!issueKey) throw new Error('Issue is required.');
  await getIssueAsUser(issueKey);
  const suggestion = await kvs.get(suggestionKey(issueKey));
  if (!suggestion?.formEnabled || !suggestion?.formId) throw new Error('The matched approval rule does not have a JSM Form configured.');
  const forms = await listIssueForms(issueKey);
  const existing = forms.find((form) => clean(form?.formTemplate?.id || form?.id, 300) === clean(suggestion.formId, 300));
  if (existing) return { attached: true, alreadyAttached: true, instanceId: clean(existing.id, 300), name: clean(existing.name || 'JSM Form', 500), submitted: existing?.submitted === true || existing?.state?.status === 's' };
  const attached = await attachExternalFormToIssue(issueKey, suggestion.formId);
  await addPublicComment(issueKey, 'A form is required for this request. Please open this request in the customer portal, complete the attached form and submit it.');
  return { attached: true, alreadyAttached: false, ...attached };
});

resolver.define('createApproval', async ({ payload, context }) => {
  const issueKey = clean(payload?.issueKey, 100);
  const requestedApprovers = Array.isArray(payload?.approvers) ? payload.approvers : payload?.approver ? [payload.approver] : [];
  if (!issueKey || requestedApprovers.length === 0) throw new Error('Issue and at least one approver are required.');

  const issue = await getIssueAsUser(issueKey);
  const settings = (await kvs.get(configKey(String(issue.fields.project.id)))) || {};
  const suggestion = await kvs.get(suggestionKey(issueKey));
  const prepared = suggestion && clean(payload?.preparedRuleId, 200) && clean(payload.preparedRuleId, 200) === clean(suggestion.ruleId, 200) ? suggestion : null;
  const existing = await queryPrefix(`issue#${issueKey}#`, 200);
  const pendingAccountIds = new Set(existing.map((r) => r.value).filter((r) => r?.status === 'pending').map((r) => r.approver?.accountId));

  const canonicalApprovers = [];
  const seen = new Set();
  for (const requested of requestedApprovers.slice(0, 20)) {
    const accountId = clean(requested?.accountId, 200);
    if (!accountId || accountId === 'unknown' || seen.has(accountId)) continue;
    seen.add(accountId);
    if (pendingAccountIds.has(accountId)) continue;
    const canonical = await getCanonicalUser(accountId);
    if (canonical?.accountId && canonical.active !== false) canonicalApprovers.push(canonical);
  }
  if (!canonicalApprovers.length) throw new Error('No new active approvers were selected.');

  const groupId = uid();
  const approvalMode = payload?.approvalMode === 'any' ? 'any' : payload?.approvalMode === 'all' ? 'all' : prepared?.approvalMode === 'any' ? 'any' : settings.defaultApprovalMode === 'any' ? 'any' : 'all';
  const reminderHours = Math.min(720, Math.max(1, Number(payload?.reminderHours || prepared?.reminderHours || settings.reminderHours || 24)));
  const records = [];

  // Capture a small approval-time snapshot of the submitted JSM Form. This
  // ensures the portal approver reviews the same answers the agent sent.
  // Forms remain optional and a Forms API failure must never block legacy approvals.
  let formSnapshot = null;
  try {
    if (prepared?.formEnabled === true) {
      const preview = await getFormPreview(issueKey, prepared?.formId || '');
      if (preview?.submitted && Array.isArray(preview.answers)) {
        const allowedKeys = Array.isArray(prepared?.formFieldKeys) ? new Set(prepared.formFieldKeys.map((x) => clean(x, 300))) : null;
        const answers = preview.answers
          .filter((row) => allowedKeys && allowedKeys.size > 0 && allowedKeys.has(clean(row.fieldKey, 300)))
          .slice(0, 50)
          .map((row) => ({ fieldKey: clean(row.fieldKey, 300), label: clean(row.label, 500), answer: clean(row.answer, 4000) }));
        formSnapshot = { formId: clean(preview.formId, 300), instanceId: clean(preview.instanceId, 300), name: clean(preview.name, 500), capturedAt: nowIso(), answers, auditFieldMap: { approvedByFieldKey: clean(prepared.approvedByFieldKey, 300), approvedAtFieldKey: clean(prepared.approvedAtFieldKey, 300), decisionFieldKey: clean(prepared.decisionFieldKey, 300), decisionCommentFieldKey: clean(prepared.decisionCommentFieldKey, 300) } };
      }
    }
  } catch (error) {
    console.warn('Smart Approval: unable to capture optional JSM Form snapshot', error?.message || error);
  }

  const approvedTarget = clean(prepared?.approveTargetStatus || settings.approveTargetStatus, 200);
  const declinedTarget = clean(prepared?.declineTargetStatus || settings.declineTargetStatus, 200);
  const approvedTransition = clean(prepared?.approveTransitionId || settings.approveTransitionId, 100);
  const declinedTransition = clean(prepared?.declineTransitionId || settings.declineTransitionId, 100);

  for (const canonical of canonicalApprovers) {
    const createdAt = nowIso();
    const record = {
      id: uid(), groupId, approvalMode, groupSize: canonicalApprovers.length,
      issueKey, issueId: issue.id, projectId: String(issue.fields.project.id), projectKey: issue.fields.project.key,
      summary: clean(issue.fields.summary, 500), issueStatus: clean(issue.fields.status?.name, 200),
      approver: { accountId: canonical.accountId },
      requestedBy: { accountId: context.accountId || 'unknown' },
      source: prepared ? 'rule-assisted' : 'manual',
      ruleId: prepared ? clean(prepared.ruleId, 200) : '',
      ruleName: prepared ? clean(prepared.ruleName, 200) : '',
      message: clean(payload?.message, 2000), formSnapshot, status: 'pending', createdAt, updatedAt: createdAt,
      reminderHours, reminderCount: 0, nextReminderAt: new Date(Date.now() + reminderHours * 3600000).toISOString(),
      ruleTargetStatuses: { approved: approvedTarget, declined: declinedTarget },
      ruleTransitionIds: { approved: approvedTransition, declined: declinedTransition },
      events: [{ type: prepared ? 'requested-from-prepared-rule' : 'requested', at: createdAt, by: context.accountId || 'unknown', rule: prepared?.ruleName || '' }],
    };
    if (settings.autoAddParticipant !== false) record.participantAdded = await addParticipant(issueKey, canonical.accountId);
    await saveApproval(record); records.push(record);
  }

  const names = canonicalApprovers.map((u) => clean(u.displayName, 200) || 'Approver').join(', ');
  const modeText = records.length > 1 ? (approvalMode === 'all' ? ' All approvers must approve.' : ' Any one approver can approve.') : '';
  await addPublicComment(issueKey, `Approval requested from ${names}.${modeText} Please open My Approvals in the customer portal to review this request.`);

  const pendingTarget = clean(prepared?.pendingTargetStatus || settings.pendingTargetStatus, 200);
  const pendingTransition = clean(prepared?.pendingTransitionId || settings.pendingTransitionId, 100);
  if (pendingTarget || pendingTransition) {
    try { await transitionIssue(issueKey, pendingTarget, pendingTransition); }
    catch (error) { console.warn('Approval pending transition failed', error?.message || error); }
  }
  if (prepared) await kvs.delete(suggestionKey(issueKey));
  return Promise.all(records.map(enrichApproval));
});

resolver.define('sendReminder', async ({ payload, context }) => {
  const record = await kvs.get(approvalKey(clean(payload?.approvalId, 200)));
  if (!record || record.status !== 'pending') throw new Error('Pending approval not found.');
  await getIssueAsUser(record.issueKey);
  const at = nowIso();
  record.reminderCount = Number(record.reminderCount || 0) + 1; record.updatedAt = at;
  record.nextReminderAt = new Date(Date.now() + Number(record.reminderHours || 24) * 3600000).toISOString();
  record.events = [...(record.events || []), { type: 'reminder', at, by: context.accountId || 'agent' }];
  await saveApproval(record);
  const name = await resolveDisplayName(record.approver.accountId);
  await addPublicComment(record.issueKey, `Reminder: approval is still waiting for ${name}. Please open My Approvals in the customer portal.`);
  return enrichApproval(record);
});

resolver.define('cancelApproval', async ({ payload, context }) => {
  const record = await kvs.get(approvalKey(clean(payload?.approvalId, 200)));
  if (!record || record.status !== 'pending') throw new Error('Pending approval not found.');
  await getIssueAsUser(record.issueKey);
  const at = nowIso(); record.status = 'cancelled'; record.updatedAt = at; record.cancelledAt = at;
  record.events = [...(record.events || []), { type: 'cancelled', at, by: context.accountId || 'agent' }];
  await saveApproval(record);
  const name = await resolveDisplayName(record.approver.accountId);
  await addPublicComment(record.issueKey, `Approval request for ${name} was cancelled.`);
  return enrichApproval(record);
});

export const handler = resolver.getDefinitions();
export { saveApproval, queryPrefix, addPublicComment };
