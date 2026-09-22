import api from '@forge/api';

const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

async function readJson(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(body || ('Forms API error ' + response.status));
  return body ? JSON.parse(body) : null;
}

function formsUrl(cloudId, path) {
  return 'https://api.atlassian.com/jira/forms/cloud/' + encodeURIComponent(clean(cloudId, 200)) + '/' + path;
}

async function requestForms(cloudId, path) {
  return readJson(await api.asApp().fetch(formsUrl(cloudId, path), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }));
}

export async function listIssueForms(cloudId, issueKey) {
  if (!cloudId || !issueKey) return [];
  const forms = await requestForms(cloudId, 'issue/' + encodeURIComponent(issueKey) + '/form');
  return Array.isArray(forms) ? forms : (forms?.values || forms?.forms || []);
}

export async function getSimplifiedFormAnswers(cloudId, issueKey, formId) {
  if (!cloudId || !issueKey || !formId) return [];
  const rows = await requestForms(cloudId, 'issue/' + encodeURIComponent(issueKey) + '/form/' + encodeURIComponent(formId) + '/format/answers');
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    fieldKey: clean(row?.fieldKey, 300),
    label: clean(row?.label, 500),
    answer: clean(row?.answer ?? row?.choice, 4000),
  })).filter((row) => row.label || row.fieldKey);
}

export async function getFormPreview(cloudId, issueKey, preferredFormId = '') {
  const forms = await listIssueForms(cloudId, issueKey);
  if (!forms.length) return null;
  const preferred = clean(preferredFormId, 300);
  const selected = (preferred && forms.find((f) => clean(f?.id, 300) === preferred)) || forms[0];
  const formId = clean(selected?.id, 300);
  if (!formId) return null;
  const answers = await getSimplifiedFormAnswers(cloudId, issueKey, formId);
  return {
    formId,
    name: clean(selected?.name || selected?.design?.settings?.name || 'JSM Form', 500),
    submitted: selected?.submitted === true || selected?.state?.status === 's',
    updated: clean(selected?.updated, 100),
    answers,
  };
}
