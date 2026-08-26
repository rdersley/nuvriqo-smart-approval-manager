import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { resolveDisplayName } from './users.js';

const resolver = new Resolver();
const configKey = (projectId) => `config#${projectId}`;
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);

async function json(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(body || `Atlassian API error ${response.status}`);
  return body ? JSON.parse(body) : null;
}

async function safeJson(promise, fallback) {
  try { return await json(await promise); }
  catch (error) { console.warn('Smart Approval metadata lookup failed', error?.message || error); return fallback; }
}

function listFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.values)) return value.values;
  return [];
}

async function assertProjectAdmin(projectId) {
  const permissions = await json(await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`
  ));
  if (!permissions?.permissions?.ADMINISTER_PROJECTS?.havePermission) throw new Error('Project administrator permission is required.');
}

function cleanRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.slice(0, 25).map((rule, index) => ({
    id: clean(rule?.id || `rule-${index + 1}`, 100),
    name: clean(rule?.name || `Rule ${index + 1}`, 200),
    enabled: rule?.enabled !== false,
    triggerStatus: clean(rule?.triggerStatus, 200),
    approvalMode: rule?.approvalMode === 'any' ? 'any' : 'all',
    conditions: (Array.isArray(rule?.conditions) ? rule.conditions : []).slice(0, 10).map((c) => ({
      fieldId: clean(c?.fieldId, 200),
      operator: ['equals', 'notEquals', 'contains', 'isEmpty', 'notEmpty'].includes(c?.operator) ? c.operator : 'equals',
      value: clean(c?.value, 1000),
    })).filter((c) => c.fieldId),
    // Persist only stable Atlassian account IDs; resolve display names when settings are read.
    approvers: (Array.isArray(rule?.approvers) ? rule.approvers : []).slice(0, 20).map((a) => ({
      accountId: clean(a?.accountId, 200),
    })).filter((a) => a.accountId && a.accountId !== 'unknown'),
    message: clean(rule?.message, 2000),
    reminderHours: Math.min(720, Math.max(1, Number(rule?.reminderHours || 24))),
    pendingTargetStatus: clean(rule?.pendingTargetStatus, 200),
    approveTargetStatus: clean(rule?.approveTargetStatus, 200),
    declineTargetStatus: clean(rule?.declineTargetStatus, 200),
    pendingTransitionId: clean(rule?.pendingTransitionId, 100),
    approveTransitionId: clean(rule?.approveTransitionId, 100),
    declineTransitionId: clean(rule?.declineTransitionId, 100),
  }));
}

async function enrichRules(rules) {
  return Promise.all((Array.isArray(rules) ? rules : []).map(async (rule) => ({
    ...rule,
    approvers: await Promise.all((rule.approvers || []).map(async (a) => ({
      accountId: a.accountId,
      displayName: await resolveDisplayName(a.accountId),
    }))),
  })));
}

async function enrichSettings(settings) {
  return { ...settings, autoRules: await enrichRules(settings.autoRules) };
}

const defaults = {
  reminderHours: 24,
  autoAddParticipant: true,
  requireDeclineReason: true,
  defaultApprovalMode: 'all',
  pendingTargetStatus: '',
  approveTargetStatus: '',
  declineTargetStatus: '',
  pendingTransitionId: '',
  approveTransitionId: '',
  declineTransitionId: '',
  autoRules: [],
};

resolver.define('getSettings', async ({ payload }) => {
  const projectId = clean(payload?.projectId, 100);
  if (!projectId) throw new Error('Project context is required.');
  await assertProjectAdmin(projectId);
  const stored = { ...defaults, ...((await kvs.get(configKey(projectId))) || {}) };
  return enrichSettings(stored);
});

resolver.define('getRuleBuilderMetadata', async ({ payload }) => {
  const projectId = clean(payload?.projectId, 100);
  if (!projectId) throw new Error('Project context is required.');
  await assertProjectAdmin(projectId);

  const [fieldsRaw, projectStatusesRaw, issueTypesRaw, prioritiesRaw] = await Promise.all([
    safeJson(api.asUser().requestJira(route`/rest/api/3/field`), []),
    safeJson(api.asUser().requestJira(route`/rest/api/3/project/${projectId}/statuses`), []),
    safeJson(api.asUser().requestJira(route`/rest/api/3/issuetype/project?projectId=${projectId}&maxResults=100`), { values: [] }),
    safeJson(api.asUser().requestJira(route`/rest/api/3/priority/search?maxResults=100`), { values: [] }),
  ]);

  const fields = listFrom(fieldsRaw);
  const projectStatuses = listFrom(projectStatusesRaw);
  const issueTypes = listFrom(issueTypesRaw);
  const priorities = listFrom(prioritiesRaw);

  const statusMap = new Map();
  for (const issueType of projectStatuses) {
    for (const status of listFrom(issueType?.statuses)) {
      if (status?.name) statusMap.set(status.name, { label: status.name, value: status.name });
    }
  }

  return {
    fields: fields.filter((f) => f?.id && f?.name).map((f) => ({ id: f.id, name: f.name, schema: f.schema || null })).sort((a, b) => a.name.localeCompare(b.name)),
    statuses: [...statusMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    commonOptions: {
      issuetype: issueTypes.filter((x) => x?.name).map((x) => ({ label: x.name, value: x.name })),
      priority: priorities.filter((x) => x?.name).map((x) => ({ label: x.name, value: x.name })),
      status: [...statusMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    },
  };
});

resolver.define('getRuleFieldOptions', async ({ payload }) => {
  const projectId = clean(payload?.projectId, 100);
  const fieldId = clean(payload?.fieldId, 200);
  if (!projectId || !fieldId) return [];
  await assertProjectAdmin(projectId);

  if (!fieldId.startsWith('customfield_')) return [];
  const contextsRaw = await safeJson(api.asUser().requestJira(route`/rest/api/3/field/${fieldId}/context?projectId=${projectId}&maxResults=50`), { values: [] });
  const options = [];
  for (const context of listFrom(contextsRaw).slice(0, 10)) {
    if (!context?.id) continue;
    const pageRaw = await safeJson(api.asUser().requestJira(route`/rest/api/3/field/${fieldId}/context/${context.id}/option?maxResults=100`), { values: [] });
    for (const option of listFrom(pageRaw)) {
      if (option?.value) options.push({ label: option.value, value: option.value });
    }
  }
  const unique = new Map(options.map((o) => [o.value, o]));
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
});

resolver.define('searchRuleApprovers', async ({ payload }) => {
  const projectId = clean(payload?.projectId, 100);
  const query = clean(payload?.query, 100);
  if (!projectId) throw new Error('Project context is required.');
  await assertProjectAdmin(projectId);
  if (query.length < 2) return [];
  const result = await json(await api.asUser().requestJira(route`/rest/api/3/user/picker?query=${query}&maxResults=20&showAvatar=true`));
  return (result?.users || []).filter((u) => u.accountId && u.active !== false).map((u) => ({
    accountId: u.accountId,
    displayName: clean(u.displayName, 200),
  }));
});

resolver.define('saveSettings', async ({ payload }) => {
  const projectId = clean(payload?.projectId, 100);
  if (!projectId) throw new Error('Project context is required.');
  await assertProjectAdmin(projectId);
  const incoming = payload?.settings || {};
  const settings = {
    reminderHours: Math.min(720, Math.max(1, Number(incoming.reminderHours || 24))),
    autoAddParticipant: incoming.autoAddParticipant !== false,
    requireDeclineReason: incoming.requireDeclineReason !== false,
    defaultApprovalMode: incoming.defaultApprovalMode === 'any' ? 'any' : 'all',
    pendingTargetStatus: clean(incoming.pendingTargetStatus, 200),
    approveTargetStatus: clean(incoming.approveTargetStatus, 200),
    declineTargetStatus: clean(incoming.declineTargetStatus, 200),
    pendingTransitionId: clean(incoming.pendingTransitionId, 100),
    approveTransitionId: clean(incoming.approveTransitionId, 100),
    declineTransitionId: clean(incoming.declineTransitionId, 100),
    autoRules: cleanRules(incoming.autoRules),
  };
  await kvs.set(configKey(projectId), settings);
  return enrichSettings(settings);
});

export const handler = resolver.getDefinitions();
