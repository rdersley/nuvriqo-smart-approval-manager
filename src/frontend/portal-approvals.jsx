import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Lozenge, Spinner, Stack, Text, TextArea } from '@forge/react';
import { invoke } from '@forge/bridge';

const PortalApprovals = () => {
  const [items, setItems] = useState(null);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = () => invoke('getMyApprovals', {}).then(setItems).catch((e) => { setError(e.message || String(e)); setItems([]); });
  useEffect(() => { refresh(); }, []);

  const decide = async (approvalId, decision) => {
    setBusy(approvalId); setError('');
    try {
      await invoke('decideApproval', { approvalId, decision, reason: reasons[approvalId] || '' });
      await refresh();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(''); }
  };

  if (items === null) return <Spinner />;
  const pending = items.filter((x) => x.status === 'pending');
  const history = items.filter((x) => x.status !== 'pending');
  const requirementText = (a) => {
    if (!a.groupSize || a.groupSize <= 1) return 'Your decision will complete this approval.';
    return a.approvalMode === 'any'
      ? `One approval is enough. ${a.groupSize} approvers were asked.`
      : `All ${a.groupSize} approvers must approve before the request is fully approved.`;
  };

  return <Stack space="space.300">
    <Heading size="large">My Approvals</Heading>
    <Text>Review requests assigned to you. Your decision is recorded against the Jira ticket with a full audit history.</Text>
    {error ? <Text>{error}</Text> : null}

    <Heading size="medium">Awaiting my approval ({pending.length})</Heading>
    {pending.length === 0 ? <Text>Nothing is waiting for you.</Text> : pending.map((a) =>
      <Stack key={a.id} space="space.100">
        <Inline space="space.100" alignBlock="center"><Heading size="small">{a.issueKey}: {a.summary}</Heading><Lozenge appearance="inprogress">Waiting</Lozenge></Inline>
        <Text>Requested {new Date(a.createdAt).toLocaleString()}</Text>
        <Text>{requirementText(a)}</Text>
        {a.ruleName ? <Text>Approval rule: {a.ruleName}</Text> : null}
        {a.message ? <Text>Message: {a.message}</Text> : null}
        <TextArea
          value={reasons[a.id] || ''}
          onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })}
          placeholder="Decision comment / decline reason"
        />
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => decide(a.id, 'approved')} isDisabled={busy === a.id}>Approve</Button>
          <Button appearance="danger" onClick={() => decide(a.id, 'declined')} isDisabled={busy === a.id}>Decline</Button>
        </Inline>
      </Stack>
    )}

    <Heading size="medium">Approval history</Heading>
    {history.length === 0 ? <Text>No previous decisions yet.</Text> : history.slice(0, 50).map((a) =>
      <Stack key={a.id} space="space.050">
        <Inline space="space.100" alignBlock="center">
          <Text><Text weight="bold">{a.issueKey}</Text> — {a.summary}</Text>
          <Lozenge appearance={a.status === 'approved' ? 'success' : a.status === 'declined' ? 'removed' : 'default'}>{a.status}</Lozenge>
        </Inline>
        <Text>{a.decidedAt ? new Date(a.decidedAt).toLocaleString() : new Date(a.updatedAt).toLocaleString()}{a.decisionReason ? ` · ${a.decisionReason}` : ''}</Text>
        {a.groupSize > 1 ? <Text>{a.approvalMode === 'any' ? 'Any-one approval group' : 'All-approvers group'} · {a.groupSize} approvers</Text> : null}
      </Stack>
    )}
  </Stack>;
};

ForgeReconciler.render(<PortalApprovals />);
