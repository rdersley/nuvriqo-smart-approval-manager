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

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  return <Stack space="space.300">
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Heading size="medium">Smart Approval Manager</Heading>
        {pendingCount ? <Lozenge appearance="inprogress">{pendingCount} waiting</Lozenge> : <Lozenge appearance="success">Ready</Lozenge>}
      </Inline>
      <Text>Prepare, send and track customer approvals directly from this Jira request.</Text>
    </Stack>
    {error ? <Text>{error}</Text> : null}

    <Stack space="space.150">
      <Heading size="small">1. Choose who should approve</Heading>
      {preparedRule ? <Stack space="space.050">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance="inprogress">Rule matched</Lozenge>
          <Lozenge appearance="moved">Agent review required</Lozenge>
        </Inline>
        <Text><Text weight="bold">{preparedRule.ruleName || 'Approval rule'}</Text> matched this ticket and prepared the approvers below.</Text>
        <Text>Review the approvers and message before sending. Nothing has been sent to the customer yet.</Text>
      </Stack> : <Text>No rule has prepared approvers for this request. You can select them manually.</Text>}

      <Label labelFor="approver-search">Find approvers</Label>
      <Inline space="space.100" alignBlock="center">
        <Textfield id="approver-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" />
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
      {(selected || []).length ? <Text><Text weight="bold">{selected.length}</Text> approver{selected.length === 1 ? '' : 's'} selected.</Text> : null}
    </Stack>

    <Stack space="space.150">
      <Heading size="small">2. Add the approval message</Heading>
      <Label labelFor="approval-message">Message to approvers (optional)</Label>
      <TextArea id="approval-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Explain what the customer is being asked to approve" />
    </Stack>

    <Stack space="space.100">
      <Heading size="small">3. Send for approval</Heading>
      <Text>The customer will only be notified after you send the request.</Text>
      <Button appearance="primary" onClick={requestApproval} isDisabled={(selected || []).length === 0 || busy}>Send approval request</Button>
    </Stack>

    <Stack space="space.150">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="small">Approval activity</Heading>
        {approvals.length ? <Lozenge appearance="default">{approvals.length} total</Lozenge> : null}
      </Inline>
      {loading ? <Spinner /> : approvals.length === 0 ? <Text>No approvals have been sent for this ticket yet.</Text> : approvals.map((a) =>
        <Stack key={a.id} space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Text><Text weight="bold">{a.approver.displayName}</Text></Text>
            <Lozenge appearance={a.status === 'approved' ? 'success' : a.status === 'declined' ? 'removed' : a.status === 'pending' ? 'inprogress' : 'default'}>{a.status === 'approved' ? 'Approved' : a.status === 'declined' ? 'Declined' : a.status === 'pending' ? 'Waiting' : a.status}</Lozenge>
          </Inline>
          <Text>Requested {new Date(a.createdAt).toLocaleString()} · Reminders sent: {a.reminderCount || 0}</Text>
          {groupProgress(a) ? <Text>{groupProgress(a)}</Text> : null}
          {a.source === 'rule-assisted' && a.ruleName ? <Text>Prepared by rule: {a.ruleName} · sent by agent</Text> : a.source === 'manual' ? <Text>Selected manually by the agent</Text> : null}
          {a.message ? <Text><Text weight="bold">Request message:</Text> {a.message}</Text> : null}
          {a.decisionReason ? <Text><Text weight="bold">Decision comment:</Text> {a.decisionReason}</Text> : null}
          {a.transitionError ? <Text>Workflow action needs attention: {a.transitionError}</Text> : null}
          {a.status === 'pending' ? <Inline space="space.100">
            <Button onClick={() => act('sendReminder', a.id)} isDisabled={busy}>Send reminder</Button>
            <Button appearance="subtle" onClick={() => act('cancelApproval', a.id)} isDisabled={busy}>Cancel approval</Button>
          </Inline> : null}
        </Stack>
      )}
    </Stack>
  </Stack>;
};

ForgeReconciler.render(<AgentPanel />);
