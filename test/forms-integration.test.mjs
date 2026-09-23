import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const agent = await readFile(new URL('../src/backend/index.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../src/backend/config.js', import.meta.url), 'utf8');
const portal = await readFile(new URL('../src/frontend/portal-approvals.jsx', import.meta.url), 'utf8');
const forms = await readFile(new URL('../src/backend/forms.js', import.meta.url), 'utf8');
const portalBackend = await readFile(new URL('../src/backend/portal.js', import.meta.url), 'utf8');

test('forms are optional and only captured for a form-enabled prepared rule', () => {
  assert.ok(agent.includes("prepared?.formEnabled === true"));
  assert.ok(agent.includes("let formSnapshot = null"));
  assert.ok(agent.includes("formSnapshot, status: 'pending'"));
});

test('form configuration is sanitised before storage', () => {
  assert.ok(config.includes("formEnabled: rule?.formEnabled === true"));
  assert.ok(config.includes("formId: clean(rule?.formId, 300)"));
  assert.ok(config.includes("formFieldKeys:"));
});

test('form answer snapshot can be restricted to configured field keys', () => {
  assert.ok(agent.includes("const allowedKeys = Array.isArray(prepared?.formFieldKeys)"));
  assert.ok(agent.includes("allowedKeys.has(clean(row.fieldKey, 300))"));
});

test('portal renders captured form answers rather than refetching mutable form data', () => {
  assert.ok(portal.includes("a.formSnapshot?.answers?.length"));
  assert.ok(portal.includes("Form details captured when this approval was sent."));
  assert.ok(!portal.includes("getFormPreview"));
});

test('forms client reads issue forms and supports controlled attach/write operations', () => {
  assert.ok(forms.includes("method: 'GET'"));
  assert.ok(forms.includes("/format/answers"));
  assert.ok(forms.includes("method: 'POST'"));
  assert.ok(forms.includes('/action/external'));
  assert.ok(forms.includes("method: 'PUT'"));
});


test('approval decisions can be written back to configured JSM Form audit fields', () => {
  assert.match(forms, /writeApprovalAuditToForm/);
  assert.match(forms, /approvedByFieldKey/);
  assert.match(forms, /approvedAtFieldKey/);
  assert.match(forms, /decisionFieldKey/);
  assert.match(forms, /decisionCommentFieldKey/);
  assert.match(portalBackend, /form-audit-written/);
  assert.match(portalBackend, /writeApprovalAuditToForm/);
});

test('form audit write-back is optional and failures do not undo approval', () => {
  assert.match(forms, /reason: 'not-configured'/);
  assert.match(portalBackend, /form-audit-write-failed/);
});


test('form snapshots expose only explicitly selected answers', () => {
  assert.match(agent, /!allowedKeys \|\| allowedKeys\.size === 0 \|\| allowedKeys\.has/);
});

test('Forms API errors do not include response bodies', () => {
  assert.match(forms, /Forms API request failed with status/);
  assert.doesNotMatch(forms, /throw new Error\(body \|\| \('Forms API error/);
});

test('complex Forms answers are normalized for approval display', () => {
  assert.match(forms, /function normalizeAnswer/);
  assert.match(forms, /Array\.isArray\(value\)/);
});


test('multi-client conditions and form exposure are server-side protected', async () => {
  const automation = await readFile(new URL('../src/backend/automation.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../src/backend/config.js', import.meta.url), 'utf8');
  const agent = await readFile(new URL('../src/backend/index.js', import.meta.url), 'utf8');
  assert.ok(config.includes("'isAnyOf'"));
  assert.ok(config.includes("values: (Array.isArray(c?.values)"));
  assert.ok(automation.includes("if (operator === 'isAnyOf')"));
  assert.ok(automation.includes("expectedMany.some((v) => actual.includes(v))"));
  assert.ok(agent.includes("await prepareRuleSuggestion({ issue: { key: issueKey"));
  assert.ok(agent.includes("This request no longer matches a rule that allows this JSM Form."));
});


test('form submission can automatically create the prepared approval without a second agent action', async () => {
  const worker = await readFile(new URL('../src/backend/form-submission-worker.js', import.meta.url), 'utf8');
  const manifest = await readFile(new URL('../manifest.yml', import.meta.url), 'utf8');
  const settings = await readFile(new URL('../src/frontend/settings.jsx', import.meta.url), 'utf8');
  assert.match(worker, /formwatch#/);
  assert.match(worker, /form\?\.submitted === true/);
  assert.match(worker, /prepareRuleSuggestion/);
  assert.match(worker, /createApprovalHandler/);
  assert.match(worker, /suggestion\.autoSendOnFormSubmit !== true/);
  assert.match(manifest, /interval: fiveMinute/);
  assert.match(settings, /Automatically send approval when the customer submits this form/);
});


test('portal approver sees the complete immutable form snapshot before deciding', async () => {
  const summary = await readFile(new URL('../src/frontend/portal-summary.jsx', import.meta.url), 'utf8');
  assert.match(summary, /Submitted form details/);
  assert.match(summary, /a\.formSnapshot\.answers\.map/);
  assert.match(summary, /These are the submitted values captured when this approval was created/);
  assert.doesNotMatch(summary, /answers\.slice\(0, 8\)/);
});

test('Forms answer reader accepts wrapped live API response shapes', () => {
  assert.match(forms, /payload\?\.answers \|\| payload\?\.values \|\| payload\?\.questions/);
  assert.match(forms, /row\?\.fieldKey \?\? row\?\.key \?\? row\?\.questionId/);
});
