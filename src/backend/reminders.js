import { kvs, WhereConditions } from '@forge/kvs';
import api, { route } from '@forge/api';
import { resolveDisplayName, stripStoredDisplayName } from './users.js';

async function queryPending(max = 200) {
  let cursor;
  const out = [];
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith('approval#')).limit(20);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...(page?.results || []));
    cursor = page?.nextCursor;
  } while (cursor && out.length < max);
  return out.map((x) => x.value).filter((x) => x?.status === 'pending');
}

async function save(record) {
  const stored = stripStoredDisplayName(record);
  await Promise.all([
    kvs.set(`approval#${stored.id}`, stored),
    kvs.set(`issue#${stored.issueKey}#${stored.createdAt}#${stored.id}`, stored),
    kvs.set(`approver#${stored.approver.accountId}#${stored.createdAt}#${stored.id}`, stored),
  ]);
}

async function comment(issueKey, text) {
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ body: text, public: true }),
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function run() {
  const now = Date.now();
  const pending = await queryPending();
  for (const record of pending) {
    if (!record.nextReminderAt || Date.parse(record.nextReminderAt) > now) continue;
    try {
      const displayName = await resolveDisplayName(record.approver?.accountId);
      await comment(record.issueKey, `Reminder: approval is still waiting for ${displayName}. Please open My Approvals in the customer portal.`);
      const at = new Date().toISOString();
      record.reminderCount = Number(record.reminderCount || 0) + 1;
      record.updatedAt = at;
      record.nextReminderAt = new Date(now + Number(record.reminderHours || 24) * 3600000).toISOString();
      record.events = [...(record.events || []), { type: 'automatic-reminder', at, by: 'system' }];
      await save(record);
    } catch (error) {
      console.error(`Reminder failed for ${record.id}:`, error?.message || error);
    }
  }
}
