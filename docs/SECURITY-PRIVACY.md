# Security and Privacy Notes

## Hosting and data flow
Smart Approval Manager is a Forge-hosted app. Approval data, project configuration and temporary rule-prepared approval suggestions are stored in Atlassian Forge Key-Value Store for the app installation. V1 does not require an external application server, external database, analytics service or advertising tracker.

## Approval data stored
For each approval the app stores the approval ID; Jira issue/project identifiers; issue summary/status captured when requested; approver Atlassian account ID/display name; requesting account ID; optional message; decision status/reason; timestamps; reminder data; audit events; and optional workflow outcome/error. Prepared rules additionally store the matching rule identity and preselected approvers until an agent sends the approval or the preparation is replaced/cleared.

## Access controls
- Agent functions are exposed through Jira agent/project modules.
- Portal decisions validate the current Forge invocation `accountId` against the assigned approver before accepting a decision.
- Portal list queries are keyed by the current approver account ID.
- Approval decisions are rejected after the approval is no longer pending.
- Project settings and metadata actions require Jira project-administrator permission.
- Jira/JSM API calls use Forge authentication and declared scopes.
- When enabled, the approver is added as a JSM request participant only after the agent explicitly sends the approval.

## Data minimisation
The app stores the ticket summary rather than a full copy of Jira request content. Attachments and full comment histories are not copied into app storage.

## Retention
V1 keeps approval records for audit/history until app installation data is removed. A configurable retention/purge policy is a candidate enhancement.

## External transfers
V1 is designed with no external data transfer. Future third-party messaging or analytics would require updated privacy documentation and Forge egress permissions before release.

## Security test cases
- Customer A cannot list or decide Customer B approvals.
- A decided/cancelled/no-longer-required approval cannot be decided again.
- Workflow failure does not undo a recorded customer decision and is retained for diagnosis.
- Preparation rules do not add participants, send comments, create pending approval records or transition Jira until an agent clicks Request approval.
