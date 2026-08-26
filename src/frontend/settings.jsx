import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Checkbox, Heading, Inline, Label, Lozenge, Select, Spinner, Stack, Text, TextArea, Textfield, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';

const modeOptions = [
  { label: 'All approvers must approve', value: 'all' },
  { label: 'Any one approver can approve', value: 'any' },
];
const operatorOptions = [
  { label: 'Equals', value: 'equals' },
  { label: 'Does not equal', value: 'notEquals' },
  { label: 'Contains', value: 'contains' },
  { label: 'Is empty', value: 'isEmpty' },
  { label: 'Is not empty', value: 'notEmpty' },
];
const newRule = (number) => ({
  id: `rule-${Date.now()}-${number}`,
  name: `Approval rule ${number}`,
  enabled: true,
  triggerStatus: '',
  approvalMode: 'all',
  conditions: [{ fieldId: 'issuetype', operator: 'equals', value: '' }],
  approvers: [],
  message: 'Please review and approve this request.',
  reminderHours: 24,
  pendingTargetStatus: '', approveTargetStatus: '', declineTargetStatus: '',
});

const Settings = () => {
  const context = useProductContext();
  const projectId = context?.extension?.project?.id;
  const [settings, setSettings] = useState(null);
  const [fields, setFields] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [commonOptions, setCommonOptions] = useState({});
  const [fieldOptions, setFieldOptions] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchText, setSearchText] = useState({});
  const [searchResults, setSearchResults] = useState({});
  const [advanced, setAdvanced] = useState({});

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      invoke('getSettings', { projectId }),
      invoke('getRuleBuilderMetadata', { projectId }),
    ]).then(([value, meta]) => {
      setSettings(value);
      setFields(meta?.fields || []);
      setStatuses(meta?.statuses || []);
      setCommonOptions(meta?.commonOptions || {});
    }).catch((e) => setMessage(e.message || String(e)));
  }, [projectId]);

  if (!settings) return <Spinner />;
  const update = (key, value) => setSettings({ ...settings, [key]: value });
  const updateRules = (rules) => update('autoRules', rules);
  const updateRule = (index, patch) => updateRules((settings.autoRules || []).map((r, i) => i === index ? { ...r, ...patch } : r));
  const updateCondition = (ruleIndex, conditionIndex, patch) => {
    const rule = settings.autoRules[ruleIndex];
    updateRule(ruleIndex, { conditions: rule.conditions.map((c, i) => i === conditionIndex ? { ...c, ...patch } : c) });
  };

  const getFieldName = (id) => fields.find((f) => f.id === id)?.name || id || 'field';
  const getOperatorName = (op) => operatorOptions.find((x) => x.value === op)?.label?.toLowerCase() || op;
  const ruleSummary = (rule) => {
    const trigger = rule.triggerStatus ? `At ${rule.triggerStatus}: ` : '';
    const conditions = (rule.conditions || []).filter((c) => c.fieldId).map((c) => {
      if (c.operator === 'isEmpty' || c.operator === 'notEmpty') return `${getFieldName(c.fieldId)} ${getOperatorName(c.operator)}`;
      return `${getFieldName(c.fieldId)} ${getOperatorName(c.operator)} ${c.value || '…'}`;
    }).join(' AND ');
    const approvers = (rule.approvers || []).map((a) => a.displayName).join(', ') || 'no approvers selected';
    const mode = rule.approvalMode === 'any' ? 'any one can approve' : 'all must approve';
    return `${trigger}${conditions || 'No conditions yet'} → prepare ${approvers} → ${mode}`;
  };

  const loadOptions = async (fieldId, key) => {
    if (!fieldId) return;
    if (commonOptions[fieldId]?.length) {
      setFieldOptions((prev) => ({ ...prev, [key]: commonOptions[fieldId] }));
      return;
    }
    try {
      const options = await invoke('getRuleFieldOptions', { projectId, fieldId });
      setFieldOptions((prev) => ({ ...prev, [key]: options || [] }));
    } catch { setFieldOptions((prev) => ({ ...prev, [key]: [] })); }
  };

  const findApprovers = async (ruleIndex) => {
    const query = (searchText[ruleIndex] || '').trim();
    if (query.length < 2) return;
    try {
      setSearchResults({ ...searchResults, [ruleIndex]: await invoke('searchRuleApprovers', { projectId, query }) });
    } catch (e) { setMessage(e.message || String(e)); }
  };

  const addApprover = (ruleIndex, accountId) => {
    const found = (searchResults[ruleIndex] || []).find((u) => u.accountId === accountId);
    if (!found) return;
    const rule = settings.autoRules[ruleIndex];
    if (rule.approvers.some((a) => a.accountId === found.accountId)) return;
    updateRule(ruleIndex, { approvers: [...rule.approvers, found] });
    setSearchText({ ...searchText, [ruleIndex]: '' });
    setSearchResults({ ...searchResults, [ruleIndex]: [] });
  };

  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const saved = await invoke('saveSettings', { projectId, settings });
      setSettings(saved); setMessage('Settings saved successfully.');
    } catch (e) { setMessage(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const statusValue = (name) => name ? { label: name, value: name } : null;

  return <Stack space="space.300">
    <Stack space="space.100">
      <Heading size="large">Smart Approval Manager</Heading>
      <Text>Configure customer approvals for this service project. Preparation rules can choose the right approvers automatically, while an agent always decides when to send the approval.</Text>
    </Stack>

    <Heading size="medium">Default behaviour</Heading>
    <Label labelFor="default-mode">When more than one approver is selected</Label>
    <Select inputId="default-mode" options={modeOptions} value={modeOptions.find((x) => x.value === settings.defaultApprovalMode) || modeOptions[0]} onChange={(v) => update('defaultApprovalMode', v?.value || 'all')} />
    <Label labelFor="reminder-hours">Automatic reminder interval (hours)</Label>
    <Textfield id="reminder-hours" type="number" value={String(settings.reminderHours)} onChange={(e) => update('reminderHours', e.target.value)} />
    <Checkbox isChecked={settings.autoAddParticipant} onChange={(e) => update('autoAddParticipant', e.target.checked)} label="Add approvers as request participants when the agent sends the approval" />
    <Checkbox isChecked={settings.requireDeclineReason} onChange={(e) => update('requireDeclineReason', e.target.checked)} label="Require a reason when declining" />

    <Heading size="medium">Workflow actions</Heading>
    <Text>Choose the Jira status Smart Approval Manager should move the ticket to after the agent sends the approval and after the customer decides.</Text>
    <Label labelFor="pending-status">When approval is requested</Label>
    <Select inputId="pending-status" options={statuses} value={statusValue(settings.pendingTargetStatus)} placeholder="Do not change status" onChange={(v) => update('pendingTargetStatus', v?.value || '')} />
    <Label labelFor="approved-status">When approval succeeds</Label>
    <Select inputId="approved-status" options={statuses} value={statusValue(settings.approveTargetStatus)} placeholder="Do not change status" onChange={(v) => update('approveTargetStatus', v?.value || '')} />
    <Label labelFor="declined-status">When approval is declined</Label>
    <Select inputId="declined-status" options={statuses} value={statusValue(settings.declineTargetStatus)} placeholder="Do not change status" onChange={(v) => update('declineTargetStatus', v?.value || '')} />

    <Inline spread="space-between" alignBlock="center">
      <Heading size="medium">Approval preparation rules</Heading>
      <Button onClick={() => updateRules([...(settings.autoRules || []), newRule((settings.autoRules || []).length + 1)])}>Add rule</Button>
    </Inline>
    <Text>Rules prepare the approvers and message for an agent. They never send an approval automatically.</Text>
    {(settings.autoRules || []).length === 0 ? <Text>No preparation rules yet. Agents can still select approvers manually.</Text> : null}

    {(settings.autoRules || []).map((rule, ruleIndex) => <Stack key={rule.id} space="space.150">
      <Inline spread="space-between" alignBlock="center">
        <Inline space="space.100" alignBlock="center">
          <Heading size="small">{rule.name}</Heading>
          <Lozenge appearance={rule.enabled ? 'success' : 'default'}>{rule.enabled ? 'Enabled' : 'Disabled'}</Lozenge>
        </Inline>
        <Button appearance="subtle" onClick={() => updateRules(settings.autoRules.filter((_, i) => i !== ruleIndex))}>Remove rule</Button>
      </Inline>
      <Text>{ruleSummary(rule)}</Text>

      <Label labelFor={`rule-name-${ruleIndex}`}>Rule name</Label>
      <Textfield id={`rule-name-${ruleIndex}`} value={rule.name} onChange={(e) => updateRule(ruleIndex, { name: e.target.value })} placeholder="e.g. Ryanair hardware approval" />
      <Checkbox isChecked={rule.enabled !== false} onChange={(e) => updateRule(ruleIndex, { enabled: e.target.checked })} label="Rule enabled" />

      <Heading size="small">When should the approval be prepared?</Heading>
      <Label labelFor={`trigger-status-${ruleIndex}`}>Prepare only when ticket reaches this status (optional)</Label>
      <Select inputId={`trigger-status-${ruleIndex}`} options={statuses} value={statusValue(rule.triggerStatus)} placeholder="Prepare as soon as the conditions match" onChange={(v) => updateRule(ruleIndex, { triggerStatus: v?.value || '' })} />
      <Text>If you choose a status, the approvers are not prepared until the ticket reaches that workflow stage.</Text>

      <Heading size="small">Additional conditions</Heading>
      {(rule.conditions || []).map((condition, conditionIndex) => {
        const optionKey = `${rule.id}:${conditionIndex}:${condition.fieldId}`;
        const options = commonOptions[condition.fieldId] || fieldOptions[optionKey] || [];
        return <Stack key={`${rule.id}-condition-${conditionIndex}`} space="space.100">
          <Select
            options={fields.map((f) => ({ label: f.name, value: f.id }))}
            value={condition.fieldId ? { label: getFieldName(condition.fieldId), value: condition.fieldId } : null}
            placeholder="Choose Jira field"
            onChange={(v) => {
              const fieldId = v?.value || '';
              updateCondition(ruleIndex, conditionIndex, { fieldId, value: '' });
              loadOptions(fieldId, `${rule.id}:${conditionIndex}:${fieldId}`);
            }}
          />
          <Select options={operatorOptions} value={operatorOptions.find((o) => o.value === condition.operator) || operatorOptions[0]} onChange={(v) => updateCondition(ruleIndex, conditionIndex, { operator: v?.value || 'equals' })} />
          {!['isEmpty','notEmpty'].includes(condition.operator) ? (options.length ?
            <Select options={options} value={condition.value ? { label: condition.value, value: condition.value } : null} placeholder="Choose value" onChange={(v) => updateCondition(ruleIndex, conditionIndex, { value: v?.value || '' })} /> :
            <Textfield value={condition.value || ''} placeholder="Value to match" onChange={(e) => updateCondition(ruleIndex, conditionIndex, { value: e.target.value })} />
          ) : null}
          <Button appearance="subtle" onClick={() => updateRule(ruleIndex, { conditions: rule.conditions.filter((_, i) => i !== conditionIndex) })}>Remove condition</Button>
        </Stack>;
      })}
      <Button appearance="subtle" onClick={() => updateRule(ruleIndex, { conditions: [...(rule.conditions || []), { fieldId: '', operator: 'equals', value: '' }] })}>Add condition</Button>

      <Heading size="small">Approvers to prepare</Heading>
      {(rule.approvers || []).length === 0 ? <Text>No approvers selected.</Text> : (rule.approvers || []).map((a) =>
        <Inline key={a.accountId} space="space.100" alignBlock="center"><Text>{a.displayName}</Text><Button appearance="subtle" onClick={() => updateRule(ruleIndex, { approvers: rule.approvers.filter((x) => x.accountId !== a.accountId) })}>Remove</Button></Inline>
      )}
      <Inline space="space.100" alignBlock="center">
        <Textfield value={searchText[ruleIndex] || ''} placeholder="Search approver by name or email" onChange={(e) => setSearchText({ ...searchText, [ruleIndex]: e.target.value })} />
        <Button onClick={() => findApprovers(ruleIndex)} isDisabled={(searchText[ruleIndex] || '').trim().length < 2}>Search</Button>
      </Inline>
      {(searchResults[ruleIndex] || []).length ? <Select placeholder="Choose approver to add" options={searchResults[ruleIndex].map((u) => ({ label: u.displayName, value: u.accountId }))} onChange={(v) => addApprover(ruleIndex, v?.value)} /> : null}

      <Label labelFor={`mode-${ruleIndex}`}>Approval requirement</Label>
      <Select inputId={`mode-${ruleIndex}`} options={modeOptions} value={modeOptions.find((x) => x.value === rule.approvalMode) || modeOptions[0]} onChange={(v) => updateRule(ruleIndex, { approvalMode: v?.value || 'all' })} />
      <Label labelFor={`message-${ruleIndex}`}>Message to approvers</Label>
      <TextArea id={`message-${ruleIndex}`} value={rule.message || ''} onChange={(e) => updateRule(ruleIndex, { message: e.target.value })} />
      <Label labelFor={`reminder-${ruleIndex}`}>Reminder interval (hours)</Label>
      <Textfield id={`reminder-${ruleIndex}`} type="number" value={String(rule.reminderHours || settings.reminderHours || 24)} onChange={(e) => updateRule(ruleIndex, { reminderHours: e.target.value })} />

      <Button appearance="subtle" onClick={() => setAdvanced({ ...advanced, [rule.id]: !advanced[rule.id] })}>{advanced[rule.id] ? 'Hide workflow overrides' : 'Show workflow overrides'}</Button>
      {advanced[rule.id] ? <Stack space="space.100">
        <Text>Optional: override the project workflow actions for approvals prepared by this rule.</Text>
        <Label labelFor={`pending-rule-status-${ruleIndex}`}>When the agent sends the approval</Label>
        <Select inputId={`pending-rule-status-${ruleIndex}`} options={statuses} value={statusValue(rule.pendingTargetStatus)} placeholder="Use project default" onChange={(v) => updateRule(ruleIndex, { pendingTargetStatus: v?.value || '' })} />
        <Label labelFor={`approve-rule-status-${ruleIndex}`}>When approval succeeds</Label>
        <Select inputId={`approve-rule-status-${ruleIndex}`} options={statuses} value={statusValue(rule.approveTargetStatus)} placeholder="Use project default" onChange={(v) => updateRule(ruleIndex, { approveTargetStatus: v?.value || '' })} />
        <Label labelFor={`decline-rule-status-${ruleIndex}`}>When approval is declined</Label>
        <Select inputId={`decline-rule-status-${ruleIndex}`} options={statuses} value={statusValue(rule.declineTargetStatus)} placeholder="Use project default" onChange={(v) => updateRule(ruleIndex, { declineTargetStatus: v?.value || '' })} />
      </Stack> : null}
    </Stack>)}

    <Button appearance="primary" onClick={save} isDisabled={busy}>Save Smart Approval settings</Button>
    {message ? <Text>{message}</Text> : null}
  </Stack>;
};

ForgeReconciler.render(<Settings />);
