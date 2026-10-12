// Real-UI screenshot journey on the Nuvriqo test site: agent requests an
// approval from the Smart Approval panel, the approver decides in the JSM
// portal, and the agent sees the result. Every step is saved to screenshots/.
//
// Creates one fresh ticket per run (labelled smart-approval-screenshots); it
// never deploys the app and refuses to run against any other site.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ALLOWED_HOST = 'nuvriqo.atlassian.net';
const BASE = (process.env.JIRA_BASE_URL || `https://${ALLOWED_HOST}`).replace(/\/$/, '');
const PROJECT = process.env.JIRA_TEST_PROJECT_KEY || 'TEST';
const CUSTOMER_STATE = process.env.CUSTOMER_STORAGE_STATE || '';
const OUT = path.join(process.cwd(), 'screenshots');

test.describe.configure({ retries: 0 }); // a retry would create a second ticket

let shotNumber = 0;
// Jira's issue view scrolls inside its own container, so a full-page capture
// misses the panel; scroll the step's key element into view first.
async function shot(page, name, focus) {
  if (focus) await focus.scrollIntoViewIfNeeded().catch(() => {});
  shotNumber += 1;
  const file = path.join(OUT, `${String(shotNumber).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

const appears = (locator, timeout) => locator.waitFor({ state: 'visible', timeout }).then(() => true, () => false);

// Jira REST calls run as same-origin fetches inside a Jira page, exactly like
// Jira's own UI, so they reuse the signed-in session (no API token) and pass
// Jira's XSRF protection, which rejects cookie-authenticated calls from outside
// the browser.
function jiraApi(page) {
  const call = (method, url, data) => page.evaluate(async ({ method, url, data }) => {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: res.status, body: await res.text() };
  }, { method, url, data }).then((r) => ({
    ok: () => r.status >= 200 && r.status < 300,
    status: () => r.status,
    text: async () => r.body,
    json: async () => JSON.parse(r.body),
  }));
  return {
    get: (url) => call('GET', url),
    post: (url, options) => call('POST', url, options?.data),
    put: (url, options) => call('PUT', url, options?.data),
  };
}

// The approver defaults to the signed-in test account itself.
async function approverQuery(api) {
  if (process.env.APPROVER_EMAIL) return { query: process.env.APPROVER_EMAIL, name: '' };
  const me = await api.get('/rest/api/3/myself');
  expect(me.ok(), `Jira session is not signed in (re-create JIRA_STORAGE_STATE_GZIP_B64): ${me.status()}`).toBeTruthy();
  const user = await me.json();
  return { query: user.emailAddress || user.displayName, name: user.displayName };
}

const json = async (response, what) => {
  expect(response.ok(), `${what}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
};

// Raises a real portal request (the plain issue API creates tickets with no
// request type, which customers cannot open in the portal). Uses the first
// request type whose required fields are only summary/description.
async function createTicket(api) {
  const desks = (await json(await api.get('/rest/servicedeskapi/servicedesk?limit=100'), 'List service desks')).values || [];
  const desk = desks.find((d) => d.projectKey === PROJECT);
  expect(desk, `${PROJECT} is not a service desk project`).toBeTruthy();
  const types = (await json(await api.get(`/rest/servicedeskapi/servicedesk/${desk.id}/requesttype?limit=100`), 'List request types')).values || [];
  let chosen;
  for (const type of types) {
    const fields = (await json(await api.get(`/rest/servicedeskapi/servicedesk/${desk.id}/requesttype/${type.id}/field`), 'Request type fields')).requestTypeFields || [];
    if (fields.filter((x) => x.required).every((x) => ['summary', 'description'].includes(x.fieldId))) { chosen = type; break; }
  }
  expect(chosen, `No request type in ${PROJECT} needs only summary/description`).toBeTruthy();
  const created = await json(await api.post('/rest/servicedeskapi/request', {
    data: {
      serviceDeskId: desk.id, requestTypeId: chosen.id,
      requestFieldValues: {
        summary: `Smart Approval screenshot run ${new Date().toISOString()}`,
        description: 'Created by the UI screenshot workflow (qa/ui-screenshot-journey).',
      },
    },
  }), 'Create request');
  await api.put(`/rest/api/3/issue/${created.issueKey}`, { data: { update: { labels: [{ add: 'smart-approval-screenshots' }] } } });
  return { key: created.issueKey, portalLink: created._links.web };
}

// A new ticket shows an app's issue panel only after it is added from the
// issue's app/quick-add controls.
async function openPanel(page) {
  const heading = page.getByText('Smart Approval Manager', { exact: true }).first();
  if (await appears(heading, 15000)) return heading;
  const quickAdd = page.getByRole('button', { name: /^Smart Approval$/ }).first();
  if (await appears(quickAdd, 10000)) {
    await quickAdd.click();
  } else {
    await page.getByRole('button', { name: /^Apps$/ }).first().click();
    await page.getByRole('menuitem', { name: /Smart Approval/ }).first().click();
  }
  await expect(heading).toBeVisible({ timeout: 45000 });
  return heading;
}

test('agent → portal approver → agent approval journey', async ({ page, browser }) => {
  test.setTimeout(8 * 60 * 1000);
  expect(new URL(BASE).host, 'Screenshot journey only runs on the Nuvriqo test site').toBe(ALLOWED_HOST);
  fs.mkdirSync(OUT, { recursive: true });

  await page.goto(`${BASE}/jira/your-work`, { waitUntil: 'domcontentloaded' });
  const api = jiraApi(page);
  const approver = await approverQuery(api);
  const { key, portalLink } = await createTicket(api);
  test.info().annotations.push({ type: 'ticket', description: `${BASE}/browse/${key}` });

  await test.step('agent opens the Smart Approval panel', async () => {
    await page.goto(`${BASE}/browse/${key}`, { waitUntil: 'domcontentloaded' });
    await openPanel(page);
    // The panel renders before its data loads; wait for the activity list so a
    // rule's prepared approvers cannot replace the selection made below.
    await expect(page.getByText('No approvals have been sent for this ticket yet.')).toBeVisible({ timeout: 60000 });
    await shot(page, 'agent-panel-new-ticket', page.getByText('1. Choose who should approve'));
  });

  await test.step('agent selects the approver and sends the request', async () => {
    // Remove approvers a matching rule prepared: the portal steps run as the
    // signed-in account, so it must be the only approver.
    const selectedCount = page.getByText(/approvers? selected\./);
    const approverSelect = page.getByRole('combobox', { name: /Selected approvers/ })
      .or(page.getByLabel('Selected approvers')).first();
    for (let i = 0; i < 20 && await selectedCount.isVisible(); i += 1) {
      await approverSelect.click();
      await approverSelect.press('Backspace');
    }
    await page.keyboard.press('Escape');
    await expect(selectedCount).toHaveCount(0);

    await page.getByPlaceholder('Search by name or email').fill(approver.query);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(selectedCount).toBeVisible({ timeout: 30000 });
    if (approver.name) await expect(page.getByText(approver.name, { exact: true }).first()).toBeVisible();
    await page.getByPlaceholder('Explain what the customer is being asked to approve')
      .fill('Screenshot run: please approve this test request.');
    await shot(page, 'agent-approver-selected', page.getByText('2. Add the approval message'));
    await page.getByRole('button', { name: 'Send approval request' }).click();
    await expect(page.getByText('Waiting', { exact: true }).first()).toBeVisible({ timeout: 60000 });
    await shot(page, 'agent-approval-sent', page.getByText('Approval activity'));
  });

  const approverContext = CUSTOMER_STATE ? await browser.newContext({ storageState: CUSTOMER_STATE }) : null;
  const portal = approverContext ? await approverContext.newPage() : page;

  await test.step('approver sees the request in the portal', async () => {
    await portal.goto(portalLink, { waitUntil: 'domcontentloaded' });
    await expect(portal.getByText('Approvals needing your attention')).toBeVisible({ timeout: 60000 });
    await shot(portal, 'portal-approvals-waiting');
  });

  const card = portal.locator('div')
    .filter({ has: portal.getByText(key, { exact: true }) })
    .filter({ has: portal.getByRole('button', { name: 'Approve', exact: true }) })
    .last();

  await test.step('approver previews the details', async () => {
    await card.getByRole('button', { name: 'Preview details' }).click();
    await expect(card.getByText('Approval requirement:')).toBeVisible();
    await card.getByPlaceholder('Optional comment / reason for declining').fill('Approved in screenshot run.');
    await shot(portal, 'portal-approval-preview');
  });

  await test.step('approver opens My Approvals (profile menu)', async () => {
    // Best-effort: the portal profile menu markup is Atlassian's, so a miss here
    // is recorded rather than failing the journey.
    const profile = portal.getByRole('button', { name: /profile|account|your profile/i }).first();
    if (await appears(profile, 10000)) {
      await profile.click();
      const item = portal.getByRole('menuitem', { name: 'My Approvals' }).or(portal.getByText('My Approvals', { exact: true })).first();
      if (await appears(item, 10000)) {
        await item.click();
        if (await appears(portal.getByText('Needs your attention'), 30000)) await shot(portal, 'portal-my-approvals');
        await portal.keyboard.press('Escape');
        return;
      }
    }
    test.info().annotations.push({ type: 'note', description: 'My Approvals menu not found; screenshot skipped' });
  });

  await test.step('approver approves', async () => {
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 60000 });
    await shot(portal, 'portal-after-approval');
  });

  await test.step('agent sees the approved result', async () => {
    await page.goto(`${BASE}/browse/${key}`, { waitUntil: 'domcontentloaded' });
    await openPanel(page);
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible({ timeout: 60000 });
    await shot(page, 'agent-approval-complete', page.getByText('Approval activity'));
  });

  await approverContext?.close();
});
