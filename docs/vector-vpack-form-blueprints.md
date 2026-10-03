# Vector / vPack Forms – V1.1 build specification

These are native Jira Service Management Forms. Smart Approval does not replace the portal form UI.

## 1. Change Password Request Form

Source: Vector / vPack Change Password Request Form, version 1.0 (04/05/2022).

### Customer-completed section
- Environment — single choice: Production / UAT — required
- Company — short text — required
- Vector / vPack username — short text — required
- Reason for password change — long text — required
- Manager name — short text — required
- Manager email address — email/text — required

### Electronic approval record
Dedicated fields are included for Smart Approval to populate:
- Approved by
- Date approved
- Decision
- Approval comment

The paper Manager signature is replaced by the authenticated Smart Approval portal decision.

### Jira/system metadata
Do not ask the customer to type:
- Service Desk ticket number
- Requester name
- Requester email
- Date request received
- Date password reset

These are Jira/workflow metadata or completion data.

### Approval route
Line Manager only. The source form explicitly says password changes do not require Ryanair Head Office approval.

## 2. New User Access Request Form

Source: Vector / vPack New User Access Request Form, version 1.0 (04/05/2022).

### Customer-completed section
- Environment — Production / UAT
- Company
- New user name
- New user email address
- Role of new user
- Manager name
- Manager email (electronic workflow addition)
- Bases / warehouses required — airport/base codes
- Module access — vOMS, vPOS, vWMS, vPLP, Master Control, vPack, vRec, vPreo, Access Control
- Copy access from existing user? — Yes / No
- Existing Vector username or email — conditional when copy access = Yes

Preserve the source labels that vPOS, vPLP, Master Control, vRec, vPreo and Access Control are Ryanair Use only.

### Electronic approval record
- Approved by
- Date approved
- Decision
- Approval comment

### Jira/system metadata
Automate rather than customer-enter:
- Service Desk ticket number
- Requester name
- Requester email
- Date request received
- Date sent for approval
- Date approved
- Approver identity
- Date account created

### Approval route
Manager approval is supported. Any later Ryanair approval stage remains unconfigured until the exact business rule is confirmed and sequential approval chains are deliberately implemented.

## Smart Approval behavior
1. Customer completes the native JSM Form in the portal.
2. Matching rule prepares approvers but never sends automatically.
3. Agent reviews the prepared approval and selected form answers.
4. Agent sends the approval.
5. Smart Approval stores a frozen snapshot of only the configured approver-visible answers.
6. Approver reviews the snapshot and decides in the portal.
7. Smart Approval records approver identity, decision, timestamp and optional comment.
8. Where dedicated audit fields are mapped, Smart Approval attempts to write those values back to the same JSM Form instance.
9. The approval record remains authoritative if Jira Forms rejects write-back (for example because the form is locked).

## Production safety
Do not publish either template to a live portal request type until the correct request type is identified and the controlled Password Change POC has passed.
