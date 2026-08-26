# Smart Approval Manager — Marketplace Release Candidate Test Plan

Use this plan for the frozen v1 release candidate on the Nuvriqo TEST project.

## Critical regression
- Agent panel and project settings load.
- Portal My Approvals loads without individual OAuth consent.
- Single approver approve and decline, including required decline reason.
- Manual reminder, scheduled reminder and cancellation.
- Multiple approvers in ALL mode: group remains pending until all approve; one decline resolves declined.
- Multiple approvers in ANY mode: one approval resolves approved; redundant pending approvals become no-longer-required.
- Customer isolation and repeat-action protection.

## Approval preparation rules
- Matching conditions prepare approvers/message/mode but do **not** send approval automatically.
- Non-matching conditions leave no prepared approval.
- Optional trigger status delays preparation until the ticket reaches the selected status.
- Repeated Jira update events do not create pending approval records because only the agent can send.
- Agent can review/edit prepared values and click Request approval deliberately.
- After send, configured participant/comment/requested-status behaviour runs.
- Rule-specific workflow overrides are respected.

## Workflow actions
- Friendly requested/approved/declined target statuses persist after refresh.
- Requested target status applies only after the agent sends.
- Approved/declined status applies only when the group outcome is final.
- Unavailable transitions record a diagnosable failure without losing the approval decision.

## Configuration safeguards
- Settings are isolated per project.
- Non-project-admin cannot save settings or use protected configuration metadata actions.
- Disabled rules remain stored but do not prepare approvals.

## Release gate
Marketplace submission can proceed when local `npm test` and `forge lint` pass, the development release candidate is regression-tested, no cross-customer exposure is found, production deployment succeeds, and Marketplace documentation/assets/questionnaire are complete.
