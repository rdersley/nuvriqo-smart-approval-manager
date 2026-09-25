const { test, expect } = require('@playwright/test');

test('Smart Approval agent panel loads on deployed Jira issue', async ({ page }) => {
  const base = process.env.JIRA_BASE_URL;
  const issue = process.env.JIRA_TEST_ISSUE_KEY;
  expect(base).toBeTruthy();
  expect(issue).toBeTruthy();

  await page.goto(`${base}/browse/${issue}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(issue));
  await expect(page.locator('body')).not.toContainText(/Something went wrong|Failed to load/i);

  await expect(page.getByText('Smart Approval Manager', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Prepare, send and track customer approvals directly from this Jira request/i).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Send approval request' }).first()).toBeVisible({ timeout: 30000 });
});
