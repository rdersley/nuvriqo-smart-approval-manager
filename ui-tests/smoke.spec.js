const { test, expect } = require('@playwright/test');

test('Smart Approval agent panel loads on deployed Jira issue', async ({ page }) => {
  const base = process.env.JIRA_BASE_URL;
  const issue = process.env.JIRA_TEST_ISSUE_KEY;
  expect(base).toBeTruthy();
  expect(issue).toBeTruthy();

  await page.goto(`${base}/browse/${issue}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(issue));
  await expect(page.locator('body')).not.toContainText(/Something went wrong|Failed to load/i);

  const smartApprovalText = page.getByText('Smart Approval', { exact: true });
  await expect(smartApprovalText.first()).toBeVisible({ timeout: 30000 });

  const requestApproval = page.getByText('Request approval', { exact: true });
  await expect(requestApproval.first()).toBeVisible({ timeout: 30000 });

  await expect(page.getByText(/Request customer sign-off without leaving the Jira ticket/i).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Request approval' }).first()).toBeVisible({ timeout: 30000 });
});
