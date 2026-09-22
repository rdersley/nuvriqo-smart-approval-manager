import api, { route } from '@forge/api';

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

async function readJson(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(body || ('Forms API error ' + response.status));
  return body ? JSON.parse(body) : null;
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
    answer: clean(row?.answer ?? row?.choice, 4000),
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
