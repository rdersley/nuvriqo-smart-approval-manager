import { kvs } from '@forge/kvs';
import { listIssueForms } from './forms.js';
import { run as prepareRuleSuggestion } from './automation.js';
import { createApprovalHandler } from './index.js';
import { clean, issueState, queryPrefix } from './store.js';

const suggestionKey = (issueKey) => `suggestion#${issueKey}`;
const formWatchKey = (issueKey) => `formwatch#${issueKey}`;

// Every watch is read: a cap here would let forms that are never submitted
// crowd out newer ones, which would then never send their approval.
async function watches() {
  return (await queryPrefix('formwatch#')).map((row) => row.value).filter(Boolean);
}

export async function run() {
  for (const watch of await watches()) {
    const issueKey = clean(watch?.issueKey, 100);
    if (!issueKey) continue;
    try {
      // Closed or deleted tickets will never need the approval; stop watching them.
      if (await issueState(issueKey) !== 'open') {
        await kvs.delete(formWatchKey(issueKey));
        continue;
      }
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
