// "One form per account" rules: a ticket carries one copy of the rule's JSM Form
// for each user account it covers (an audit requirement, e.g. Ryanair wants a
// separate form and approval per user). Each copy gets its own approval; the
// ticket moves on only once every account form has been decided.
import { kvs } from '@forge/kvs';
import { attachExternalFormToIssue, getSimplifiedFormAnswers, listIssueForms } from './forms.js';
import { addPublicComment, clean, groupOutcome, nowIso, queryPrefix, transitionIssue } from './store.js';

export const MAX_ACCOUNT_FORMS = 25;
export const accountFormWatchKey = (issueKey, instanceId) => `formwatch#${issueKey}#${instanceId}`;
const settledKey = (issueKey, formId) => `accountforms#${issueKey}#${formId}`;

export const isSubmitted = (form) => form?.submitted === true || form?.state?.status === 's';

// Copies of the rule's form template on the ticket, oldest first.
export async function listAccountForms(issueKey, formId) {
  const wanted = clean(formId, 300);
  return (await listIssueForms(issueKey)).filter((form) => clean(form?.formTemplate?.id, 300) === wanted);
}

// The answer that names the account, e.g. the "Vector / vPack username" question.
export function accountLabel(answers, fieldKey) {
  const key = clean(fieldKey, 300);
  if (!key) return '';
  return clean((answers || []).find((row) => clean(row.fieldKey, 300) === key)?.answer, 200);
}

// Attaches one more customer-visible copy of the form and, for auto-send rules,
// watches that copy so its approval is sent once the customer submits it.
export async function attachAccountForm({ issueKey, projectId, suggestion }) {
  const existing = await listAccountForms(issueKey, suggestion.formId);
  if (existing.length >= MAX_ACCOUNT_FORMS) throw new Error(`This request already has the maximum of ${MAX_ACCOUNT_FORMS} account forms.`);
  const attached = await attachExternalFormToIssue(issueKey, suggestion.formId);
  const instanceId = clean(attached?.instanceId || attached?.id, 300);
  if (suggestion.autoSendOnFormSubmit === true && instanceId) {
    await kvs.set(accountFormWatchKey(issueKey, instanceId), {
      issueKey, projectId: clean(projectId, 100), formId: clean(suggestion.formId, 300), instanceId,
      ruleId: clean(suggestion.ruleId, 200), perAccount: true, createdAt: nowIso(),
    });
  }
  return { ...attached, instanceId, number: existing.length + 1, firstForm: existing.length === 0 };
}

async function accountApprovals(issueKey, formId) {
  const rows = await queryPrefix(`issue#${issueKey}#`);
  return rows.map((r) => r.value).filter((r) => r?.perAccountForm && clean(r.formSnapshot?.formId, 300) === clean(formId, 300));
}

// State of one form copy from its approvals: approved / declined (a decided
// group), pending, withdrawn (all approvals cancelled), or not yet requested.
function copyState(form, records) {
  const mine = records.filter((r) => clean(r.formSnapshot?.instanceId, 300) === clean(form?.id, 300));
  const groups = [...new Set(mine.map((r) => r.groupId))].map((id) => mine.filter((r) => r.groupId === id));
  const outcomes = groups.map((group) => groupOutcome(group, group[0]?.approvalMode === 'any' ? 'any' : 'all'));
  if (outcomes.includes('approved')) return 'approved';
  if (outcomes.includes('declined')) return 'declined';
  if (mine.some((r) => r.status === 'pending')) return 'pending';
  if (mine.length) return 'withdrawn';
  return isSubmitted(form) ? 'submitted' : 'waiting-for-customer';
}

// One row per form copy for the agent panel.
export async function accountFormStatus(issueKey, suggestion) {
  const [forms, records] = await Promise.all([listAccountForms(issueKey, suggestion.formId), accountApprovals(issueKey, suggestion.formId)]);
  const rows = [];
  for (const [index, form] of forms.entries()) {
    const instanceId = clean(form?.id, 300);
    const approval = records.filter((r) => clean(r.formSnapshot?.instanceId, 300) === instanceId).at(-1);
    let label = clean(approval?.formAccountLabel, 200);
    if (!label && isSubmitted(form)) {
      try { label = accountLabel(await getSimplifiedFormAnswers(issueKey, instanceId), suggestion.formAccountFieldKey); }
      catch (error) { console.warn('Smart Approval: unable to read account form answers', error?.message || error); }
    }
    rows.push({ instanceId, number: index + 1, label, submitted: isSubmitted(form), state: copyState(form, records) });
  }
  return rows;
}

// Called whenever an account-form approval changes. Once no copy is waiting
// (for the customer or for a decision), applies the rule's approved transition
// if any account was approved (declined if none were) and posts one summary.
export async function settleAccountForms(record, settings) {
  const issueKey = record.issueKey;
  const formId = clean(record.formSnapshot?.formId, 300);
  const [forms, records] = await Promise.all([listAccountForms(issueKey, formId), accountApprovals(issueKey, formId)]);
  const states = forms.map((form) => copyState(form, records));
  if (states.some((s) => s === 'pending' || s === 'submitted' || s === 'waiting-for-customer')) return 'waiting';
  const approved = states.filter((s) => s === 'approved').length;
  const declined = states.filter((s) => s === 'declined').length;
  if (!approved && !declined) return 'withdrawn';

  // Re-settling the same set of decisions (e.g. a duplicate event) must not
  // transition or comment twice; a new account form decided later does.
  const signature = forms.map((form, i) => `${clean(form?.id, 300)}:${states[i]}`).join('|');
  if ((await kvs.get(settledKey(issueKey, formId)))?.signature === signature) return 'already-settled';

  const outcome = approved ? 'approved' : 'declined';
  const targetStatus = clean(outcome === 'approved' ? record.ruleTargetStatuses?.approved || settings.approveTargetStatus : record.ruleTargetStatuses?.declined || settings.declineTargetStatus, 200);
  const transitionId = clean(outcome === 'approved' ? record.ruleTransitionIds?.approved || settings.approveTransitionId : record.ruleTransitionIds?.declined || settings.declineTransitionId, 100);
  if (targetStatus || transitionId) {
    try { await transitionIssue(issueKey, targetStatus, transitionId); }
    catch (error) { console.warn('Smart Approval: account forms transition failed', error?.message || error); }
  }
  const labelOf = (form) => clean(records.filter((r) => clean(r.formSnapshot?.instanceId, 300) === clean(form?.id, 300)).at(-1)?.formAccountLabel, 200);
  const declinedNames = forms.map((form, i) => (states[i] === 'declined' ? labelOf(form) || `form ${i + 1}` : null)).filter(Boolean);
  await addPublicComment(issueKey, `All account forms on this request have been decided: ${approved} approved, ${declined} declined.`
    + (declinedNames.length ? ` Declined: ${declinedNames.join(', ')}.` : ''));
  await kvs.set(settledKey(issueKey, formId), { signature, outcome, approved, declined, at: nowIso() });
  return outcome;
}
