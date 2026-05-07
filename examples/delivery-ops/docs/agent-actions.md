# Delivery Ops Agent Actions

Generated-style action documentation for the delivery ops example.

## Actions

### `delivery.searchJobs`

- Mode: `read`
- Risk: `low`
- Resource: `deliveryJob`
- Tags: `delivery`, `operations`
- Approval required: no
- Description: Search delivery jobs by status, campaign, and retryability.

Use this action for broad filtered reads. It returns matching jobs and a compact `jobIds` list for later workflow steps.

### `delivery.dryRunRetry`

- Mode: `dryRun`
- Risk: `medium`
- Resource: `deliveryJob`
- Tags: `delivery`, `retry`, `approval`
- Approval required: no
- Description: Preview retry eligibility and impact for delivery jobs.

Use this action before any retry mutation. It returns `retryableJobIds`, `blockedJobIds`, `resourceIds`, `dryRunHash`, and an impact summary.

### `delivery.executeRetry`

- Mode: `mutate`
- Risk: `high`
- Resource: `deliveryJob`
- Tags: `delivery`, `retry`
- Approval required: yes
- Description: Queue approved retryable delivery jobs for retry.

This action is intentionally narrow. It requires explicit mutate mode allowance and a valid approval token bound to the current mutation input and dry-run result.
