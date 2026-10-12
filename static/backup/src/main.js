import { invoke } from '@forge/bridge';
import { collectBackup, saveBackupFile, parseBackup, restoreBackup } from './backupClient.js';

// Backup & restore admin page (Custom UI, so the browser can save and read files).
const APP = 'Smart Approval Manager';
const FILE_PREFIX = 'nuvriqo-smart-approval-manager';
const root = document.getElementById('app');
let pending = null;
let busy = false;
let message = { kind: '', text: '' };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  root.innerHTML = `<h1>${esc(APP)}: backup &amp; restore</h1>
    <p class="muted">Download everything ${esc(APP)} stores on this site (settings and data) as one file, or restore a backup, for example to move to another installation of the app. Only Jira administrators can use this page. Passwords and API keys are never included.</p>
    <p><button class="primary" data-download ${busy ? 'disabled' : ''}>Download backup</button></p>
    <h2>Restore</h2>
    <p class="muted">Restoring writes every record in the backup and replaces records with the same key. Records that are not in the backup are kept.</p>
    <input type="file" accept="application/json,.json" data-file ${busy ? 'disabled' : ''}>
    ${pending ? `<p><strong>${esc(pending.name)}</strong>: ${pending.backup.items.length.toLocaleString()} records${pending.backup.app ? ` from ${esc(pending.backup.app)}` : ''}, made ${esc(new Date(pending.backup.createdAt).toLocaleString())}.</p>
      <p><button class="primary" data-restore ${busy ? 'disabled' : ''}>Restore this backup</button> <button data-cancel ${busy ? 'disabled' : ''}>Cancel</button></p>` : ''}
    ${message.text ? `<div class="notice ${message.kind}" role="${message.kind === 'error' ? 'alert' : 'status'}">${esc(message.text)}</div>` : ''}`;
  root.querySelector('[data-download]')?.addEventListener('click', () => run(async () => {
    show('', 'Reading app data…');
    const backup = await collectBackup(invoke, { app: APP, onProgress: (n) => show('', `Reading app data… ${n.toLocaleString()} records`) });
    saveBackupFile(backup, FILE_PREFIX);
    message = { kind: 'success', text: `Backup downloaded: ${backup.count.toLocaleString()} records.` };
  }));
  root.querySelector('[data-file]')?.addEventListener('change', (event) => run(async () => {
    pending = null;
    const file = event.target.files?.[0];
    if (file) pending = { name: file.name, backup: parseBackup(await file.text()) };
    message = { kind: '', text: '' };
  }));
  root.querySelector('[data-restore]')?.addEventListener('click', () => run(async () => {
    const totals = await restoreBackup(invoke, pending.backup, { onProgress: (done, total) => show('', `Restoring… ${done.toLocaleString()} of ${total.toLocaleString()}`) });
    pending = null;
    message = totals.failed.length
      ? { kind: 'error', text: `Restored ${totals.restored.toLocaleString()} records; ${totals.failed.length} could not be written. Restore again to retry them.` }
      : { kind: 'success', text: `Restore finished: ${totals.restored.toLocaleString()} records restored${totals.skipped ? `, ${totals.skipped.toLocaleString()} skipped` : ''}.` };
  }));
  root.querySelector('[data-cancel]')?.addEventListener('click', () => { pending = null; render(); });
}

function show(kind, text) { message = { kind, text }; render(); }

async function run(work) {
  busy = true; render();
  try { await work(); } catch (error) { message = { kind: 'error', text: error?.message || String(error) }; }
  busy = false; render();
}

render();
