const { test, expect } = require('@playwright/test');

test('deployed Jira issue and app surface load', async ({ page }) => {
  const base = process.env.JIRA_BASE_URL;
  const issue = process.env.JIRA_TEST_ISSUE_KEY;
  expect(base).toBeTruthy();
  expect(issue).toBeTruthy();
  await page.goto(`${base}/browse/${issue}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(issue));
  await expect(page.locator('body')).not.toContainText(/Something went wrong|Failed to load/i);
});
