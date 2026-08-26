import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Label, Lozenge, Select, Spinner, Stack, Text, TextArea, Textfield, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';

const modeOptions = [
  { label: 'All selected approvers must approve', value: 'all' },
  { label: 'Any one selected approver can approve', value: 'any' },
];

const AgentPanel = () => {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key;
  const [approvals, setApprovals] = useState([]);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [approvalMode, setApprovalMode] = useState(modeOptions[0]);
  const [message, setMessage] = useState('');
  const [preparedRule, setPreparedRule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!issueKey) return;
    setLoading(true);
    try {
      const [items, defaults] = await Promise.all([
        invoke('getIssueApprovals', { issueKey }),
        invoke('getApprovalDefaults', { issueKey }),
      ]);
      setApprovals(items || []);
      const suggestion = defaults?.suggestion || null;
      if (suggestion) {
        const options = (suggestion.approvers || []).map((a) => ({ label: a.displayName, value: a.accountId }));
        setSelected(options);
        setApprovalMode(suggestion.approvalMode === 'any' ? modeOptions[1] : modeOptions[0]);
        setMessage(suggestion.message || '');
        setPreparedRule(suggestion);
      } else if ((selected || []).length === 0) {
        setApprovalMode(defaults?.defaultApprovalMode === 'any' ? modeOptions[1] : modeOptions[0]);
        setPreparedRule(null);
      }
    } catch (e) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [issueKey]);

  const search = async () => {
    setError('');
    try {
      const found = await invoke('searchApprovers', { query });
      setUsers(found || []);
      if ((found || []).length === 1) {
        const option = { label: found[0].displayName, value: found[0].accountId };
        setSelected((current) => current.some((x) => x.value === option.value) ? current : [...current, option]);
      }
    } catch (e) { setError(e.message || String(e)); }
  };

  const requestApproval = async () => {
    const approvers = (selected || []).map((s) => ({ accountId: s.value, displayName: s.label }));
    if (!approvers.length) return setError('Select at least one approver first.');
    setBusy(true); setError('');
    try {
      await invoke('createApproval', {
        issueKey,
        approvers,
        approvalMode: approvalMode?.value,
        message,
        preparedRuleId: preparedRule?.ruleId || '',
      });
      setQuery(''); setUsers([]); setSelected([]); setMessage(''); setPreparedRule(null);
      await refresh();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const act = async (name, id) => {
    setBusy(true); setError('');
    try { await invoke(name, { approvalId: id }); await refresh(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const availableOptions = [...selected, ...users.map((u) => ({ label: u.displayName, value: u.accountId }))]
    .filter((item, index, all) => all.findIndex((x) => x.value === item.value) === index);

  const groupProgress = (approval) => {
    if (!approval.groupId || !approval.groupSize || approval.groupSize <= 1) return null;
    const group = approvals.filter((a) => a.groupId === approval.groupId);
    const approved = group.filter((a) => a.status === 'approved').length;
    const declined = group.filter((a) => a.status === 'declined').length;
    const pending = group.filter((a) => a.status === 'pending').length;
    return `${approved} approved · ${declined} declined · ${pending} waiting · ${approval.approvalMode === 'any' ? 'any one can approve' : 'all must approve'}`;
  };

  return <Stack space="space.250">
    <Stack space="space.050">
      <Heading size="medium">Smart Approval</Heading>
      <Text>Request customer sign-off without leaving the Jira ticket.</Text>
    </Stack>
    {error ? <Text>{error}</Text> : null}

    <Stack space="space.100">
      <Heading size="small">Request approval</Heading>
      {preparedRule ? <Stack space="space.050">
        <Lozenge appearance="inprogress">Prepared by rule</Lozenge>
        <Text><Text weight="bold">{preparedRule.ruleName || 'Approval rule'}</Text> matched this ticket. Approvers have been preselected for you to review before sending.</Text>
      </Stack> : null}
      <Label labelFor="approver-search">Find approvers</Label>
      <Inline space="space.100" alignBlock="center">
        <Textfield id="approver-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" />
        <Button onClick={search} isDisabled={query.trim().length < 2 || busy}>Search</Button>
      </Inline>
      {availableOptions.length ? <Select
        label="Selected approvers"
        isMulti
        options={availableOptions}
        value={selected}
        onChange={(value) => setSelected(value || [])}
        placeholder="Choose one or more approvers"
      /> : null}
      {(selected || []).length > 1 ? <Select label="Approval requirement" options={modeOptions} value={approvalMode} onChange={setApprovalMode} /> : null}
      {(selected || []).length ? <Text>{selected.length} approver{selected.length === 1 ? '' : 's'} selected.</Text> : null}
      <Label labelFor="approval-message">Message to approvers (optional)</Label>
      <TextArea id="approval-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Explain what needs to be approved" />
      <Button appearance="primary" onClick={requestApproval} isDisabled={(selected || []).length === 0 || busy}>Request approval</Button>
      {preparedRule ? <Text>Nothing is sent to the customer until you click Request approval.</Text> : null}
    </Stack>

    <Heading size="small">Approval activity</Heading>
    {loading ? <Spinner /> : approvals.length === 0 ? <Text>No approvals have been requested for this ticket yet.</Text> : approvals.map((a) =>
      <Stack key={a.id} space="space.050">
        <Inline space="space.100" alignBlock="center">
          <Text><Text weight="bold">{a.approver.displayName}</Text></Text>
          <Lozenge appearance={a.status === 'approved' ? 'success' : a.status === 'declined' ? 'removed' : a.status === 'pending' ? 'inprogress' : 'default'}>{a.status}</Lozenge>
        </Inline>
        <Text>Requested {new Date(a.createdAt).toLocaleString()} · Reminders {a.reminderCount || 0}</Text>
        {groupProgress(a) ? <Text>{groupProgress(a)}</Text> : null}
        {a.source === 'rule-assisted' && a.ruleName ? <Text>Prepared by rule: {a.ruleName} · sent by agent</Text> : a.source === 'manual' ? <Text>Requested manually</Text> : null}
        {a.message ? <Text>Request message: {a.message}</Text> : null}
        {a.decisionReason ? <Text>Decision comment: {a.decisionReason}</Text> : null}
        {a.transitionError ? <Text>Workflow action needs attention: {a.transitionError}</Text> : null}
        {a.status === 'pending' ? <Inline space="space.100">
          <Button onClick={() => act('sendReminder', a.id)} isDisabled={busy}>Send reminder</Button>
          <Button appearance="subtle" onClick={() => act('cancelApproval', a.id)} isDisabled={busy}>Cancel approval</Button>
        </Inline> : null}
      </Stack>
    )}
  </Stack>;
};

ForgeReconciler.render(<AgentPanel />);
