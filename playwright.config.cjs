const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './ui-tests',
  timeout: 45000,
  retries: 1,
  use: {
    browserName: 'chromium',
    storageState: '.auth/jira.json',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure'
  },
  reporter: [['html', { open: 'never' }], ['list']]
});
