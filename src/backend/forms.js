import api, { route } from '@forge/api';

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

async function readJson(response) {
  const body = await response.text();
  if (!response.ok) throw new Error('Forms API request failed with status ' + response.status);
  return body ? JSON.parse(body) : null;
}

function normalizeAnswer(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(normalizeAnswer).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const preferred = value.text ?? value.label ?? value.name ?? value.value ?? value.choice;
    if (preferred != null && preferred !== value) return normalizeAnswer(preferred);
    return Object.values(value).map(normalizeAnswer).filter(Boolean).join(', ');
  }
  return String(value);
}

async function requestForms(path) {
  return readJson(await api.asApp().requestJira(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }));
}

export async function listProjectForms(projectIdOrKey) {
  if (!projectIdOrKey) return [];
  const forms = await requestForms(route`/forms/project/${projectIdOrKey}/form`);
  return Array.isArray(forms) ? forms : [];
}

export async function getProjectForm(projectIdOrKey, formId) {
  if (!projectIdOrKey || !formId) return null;
  return requestForms(route`/forms/project/${projectIdOrKey}/form/${formId}`);
}

export async function listIssueForms(issueKey) {
  if (!issueKey) return [];
  const forms = await requestForms(route`/forms/issue/${issueKey}/form`);
  return Array.isArray(forms) ? forms : (forms?.values || forms?.forms || []);
}

export async function getSimplifiedFormAnswers(issueKey, formId) {
  if (!issueKey || !formId) return [];
  const rows = await requestForms(route`/forms/issue/${issueKey}/form/${formId}/format/answers`);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    fieldKey: clean(row?.fieldKey, 300),
    label: clean(row?.label, 500),
    answer: clean(normalizeAnswer(row?.answer ?? row?.choice), 4000),
  })).filter((row) => row.label || row.fieldKey);
}

export async function getFormPreview(issueKey, preferredFormId = '') {
  const forms = await listIssueForms(issueKey);
  if (!forms.length) return null;
  const preferred = clean(preferredFormId, 300);
  const selected = (preferred && forms.find((f) => clean(f?.formTemplate?.id || f?.id, 300) === preferred)) || forms[0];
  const instanceId = clean(selected?.id, 300);
  if (!instanceId) return null;
  const answers = await getSimplifiedFormAnswers(issueKey, instanceId);
  return {
    formId: clean(selected?.formTemplate?.id || selected?.id, 300),
    instanceId,
    name: clean(selected?.name || 'JSM Form', 500),
    submitted: selected?.submitted === true || selected?.state?.status === 's',
    updated: clean(selected?.updated, 100),
    answers,
  };
}

export function projectFormFields(template) {
  const questions = template?.design?.questions || {};
  return Object.entries(questions).map(([key, question]) => ({
    key: clean(key, 300),
    label: clean(question?.label || question?.question || question?.name || key, 500),
  })).filter((row) => row.key && row.label);
}


export async function attachProjectFormToIssue(issueKey, formTemplateId) {
  if (!issueKey || !formTemplateId) throw new Error('Issue and form template are required.');
  const response = await api.asApp().requestJira(route`/forms/issue/${issueKey}/form`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ formTemplate: { id: clean(formTemplateId, 300) } }),
  });
  return readJson(response);
}

export async function makeIssueFormExternal(issueKey, formInstanceId) {
  if (!issueKey || !formInstanceId) throw new Error('Issue and form instance are required.');
  const response = await api.asApp().requestJira(route`/forms/issue/${issueKey}/form/${formInstanceId}/action/external`, {
    method: 'PUT',
    headers: { Accept: 'application/json' },
  });
  return readJson(response);
}

export async function attachExternalFormToIssue(issueKey, formTemplateId) {
  const attached = await attachProjectFormToIssue(issueKey, formTemplateId);
  const instanceId = clean(attached?.id, 300);
  if (!instanceId) throw new Error('JSM Forms did not return a form instance.');
  await makeIssueFormExternal(issueKey, instanceId);
  return {
    formId: clean(attached?.formTemplate?.id || formTemplateId, 300),
    instanceId,
    name: clean(attached?.name || 'JSM Form', 500),
    submitted: attached?.submitted === true,
  };
}

export async function getIssueForm(issueKey, formInstanceId) {
  if (!issueKey || !formInstanceId) return null;
  return requestForms(route`/forms/issue/${issueKey}/form/${formInstanceId}`);
}

export async function saveIssueFormAnswers(issueKey, formInstanceId, answers) {
  if (!issueKey || !formInstanceId || !answers || typeof answers !== 'object') return null;
  const response = await api.asApp().requestJira(route`/forms/issue/${issueKey}/form/${formInstanceId}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  return readJson(response);
}

export async function writeApprovalAuditToForm(issueKey, formInstanceId, fieldMap, audit) {
  const approvedByKey = clean(fieldMap?.approvedByFieldKey, 300);
  const approvedAtKey = clean(fieldMap?.approvedAtFieldKey, 300);
  const decisionKey = clean(fieldMap?.decisionFieldKey, 300);
  const commentKey = clean(fieldMap?.decisionCommentFieldKey, 300);
  const configured = [approvedByKey, approvedAtKey, decisionKey, commentKey].filter(Boolean);
  if (!configured.length) return { written: false, reason: 'not-configured' };

  const form = await getIssueForm(issueKey, formInstanceId);
  const current = form?.state?.answers && typeof form.state.answers === 'object' ? form.state.answers : {};
  const answers = { ...current };
  if (approvedByKey) answers[approvedByKey] = { text: clean(audit?.approverName, 500) };
  if (approvedAtKey) answers[approvedAtKey] = { text: clean(audit?.decidedAt, 100) };
  if (decisionKey) answers[decisionKey] = { text: clean(audit?.decision, 100) };
  if (commentKey) answers[commentKey] = { text: clean(audit?.comment, 2000) };
  await saveIssueFormAnswers(issueKey, formInstanceId, answers);
  return { written: true };
}
