import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const agent = await readFile(new URL('../src/backend/index.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../src/backend/config.js', import.meta.url), 'utf8');
const portal = await readFile(new URL('../src/frontend/portal-approvals.jsx', import.meta.url), 'utf8');
const forms = await readFile(new URL('../src/backend/forms.js', import.meta.url), 'utf8');

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

test('forms client reads issue forms and simplified answers read-only', () => {
  assert.ok(forms.includes("method: 'GET'"));
  assert.ok(forms.includes("/format/answers"));
  assert.ok(!forms.includes("method: 'POST'"));
  assert.ok(!forms.includes("method: 'PUT'"));
});


test('approval decisions can be written back to configured JSM Form audit fields', () => {
  assert.match(formsSource, /writeApprovalAuditToForm/);
  assert.match(formsSource, /approvedByFieldKey/);
  assert.match(formsSource, /approvedAtFieldKey/);
  assert.match(formsSource, /decisionFieldKey/);
  assert.match(formsSource, /decisionCommentFieldKey/);
  assert.match(portalSource, /form-audit-written/);
  assert.match(portalSource, /writeApprovalAuditToForm/);
});

test('form audit write-back is optional and failures do not undo approval', () => {
  assert.match(formsSource, /reason: 'not-configured'/);
  assert.match(portalSource, /form-audit-write-failed/);
});
