import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Lozenge, Spinner, Stack, Text, TextArea } from '@forge/react';
import { invoke } from '@forge/bridge';

const PortalSummary = () => {
  const [items, setItems] = useState(null);
  const [reasons, setReasons] = useState({});
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
    <Text>Review and decide directly here, or open My Approvals for the full approval history.</Text>
    {error ? <Text>{error}</Text> : null}

    {items.slice(0, 5).map((a) =>
      <Stack key={a.id} space="space.075">
        <Inline space="space.100" alignBlock="center">
          <Text><Text weight="bold">{a.issueKey}</Text> — {a.summary}</Text>
          <Lozenge appearance="inprogress">Waiting</Lozenge>
        </Inline>
        <Text>{a.groupSize > 1 ? (a.approvalMode === 'any' ? 'One approver is enough' : `All ${a.groupSize} approvers must approve`) : 'Your decision completes this approval'}</Text>
        {a.message ? <Text>Approval request: {a.message}</Text> : null}
        <TextArea
          value={reasons[a.id] || ''}
          onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })}
          placeholder="Optional comment / reason for declining"
        />
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => decide(a.id, 'approved')} isDisabled={busy === a.id}>Approve</Button>
          <Button appearance="danger" onClick={() => decide(a.id, 'declined')} isDisabled={busy === a.id}>Decline</Button>
        </Inline>
      </Stack>
    )}

    {items.length > 5 ? <Text>Plus {items.length - 5} more waiting request{items.length - 5 === 1 ? '' : 's'} in My Approvals.</Text> : null}
    <Text><Text weight="bold">My Approvals</Text> remains available from your profile menu for full details and previous decisions.</Text>
  </Stack>;
};

ForgeReconciler.render(<PortalSummary />);
