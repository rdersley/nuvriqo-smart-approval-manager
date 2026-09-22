import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Lozenge, Spinner, Stack, Text, TextArea } from '@forge/react';
import { invoke } from '@forge/bridge';

const PortalSummary = () => {
  const [items, setItems] = useState(null);
  const [reasons, setReasons] = useState({});
  const [expanded, setExpanded] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setItems(await invoke('getMyApprovals', { status: 'pending' }));
    } catch (e) {
      setError(e.message || String(e));
      setItems([]);
    }
  };

  useEffect(() => { refresh(); }, []);

  const decide = async (approvalId, decision) => {
    setBusy(approvalId);
    setError('');
    try {
      await invoke('decideApproval', {
        approvalId,
        decision,
        reason: reasons[approvalId] || '',
      });
      setReasons((current) => ({ ...current, [approvalId]: '' }));
      setExpanded((current) => ({ ...current, [approvalId]: false }));
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  };

  if (items === null) return <Spinner />;

  if (items.length === 0) return <Stack space="space.100">
    <Inline space="space.100" alignBlock="center">
      <Heading size="small">Approvals</Heading>
      <Lozenge appearance="success">Up to date</Lozenge>
    </Inline>
    <Text>You have no approval requests waiting for your decision.</Text>
    {error ? <Text>{error}</Text> : null}
  </Stack>;

  return <Stack space="space.150">
    <Inline space="space.100" alignBlock="center">
      <Heading size="small">Approvals needing your attention</Heading>
      <Lozenge appearance="inprogress">{items.length} waiting</Lozenge>
    </Inline>
    <Text>Review and decide directly here. Use Preview details for a little more context before choosing.</Text>
    {error ? <Text>{error}</Text> : null}

    {items.slice(0, 5).map((a) => {
      const isExpanded = !!expanded[a.id];
      const requirement = a.groupSize > 1
        ? (a.approvalMode === 'any' ? `One approval is enough from ${a.groupSize} approvers.` : `All ${a.groupSize} approvers must approve.`)
        : 'Your decision completes this approval.';

      return <Stack key={a.id} space="space.075">
        <Inline space="space.100" alignBlock="center">
          <Text><Text weight="bold">{a.issueKey}</Text> — {a.summary}</Text>
          <Lozenge appearance="inprogress">Waiting</Lozenge>
        </Inline>
        <Text>{requirement}</Text>

        <Button appearance="subtle" onClick={() => setExpanded((current) => ({ ...current, [a.id]: !current[a.id] }))}>
          {isExpanded ? 'Hide preview' : 'Preview details'}
        </Button>

        {isExpanded ? <Stack space="space.050">
          {a.message ? <Text><Text weight="bold">Approval request:</Text> {a.message}</Text> : <Text>No additional approval message was provided.</Text>}
          {a.ruleName ? <Text><Text weight="bold">Prepared by:</Text> {a.ruleName}</Text> : null}
          {a.createdAt ? <Text><Text weight="bold">Requested:</Text> {new Date(a.createdAt).toLocaleString()}</Text> : null}
          <Text><Text weight="bold">Approval requirement:</Text> {requirement}</Text>
          {a.formSnapshot?.answers?.length ? <Stack space="space.050">
            <Text><Text weight="bold">Submitted form:</Text> {a.formSnapshot.name || 'Request form'}</Text>
            {a.formSnapshot.answers.slice(0, 8).map((row, index) => <Text key={`${a.id}-preview-${index}`}><Text weight="bold">{row.label || row.fieldKey}:</Text> {row.answer || '—'}</Text>)}
            {a.formSnapshot.answers.length > 8 ? <Text>Open My Approvals to review all submitted form details.</Text> : null}
          </Stack> : null}
        </Stack> : null}

        <TextArea
          value={reasons[a.id] || ''}
          onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })}
          placeholder="Optional comment / reason for declining"
        />
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => decide(a.id, 'approved')} isDisabled={busy === a.id}>Approve</Button>
          <Button appearance="danger" onClick={() => decide(a.id, 'declined')} isDisabled={busy === a.id}>Decline</Button>
        </Inline>
      </Stack>;
    })}

    {items.length > 5 ? <Text>Plus {items.length - 5} more waiting request{items.length - 5 === 1 ? '' : 's'} in My Approvals.</Text> : null}
    <Text><Text weight="bold">My Approvals</Text> remains available from your profile menu for full details and previous decisions.</Text>
  </Stack>;
};

ForgeReconciler.render(<PortalSummary />);
