import api, { route } from '@forge/api';
import { resolveDisplayName } from './users.js';
import {
  MAX_AUTOMATIC_REMINDERS, ensurePendingIndex, expireApproval, issueState, loadPending, nowIso, saveApproval,
} from './store.js';

async function comment(issueKey, text) {
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ body: text, public: true }),
  });
  if (!response.ok) throw new Error(await response.text());
}

const automaticReminders = (record) => (record.events || []).filter((e) => e?.type === 'automatic-reminder').length;

export async function run() {
  const now = Date.now();
  await ensurePendingIndex();
  const pending = await loadPending('pending#');
  for (const record of pending) {
    if (!record.nextReminderAt || Date.parse(record.nextReminderAt) > now) continue;
    try {
      const state = await issueState(record.issueKey);
      if (state !== 'open') {
        await expireApproval(record, state === 'done' ? 'ticket-resolved' : 'ticket-missing');
        continue;
      }
      if (automaticReminders(record) >= MAX_AUTOMATIC_REMINDERS) {
        const at = nowIso();
        record.nextReminderAt = null;
        record.updatedAt = at;
        record.events = [...(record.events || []), { type: 'automatic-reminders-stopped', at, by: 'system', after: MAX_AUTOMATIC_REMINDERS }];
        await saveApproval(record);
        continue;
      }
      const displayName = await resolveDisplayName(record.approver?.accountId);
      await comment(record.issueKey, `Reminder: approval is still waiting for ${displayName}. Please open My Approvals in the customer portal.`);
      const at = nowIso();
      record.reminderCount = Number(record.reminderCount || 0) + 1;
      record.updatedAt = at;
      record.nextReminderAt = new Date(now + Number(record.reminderHours || 24) * 3600000).toISOString();
      record.events = [...(record.events || []), { type: 'automatic-reminder', at, by: 'system' }];
      await saveApproval(record);
    } catch (error) {
      console.error(`Reminder failed for ${record.id}:`, error?.message || error);
    }
  }
}
