export const PORTAL_PLUS_PROPERTY_KEY = 'nuvriqo.smart-approval.portal';
export const PORTAL_PLUS_PROVIDER_VERSION = 1;

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export function buildPortalPlusSnapshot(issueKey, records = [], updatedAt = new Date().toISOString()) {
  const approvals = (Array.isArray(records) ? records : [])
    .filter((record) => record?.id && record?.approver?.accountId)
    .slice(0, 50)
    .map((record) => ({
      id: clean(record.id, 200),
      approverAccountId: clean(record.approver.accountId, 200),
      status: clean(record.status || 'pending', 30),
      createdAt: clean(record.createdAt, 100),
      updatedAt: clean(record.updatedAt || record.createdAt, 100),
    }));

  return {
    provider: 'nuvriqo-smart-approval-manager',
    providerVersion: PORTAL_PLUS_PROVIDER_VERSION,
    contract: 'portal-plus-issue-provider-v1',
    issueKey: clean(issueKey, 100),
    updatedAt: clean(updatedAt, 100),
    approvals,
  };
}

export function portalPlusModuleForAccount(snapshot, accountId, issueUrl = '') {
  const mine = (snapshot?.approvals || []).filter((approval) => approval.approverAccountId === accountId);
  const pending = mine.filter((approval) => approval.status === 'pending');
  if (!mine.length) return null;
  return {
    id: 'smart-approval',
    provider: 'nuvriqo-smart-approval-manager',
    version: PORTAL_PLUS_PROVIDER_VERSION,
    title: 'Approvals',
    description: 'Requests that need your approval.',
    priority: 20,
    counters: [{ id: 'pending', label: 'Waiting for you', value: pending.length, tone: pending.length ? 'attention' : 'neutral' }],
    actions: pending.length ? [{ id: 'review', label: 'Review approval', url: issueUrl, badge: String(pending.length), tone: 'attention' }] : [],
    items: pending.slice(0, 10).map((approval) => ({
      id: approval.id,
      title: snapshot.issueKey || 'Approval request',
      subtitle: 'Approval required',
      status: approval.status,
      url: issueUrl,
      badge: 'Waiting for you',
    })),
    health: { available: true, status: 'available', message: '' },
    metadata: { source: 'jira-issue-property', propertyKey: PORTAL_PLUS_PROPERTY_KEY },
  };
}
