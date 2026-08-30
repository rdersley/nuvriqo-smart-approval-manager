import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Inline, Lozenge, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

const PortalSummary = () => {
  const [items, setItems] = useState(null);
  useEffect(() => { invoke('getMyApprovals', { status: 'pending' }).then(setItems).catch(() => setItems([])); }, []);
  if (items === null) return <Spinner />;

  if (items.length === 0) return <Stack space="space.100">
    <Inline space="space.100" alignBlock="center">
      <Heading size="small">Approvals</Heading>
      <Lozenge appearance="success">Up to date</Lozenge>
    </Inline>
    <Text>You have no approval requests waiting for your decision.</Text>
  </Stack>;

  return <Stack space="space.150">
    <Inline space="space.100" alignBlock="center">
      <Heading size="small">Approvals needing your attention</Heading>
      <Lozenge appearance="inprogress">{items.length} waiting</Lozenge>
    </Inline>
    <Text>These requests are waiting for your approval or decline.</Text>
    {items.slice(0, 5).map((a) =>
      <Stack key={a.id} space="space.025">
        <Text><Text weight="bold">{a.issueKey}</Text> — {a.summary}</Text>
        <Text>{a.groupSize > 1 ? (a.approvalMode === 'any' ? 'One approver is enough' : `All ${a.groupSize} approvers must approve`) : 'Your decision completes this approval'}</Text>
      </Stack>
    )}
    {items.length > 5 ? <Text>Plus {items.length - 5} more waiting request{items.length - 5 === 1 ? '' : 's'}.</Text> : null}
    <Text>Open <Text weight="bold">My Approvals</Text> from your profile menu to review the details and make a decision.</Text>
  </Stack>;
};

ForgeReconciler.render(<PortalSummary />);
