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
  if (Array.isArray(value)) return value.flatMap(values);
  if (typeof value === 'object') return [value.value, value.name, value.id, value.key, value.displayName].filter((v) => v != null).map(String);
  return [String(value)];
}

function conditionMatches(issue, condition) {
  const fieldId = clean(condition?.fieldId, 200);
  if (!fieldId) return false;
  const actual = values(issue.fields?.[fieldId]).map((v) => v.toLowerCase());
  const expected = clean(condition?.value, 1000).toLowerCase();
  const operator = condition?.operator || 'equals';
  if (operator === 'isEmpty') return actual.length === 0 || actual.every((v) => !v);
  if (operator === 'notEmpty') return actual.some(Boolean);
  if (operator === 'notEquals') return !actual.includes(expected);
  if (operator === 'contains') return actual.some((v) => v.includes(expected));
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

  const approvers = [];
  const seen = new Set();
  for (const configured of (Array.isArray(rule.approvers) ? rule.approvers : []).slice(0, 20)) {
    const accountId = clean(configured?.accountId, 200);
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);
    try {
      const canonical = await json(await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`));
      if (canonical?.accountId && canonical.active !== false) {
        approvers.push({ accountId: canonical.accountId, displayName: clean(canonical.displayName, 200) });
      }
    } catch (error) {
      console.warn('Smart Approval: unable to resolve suggested approver', error?.message || error);
    }
  }

  if (!approvers.length) {
    await kvs.delete(suggestionKey(issueKey));
    return;
  }

  // Matching rules only prepare the agent form. An agent must explicitly send the approval.
  await kvs.set(suggestionKey(issueKey), {
    issueKey,
    projectId,
    ruleId: clean(rule.id || rule.name, 200),
    ruleName: clean(rule.name, 200),
    triggerStatus: clean(rule.triggerStatus, 200),
    approvers,
    approvalMode: rule.approvalMode === 'any' ? 'any' : 'all',
    message: clean(rule.message || '', 2000),
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
