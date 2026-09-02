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
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Heading size="large">My Approvals</Heading>
        <Lozenge appearance={pending.length ? 'inprogress' : 'success'}>{pending.length ? `${pending.length} waiting` : 'Up to date'}</Lozenge>
      </Inline>
      <Text>Review requests assigned to you and make a clear approve or decline decision. Every decision is recorded against the Jira request.</Text>
    </Stack>
    {error ? <Text>{error}</Text> : null}

    <Stack space="space.150">
      <Heading size="medium">Needs your attention</Heading>
      {pending.length === 0 ? <Text>You have no approval requests waiting. You are all caught up.</Text> : pending.map((a) =>
        <Stack key={a.id} space="space.100">
          <Inline space="space.100" alignBlock="center">
            <Heading size="small">{a.issueKey}: {a.summary}</Heading>
            <Lozenge appearance="inprogress">Decision required</Lozenge>
          </Inline>
          <Text>Requested {new Date(a.createdAt).toLocaleString()}</Text>
          <Text>{requirementText(a)}</Text>
          {a.ruleName ? <Text><Text weight="bold">Approval rule:</Text> {a.ruleName}</Text> : null}
          {a.message ? <Text><Text weight="bold">Message from the agent:</Text> {a.message}</Text> : null}
          <Text><Text weight="bold">Decision comment</Text> — optional when approving and used as the decline reason when required.</Text>
          <TextArea
            value={reasons[a.id] || ''}
            onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })}
            placeholder="Add a comment or explain why you are declining"
          />
          <Inline space="space.100">
            <Button appearance="primary" onClick={() => decide(a.id, 'approved')} isDisabled={busy === a.id}>Approve request</Button>
            <Button appearance="danger" onClick={() => decide(a.id, 'declined')} isDisabled={busy === a.id}>Decline request</Button>
          </Inline>
        </Stack>
      )}
    </Stack>

    <Stack space="space.150">
      <Heading size="medium">Previous decisions</Heading>
      {history.length === 0 ? <Text>No previous approval decisions yet.</Text> : history.slice(0, 50).map((a) =>
        <Stack key={a.id} space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Text><Text weight="bold">{a.issueKey}</Text> — {a.summary}</Text>
            <Lozenge appearance={a.status === 'approved' ? 'success' : a.status === 'declined' ? 'removed' : 'default'}>{a.status === 'approved' ? 'Approved' : a.status === 'declined' ? 'Declined' : a.status}</Lozenge>
          </Inline>
          <Text>{a.decidedAt ? new Date(a.decidedAt).toLocaleString() : new Date(a.updatedAt).toLocaleString()}{a.decisionReason ? ` · ${a.decisionReason}` : ''}</Text>
          {a.groupSize > 1 ? <Text>{a.approvalMode === 'any' ? 'Any-one approval group' : 'All-approvers group'} · {a.groupSize} approvers</Text> : null}
        </Stack>
      )}
    </Stack>
  </Stack>;
};

ForgeReconciler.render(<PortalApprovals />);
