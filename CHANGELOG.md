# Changelog

## 1.0.0 - Marketplace release candidate

### Added
- Jira issue panel for requesting customer approvals.
- Approver search and multi-select.
- Optional approval message.
- Grouped multi-approver approvals.
- **All approvers must approve** and **Any one approver can approve** modes.
- Duplicate pending-approval protection per approver/request.
- Customer portal **My Approvals** summary and inbox.
- Consent-free Smart Approval customer portal resolver.
- Approve and decline actions with decision comments.
- Configurable required decline reason.
- Pending, approved, declined, cancelled and no-longer-required approval states.
- Group approval progress and audit events.
- Manual reminder action and hourly automatic reminder processing.
- Approval cancellation.
- Optional automatic addition of approvers as JSM request participants.
- Friendly Jira status mappings for requested, approved and declined workflow actions.
- Approval preparation rules triggered by Jira issue-created / issue-updated events.
- Optional status-stage trigger before a matching rule prepares an approval.
- Rule conditions using Jira and custom fields.
- Guided visual rule builder for project administrators.
- Per-rule approver lists, approval mode, messages, reminders and workflow overrides.
- Agent-controlled send: preparation rules never send an approval automatically.
- Per-project administration settings.
- Persistent Forge KVS audit trail.
- Server-side permission, project-admin and approver validation.
- Marketplace, privacy/security and consolidated QA documentation.

### Proven in TEST
- Agent can request approval from a Jira issue.
- Assigned customer sees the approval in the JSM portal.
- Customer can approve without granting Smart Approval Manager individual OAuth consent.
- Decision is stored in approval history and written back to Jira with an audit comment.
- Matching rules can pre-populate approvers without automatically sending an approval.
- Approval preparation can be held until a configured Jira status is reached.
- Friendly workflow status selection works on the TEST project.
- Remote Forge QA passes for the frozen release candidate.

### Final release gate
- Complete consolidated decline / reminder / cancellation regression tests.
- Complete multi-approver **all** and **any** tests.
- Complete rule positive/negative/duplicate-event tests.
- Validate final workflow actions.
- Run `npm test` and `forge lint` with zero errors.
- Deploy release candidate and capture Marketplace screenshots.
- Complete Atlassian Marketplace security/privacy questionnaire.
