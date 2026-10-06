import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { exportBackupPage, importBackupBatch } from './backup.js';

// Resolver for the Backup & restore admin page. A backup covers the whole site's data, so only
// Jira administrators can download or restore one.
const resolver = new Resolver();

async function requireJiraAdmin() {
  const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: { Accept: 'application/json' } });
  const data = response.ok ? await response.json() : null;
  if (data?.permissions?.ADMINISTER?.havePermission !== true) throw new Error('Only Jira administrators can back up or restore this app.');
}

resolver.define('exportBackupPage', async ({ payload }) => {
  await requireJiraAdmin();
  return exportBackupPage(payload?.cursor || null);
});

resolver.define('importBackupBatch', async ({ payload }) => {
  await requireJiraAdmin();
  return importBackupBatch(payload?.items);
});

export const handler = resolver.getDefinitions();
