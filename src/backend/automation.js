import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';

const configKey = (projectId) => `config#${projectId}`;
const suggestionKey = (issueKey) => `suggestion#${issueKey}`;
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);

async function json(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(body || `Atlassian API error ${response.status}`);
  return body ? JSON.parse(body) : null;
}

function values(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(values))];
  if (typeof value === 'object') {
    const out = [];
    for (const key of ['value', 'name', 'id', 'key', 'displayName']) {
      const candidate = value?.[key];
      if (candidate == null) continue;
      if (typeof candidate === 'object') out.push(...values(candidate));
      else out.push(String(candidate));
    }
    // Cascading/select fields can hold their displayed value inside parent/child objects.
    if (value?.parent != null) out.push(...values(value.parent));
    if (value?.child != null) out.push(...values(value.child));
    return [...new Set(out)];
  }
  return [String(value)];
}

function conditionMatches(issue, condition) {
  const fieldId = clean(condition?.fieldId, 200);
  if (!fieldId) return false;
  const actual = values(issue.fields?.[fieldId]).map((v) => clean(v, 1000).toLowerCase());
  const expected = clean(condition?.value, 1000).toLowerCase();
  const operator = condition?.operator || 'equals';
  const expectedMany = (Array.isArray(condition?.values) ? condition.values : []).map((v) => clean(v, 1000).toLowerCase()).filter(Boolean);
  if (operator === 'isEmpty') return actual.length === 0 || actual.every((v) => !v);
  if (operator === 'notEmpty') return actual.some(Boolean);
  if (operator === 'notEquals') return !actual.includes(expected);
  if (operator === 'contains') return actual.some((v) => v.includes(expected));
  if (operator === 'isAnyOf') return expectedMany.length > 0 && expectedMany.some((v) => actual.includes(v));
  return actual.includes(expected);
}

function ruleMatches(issue, rule) {
  if (rule?.enabled === false) return false;
  const triggerStatus = clean(rule?.triggerStatus, 200).toLowerCase();
  const currentStatus = clean(issue?.fields?.status?.name, 200).toLowerCase();
  if (triggerStatus && triggerStatus !== currentStatus) return false;
  const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
  return conditions.length > 0 && conditions.every((c) => conditionMatches(issue, c));
}

export async function run(event) {
  const issueKey = event?.issue?.key;
  const projectId = String(event?.issue?.fields?.project?.id || '');
  if (!issueKey || !projectId) return;

  const settings = (await kvs.get(configKey(projectId))) || {};
  const rules = Array.isArray(settings.autoRules) ? settings.autoRules : [];
  if (!rules.length) {
    await kvs.delete(suggestionKey(issueKey));
    return;
  }

  const issue = await json(await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=*all`));
  const rule = rules.find((candidate) => ruleMatches(issue, candidate));
  if (!rule) {
    await kvs.delete(suggestionKey(issueKey));
    return;
  }

  // Rule configuration already stores stable Atlassian account IDs. Do not require an
  // additional Jira user lookup just to prepare the agent form: portal-only JSM customers
  // can be valid approvers even when the Jira user endpoint cannot resolve them here.
  const approvers = [];
  const seen = new Set();
  for (const configured of (Array.isArray(rule.approvers) ? rule.approvers : []).slice(0, 20)) {
    const accountId = clean(configured?.accountId, 200);
    if (!accountId || accountId === 'unknown' || seen.has(accountId)) continue;
    seen.add(accountId);
    approvers.push({ accountId });
  }

  if (!approvers.length) {
    await kvs.delete(suggestionKey(issueKey));
    return;
  }

  // Matching rules only prepare the agent form. An agent must explicitly send the approval.
  // Store only stable Atlassian account IDs; display names are resolved at read time.
  await kvs.set(suggestionKey(issueKey), {
    issueKey,
    projectId,
    ruleId: clean(rule.id || rule.name, 200),
    ruleName: clean(rule.name, 200),
    triggerStatus: clean(rule.triggerStatus, 200),
    approvers,
    approvalMode: rule.approvalMode === 'any' ? 'any' : 'all',
    message: clean(rule.message || '', 2000),
    formEnabled: rule.formEnabled === true,
    autoSendOnFormSubmit: rule.autoSendOnFormSubmit === true,
    formId: clean(rule.formId, 300),
    formFieldKeys: (Array.isArray(rule.formFieldKeys) ? rule.formFieldKeys : []).slice(0, 50).map((x) => clean(x, 300)).filter(Boolean),
    approvedByFieldKey: clean(rule.approvedByFieldKey, 300),
    approvedAtFieldKey: clean(rule.approvedAtFieldKey, 300),
    decisionFieldKey: clean(rule.decisionFieldKey, 300),
    decisionCommentFieldKey: clean(rule.decisionCommentFieldKey, 300),
    reminderHours: Math.min(720, Math.max(1, Number(rule.reminderHours || settings.reminderHours || 24))),
    pendingTargetStatus: clean(rule.pendingTargetStatus || settings.pendingTargetStatus, 200),
    approveTargetStatus: clean(rule.approveTargetStatus || settings.approveTargetStatus, 200),
    declineTargetStatus: clean(rule.declineTargetStatus || settings.declineTargetStatus, 200),
    pendingTransitionId: clean(rule.pendingTransitionId || settings.pendingTransitionId, 100),
    approveTransitionId: clean(rule.approveTransitionId || settings.approveTransitionId, 100),
    declineTransitionId: clean(rule.declineTransitionId || settings.declineTransitionId, 100),
    preparedAt: new Date().toISOString(),
  });
}
