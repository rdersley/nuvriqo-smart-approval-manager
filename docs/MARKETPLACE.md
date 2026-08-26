# Marketplace Readiness Pack

## Product name
Nuvriqo Smart Approval Manager for Jira Service Management

## One-line summary
Make customer approvals simple with an agent-side request panel, a dedicated portal approval inbox, smart approver preparation rules and flexible Jira workflow actions.

## Short description
Smart Approval Manager gives JSM teams a simple approval experience from both sides of the service desk. Agents request approval directly from a Jira ticket, customers see every decision waiting for them in My Approvals, and administrators can pre-populate the right approvers and workflow behaviour with project-level rules while keeping the agent in control of sending.

## Marketplace description
Approvals should be easy for the person requesting them and effortless for the person making the decision.

Nuvriqo Smart Approval Manager adds a focused approval experience to Jira Service Management. Agents can request approval directly from the issue, select one or more approvers, add a message, send reminders and track the result without leaving the ticket.

Customer approvers get a dedicated My Approvals area in the JSM portal. They can see requests waiting for them, review the approval message, approve or decline, add a decision comment and view their approval history.

For repeatable workflows, project administrators create approval preparation rules. Rules can match Jira fields or custom fields, preselect one or more approvers, choose whether all approvers or any one approver is sufficient, and optionally wait until the ticket reaches a selected status. The agent reviews the prepared approval and deliberately clicks Request approval before anything is sent to the customer.

### Key features
- Request approval directly from the Jira issue view
- Select one or multiple approvers
- Choose **All approvers must approve** or **Any one approver can approve**
- Customer portal **My Approvals** inbox
- Clear Approve and Decline actions
- Optional decision comments and configurable required decline reasons
- Approval preparation rules based on Jira/custom field conditions
- Optional workflow-status trigger for preparation
- Agent remains in control of sending every approval
- Visual rule builder in project settings
- Automatic or manual reminders
- Cancel pending approvals
- Group approval progress and audit history
- Friendly Jira status actions when requested / approved / declined
- Rule-specific workflow overrides
- Automatic request-participant addition after agent sends
- Per-project configuration
- Forge-hosted compute and storage; no external app server required

## Suggested categories / keywords
Jira Service Management, approvals, customer portal, workflow, approval automation, approval reminders, approver, multi approver, JSM, request approval

## Launch positioning
**Simple customer approvals for Jira Service Management.**

Lead with ease of use, portal visibility, controlled automation and quick setup rather than positioning the app as a heavyweight enterprise BPM suite. Strong use cases include customer/client sign-off, hardware replacement approval, access approval, purchasing approval and other service workflows where approvers should not need to understand Jira.

## Screenshot plan
1. Agent issue panel — rule-prepared approval waiting for agent review
2. Agent selecting multiple approvers
3. Agent pending approval with group progress and reminder controls
4. Customer Help Center — My Approvals summary
5. Customer My Approvals inbox
6. Customer Approve / Decline decision screen
7. Agent approval history after decision
8. Project settings — friendly workflow actions
9. Project settings — approval preparation rule with status trigger

## Pre-submission checklist
- [x] Forge app registered with dedicated app ID
- [x] Installed on Nuvriqo Jira test site
- [x] Agent happy-path approval request tested
- [x] Customer approval through portal tested
- [x] Consent-free Smart Approval customer portal flow tested
- [x] Decision written back to Jira and audit comment confirmed
- [x] Rule-prepared approvers remain agent-controlled until Request approval is clicked
- [x] Status-triggered approval preparation tested on TEST
- [x] Friendly workflow status selectors tested
- [x] Remote Forge QA passed on frozen v1 release candidate
- [ ] Complete customer decline + required-reason test
- [ ] Test manual and scheduled reminders
- [ ] Test cancellation
- [ ] Test multiple approvers — all must approve
- [ ] Test multiple approvers — any one can approve
- [ ] Verify rule non-match and duplicate-event behaviour
- [ ] Verify one customer cannot see another customer's approval
- [ ] Verify decided/cancelled approvals cannot be actioned twice
- [ ] Run final local `npm test` and `forge lint`
- [ ] Deploy release candidate to production environment
- [ ] Capture final Marketplace screenshots
- [ ] Complete Atlassian security/privacy questionnaire
- [ ] Confirm final requested scopes match implementation
- [x] Dedicated Smart Approval Manager GitHub repository created
- [ ] Tag `v1.0.0`
- [ ] Create Marketplace listing and upload assets

## Security and data handling
- Built on Atlassian Forge.
- Approval records and prepared suggestions are stored in Forge-hosted storage.
- Portal decisions are authorised against the assigned Atlassian account ID.
- Jira-side comments and workflow transitions are performed by the app after the decision/request is authorised.
- Project configuration is restricted to Jira project administrators.
- No external application server is required for V1.

## V1 boundaries
- Smart Approval Manager maintains its own approval records rather than using Atlassian native JSM approval endpoints.
- Approver search depends on Jira user-search visibility for the acting agent/admin.
- Automatic reminders run hourly, so delivery timing is approximate.
- Rules prepare approvals from Jira product events; event delivery may not be instant.
- Forge cannot forcibly pop the issue panel open on a status change; status-triggered rules prepare the approval for the agent to review in Smart Approval.
- Sequential multi-stage approval chains, out-of-office delegation and advanced analytics remain candidates for later releases.
