// Announces Smart Approval to Nuvriqo Portal+ on a service project, so Portal+ adds an
// "Approvals" tab to its customer portal menu. Portal+ reads every Jira project property
// whose key starts with "nuvriqo.portalplus.menu." (contract version 1, documented in the
// Portal+ repo at src/companion-menu.js). Projects without Portal+ simply ignore it.
import api, { route } from '@forge/api';

export const PORTAL_PLUS_MENU_KEY = 'nuvriqo.portalplus.menu.smart-approval';

export function portalPlusMenuEntry() {
  return {
    version: 1,
    provider: 'nuvriqo-smart-approval-manager',
    label: 'Approvals',
    description: 'Requests waiting for your decision.',
    section: 'smart-approval',
    order: 20,
    enabled: true,
  };
}

// Best effort: a failure here must never block saving Smart Approval settings.
// Called as the project admin who is saving settings (project properties need
// Administer Projects).
export async function announceToPortalPlus(projectId) {
  try {
    const response = await api.asUser().requestJira(route`/rest/api/3/project/${projectId}/properties/${PORTAL_PLUS_MENU_KEY}`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(portalPlusMenuEntry()),
    });
    if (!response.ok) console.warn('Smart Approval could not announce itself to Portal+', response.status);
    return response.ok;
  } catch (error) {
    console.warn('Smart Approval could not announce itself to Portal+', error?.message || error);
    return false;
  }
}
