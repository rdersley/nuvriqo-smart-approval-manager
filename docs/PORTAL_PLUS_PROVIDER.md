# Portal+ provider contract

Smart Approval Manager exposes customer-safe approval state to Nuvriqo Portal+ through a versioned issue-property snapshot. Portal+ can read the property only for requests it has already determined are visible to the signed-in customer.

Property key: `nuvriqo.smart-approval.portal`

The snapshot contains no display names, email addresses, comments, decline reasons or other free text. It contains only the issue key, provider/contract version, updated time and approval rows with approval id, approver accountId and status. Portal+ filters rows to the current customer account before rendering an Approvals module.

This keeps Smart Approval Manager independently installable while allowing Portal+ to become the unified customer-facing shell when both products are present.
