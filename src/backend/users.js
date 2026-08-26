import api, { route } from '@forge/api';

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);

async function json(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(body || `Atlassian API error ${response.status}`);
  return body ? JSON.parse(body) : null;
}

export async function resolveDisplayName(accountId, fallback = 'Approver') {
  const id = clean(accountId, 200);
  if (!id || id === 'unknown') return fallback;
  try {
    const user = await json(await api.asApp().requestJira(route`/rest/api/3/user?accountId=${id}`));
    return clean(user?.displayName, 200) || fallback;
  } catch (error) {
    console.warn('Smart Approval: unable to resolve display name', error?.message || error);
    return fallback;
  }
}

export async function enrichApproval(record) {
  if (!record?.approver?.accountId) return record;
  return {
    ...record,
    approver: {
      accountId: record.approver.accountId,
      displayName: await resolveDisplayName(record.approver.accountId),
    },
  };
}

export function stripStoredDisplayName(record) {
  if (!record?.approver?.accountId) return record;
  return {
    ...record,
    approver: { accountId: record.approver.accountId },
  };
}
