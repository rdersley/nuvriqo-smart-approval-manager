import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Lozenge, Spinner, Stack, Text, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';

// Shown on a customer's request in the portal when its approval rule needs a
// separate form for each user account. Customers cannot add forms in JSM
// themselves, so this adds another copy of the form for the next account.
const AccountForms = () => {
  const context = useProductContext();
  const issueKey = context?.extension?.request?.key || context?.extension?.issue?.key;
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!issueKey) return;
    try { setStatus(await invoke('getAccountForms', { issueKey })); }
    catch (e) { setStatus({ enabled: false }); setError(e.message || String(e)); }
  };
  useEffect(() => { refresh(); }, [issueKey]);

  const addForm = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await invoke('addAccountForm', { issueKey });
      setMessage(`Form ${result.number} added. Refresh the page to see it under Forms, then complete and submit it.`);
      await refresh();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  if (!issueKey) return null;
  if (status === null) return <Spinner />;
  if (!status.enabled) return null;

  return <Stack space="space.100">
    <Inline space="space.100" alignBlock="center">
      <Heading size="small">One form per account</Heading>
      <Lozenge appearance={status.submitted === status.count ? 'success' : 'inprogress'}>{status.submitted} of {status.count} submitted</Lozenge>
    </Inline>
    <Text>Each user account on this request needs its own form, and each form is approved separately. Complete one form per account. If this request covers more accounts than there are forms, add another form for each extra account.</Text>
    {status.canAdd
      ? <Button onClick={addForm} isDisabled={busy}>Add a form for another account</Button>
      : <Text>This request has the maximum of {status.max} account forms.</Text>}
    {message ? <Text>{message}</Text> : null}
    {error ? <Text>{error}</Text> : null}
  </Stack>;
};

ForgeReconciler.render(<AccountForms />);
