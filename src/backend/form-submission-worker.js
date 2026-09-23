import { kvs, WhereConditions } from '@forge/kvs';
import { listIssueForms } from './forms.js';
import { run as prepareRuleSuggestion } from './automation.js';
import { createApprovalHandler } from './index.js';

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const suggestionKey = (issueKey) => `suggestion#${issueKey}`;
const formWatchKey = (issueKey) => `formwatch#${issueKey}`;

async function watches(max = 100) {
  let cursor;
  const out = [];
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith('formwatch#')).limit(20);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    out.push(...(page?.results || []));
    cursor = page?.nextCursor;
  } while (cursor && out.length < max);
  return out.slice(0, max).map((row) => row.value).filter(Boolean);
}

export async function run() {
  for (const watch of await watches()) {
    const issueKey = clean(watch?.issueKey, 100);
    if (!issueKey) continue;
    try {
      const forms = await listIssueForms(issueKey);
      const form = forms.find((item) =>
        clean(item?.id, 300) === clean(watch?.instanceId, 300) ||
        clean(item?.formTemplate?.id, 300) === clean(watch?.formId, 300)
      );
      if (!form || !(form?.submitted === true || form?.state?.status === 's')) continue;

      await prepareRuleSuggestion({ issue: { key: issueKey, fields: { project: { id: clean(watch.projectId, 100) } } } });
      const suggestion = await kvs.get(suggestionKey(issueKey));
      if (!suggestion ||
          suggestion.autoSendOnFormSubmit !== true ||
          clean(suggestion.ruleId, 200) !== clean(watch.ruleId, 200) ||
          clean(suggestion.formId, 300) !== clean(watch.formId, 300)) {
        await kvs.delete(formWatchKey(issueKey));
        continue;
      }

      await createApprovalHandler({
        payload: {
          system: true,
          issueKey,
          approvers: suggestion.approvers || [],
          preparedRuleId: suggestion.ruleId,
          approvalMode: suggestion.approvalMode,
          reminderHours: suggestion.reminderHours,
          message: suggestion.message || '',
        },
        context: { accountId: 'automation' },
      });
      await kvs.delete(formWatchKey(issueKey));
    } catch (error) {
      const message = String(error?.message || error || '');
      if (message.includes('No new active approvers were selected')) await kvs.delete(formWatchKey(issueKey));
      console.warn('Smart Approval automatic form approval check failed', message.slice(0, 300));
    }
  }
}
