# JSM Forms integration — Smart Approval Manager V1.1

Status: design/proof of concept
Branch: feature/jsm-forms-integration
Release rule: do not merge into the live Marketplace release until QA and work-site acceptance pass.

## Goal

Use Jira Service Management Forms as the form engine and Smart Approval Manager as the approval orchestration layer.

Flow:

JSM request + form -> Smart Approval rule -> agent review -> send -> approver sees selected form answers -> approve/decline -> workflow continues.

Existing Jira-field-only approvals remain unchanged. Forms are optional.

## First real templates

### Vector / vPack — Password Change Request

Source paper form fields:
- Environment: Production and/or UAT
- Company
- Username/account requiring password change
- Manager name
- Manager email
- Reason for password change

Jira/Smart Approval supplies automatically:
- Service Desk ticket number
- Requester
- Requester email
- Date received
- Date approved
- Date password reset/completion

Approval route from the source document:
- line manager approval only
- no Ryanair Head Office approval required

Recommended POC workflow:
Submitted -> approval prepared -> agent sends -> line manager approves/declines -> approved request moves to Ready for Password Reset -> Service Desk completes work.

### Vector / vPack — New User Access Request

Source paper form fields:
- Environment: Production and/or UAT
- Company
- New user name
- New user email
- Role
- Manager
- Required airport/base codes
- Module access: vOMS, vPOS, vWMS, vPLP, Master Control, vPack, vRec, vPreo, Access Control
- Existing Vector username/email to copy access from (optional)

The source document labels vPOS, vPLP, Master Control, vRec, vPreo and Access Control as Ryanair Use only. Do not infer an additional approval route solely from that label; customer approval policy must be confirmed.

Jira/Smart Approval supplies automatically:
- Service Desk ticket number
- Requester identity
- received/sent/decision timestamps
- approver identity
- completion timestamp

## Product changes

### Rule configuration

Add an optional Approval information / Form integration section:

- Approval source:
  - Jira request fields
  - JSM Form
  - Jira fields + JSM Form
- Form selector
- Fields visible to approvers
- Later: form-answer conditions for rule matching

Example future condition:
Form answer -> Environment -> equals -> Production

### Agent panel

When a configured form is present:
- show Form attached / Form ready
- show a compact preview of the fields selected by the rule
- preserve current agent-controlled send behaviour
- never send automatically because a form is submitted or matched

### Customer/approver view

Show a read-only approval summary containing only configured fields, followed by the existing Approve/Decline controls.

### Approval record

Store the form reference/version and an approval-time snapshot of the selected answers with the approval record so the audit history reflects what the approver reviewed. Do not store unrelated form answers.

Future option: downloadable approval record/PDF.

## Technical discovery required before implementation

1. Confirm the supported Forge/JSM API for discovering forms attached to a request and reading answers.
2. Confirm portal-customer access behaviour and app/asUser/asApp permission requirements.
3. Determine whether existing scopes are sufficient; do not broaden scopes without a security review.
4. Confirm form IDs/field IDs are stable enough for rule configuration.
5. Confirm Forms data-residency/privacy implications remain compatible with Runs on Atlassian.
6. Add graceful behaviour when Forms is unavailable or a configured form/field has been removed.

## QA gates

- Existing Jira-field-only approval regression suite remains green.
- Password Change POC works on a controlled work-site request.
- Matching a form never auto-sends an approval.
- Approver sees only fields configured for display.
- Approval/decline records the correct form snapshot.
- Customer A cannot see Customer B form data.
- Removed/changed form fields fail safely.
- No sensitive form answers are written to logs.
- Production Marketplace branch remains untouched until acceptance.

## Release plan

1. API discovery and read-only form preview.
2. Password Change proof of concept.
3. Work-site QA.
4. New User Access template.
5. Form-answer rule conditions.
6. Documentation/security review.
7. V1.1 release candidate and Marketplace production promotion.
