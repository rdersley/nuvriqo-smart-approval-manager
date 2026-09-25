// Real-UI screenshot journey on the Nuvriqo test site: agent requests an
// approval from the Smart Approval panel, the approver decides in the JSM
// portal, and the agent sees the result. Every step is saved to screenshots/.
//
// Creates one fresh ticket per run (labelled smart-approval-screenshots); it
// never deploys the app and refuses to run against any other site.
const { test, expect, request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ALLOWED_HOST = 'nuvriqo.atlassian.net';
const BASE = (process.env.JIRA_BASE_URL || `https://${ALLOWED_HOST}`).replace(/\/$/, '');
const PROJECT = process.env.JIRA_TEST_PROJECT_KEY || 'TEST';
const APPROVER_EMAIL = process.env.APPROVER_EMAIL || process.env.JIRA_EMAIL;
const CUSTOMER_STATE = process.env.CUSTOMER_STORAGE_STATE || '';
const OUT = path.join(process.cwd(), 'screenshots');

test.describe.configure({ retries: 0 }); // a retry would create a second ticket

let shotNumber = 0;
async function shot(page, name) {
  shotNumber += 1;
  const file = path.join(OUT, `${String(shotNumber).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

const appears = (locator, timeout) => locator.waitFor({ state: 'visible', timeout }).then(() => true, () => false);

async function jiraApi() {
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  return request.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
}

async function createTicket(api) {
  const types = await api.get(`/rest/api/3/issue/createmeta/${PROJECT}/issuetypes`);
  expect(types.ok(), await types.text()).toBeTruthy();
  const meta = await types.json();
  const type = (meta.issueTypes || meta.values || []).find((t) => !t.subtask);
  expect(type, `No non-subtask issue type in ${PROJECT}`).toBeTruthy();
  const created = await api.post('/rest/api/3/issue', {
    data: { fields: {
      project: { key: PROJECT }, issuetype: { id: type.id },
      summary: `Smart Approval screenshot run ${new Date().toISOString()}`,
      labels: ['smart-approval-screenshots'],
    } },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return (await created.json()).key;
}

async function portalUrl(api, key) {
  const response = await api.get(`/rest/servicedeskapi/request/${key}`);
  expect(response.ok(), `${key} is not a JSM request: ${await response.text()}`).toBeTruthy();
  return (await response.json())._links.web;
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
  expect(process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN, 'JIRA_EMAIL and JIRA_API_TOKEN are required').toBeTruthy();
  expect(APPROVER_EMAIL, 'APPROVER_EMAIL is required').toBeTruthy();
  fs.mkdirSync(OUT, { recursive: true });

  const api = await jiraApi();
  const key = await createTicket(api);
  const portalLink = await portalUrl(api, key);
  test.info().annotations.push({ type: 'ticket', description: `${BASE}/browse/${key}` });

  await test.step('agent opens the Smart Approval panel', async () => {
    await page.goto(`${BASE}/browse/${key}`, { waitUntil: 'domcontentloaded' });
    await openPanel(page);
    await expect(page.getByText(/Prepare, send and track customer approvals/)).toBeVisible();
    await shot(page, 'agent-panel-new-ticket');
  });

  await test.step('agent selects the approver and sends the request', async () => {
    await page.getByPlaceholder('Search by name or email').fill(APPROVER_EMAIL);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText(/approvers? selected\./)).toBeVisible({ timeout: 30000 });
    await page.getByPlaceholder('Explain what the customer is being asked to approve')
      .fill('Screenshot run: please approve this test request.');
    await shot(page, 'agent-approver-selected');
    await page.getByRole('button', { name: 'Send approval request' }).click();
    await expect(page.getByText('Waiting', { exact: true }).first()).toBeVisible({ timeout: 60000 });
    await shot(page, 'agent-approval-sent');
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
    await shot(page, 'agent-approval-complete');
  });

  await approverContext?.close();
  await api.dispose();
});
