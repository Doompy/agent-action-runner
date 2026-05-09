# @agent-action-runner/opentelemetry

OpenTelemetry instrumentation for Agent Action Runner.

This package wraps a runner instead of deriving spans from audit events. That keeps span lifetime aligned with `executeAction()` and `executeWorkflow()`.

```ts
import { createRunner } from '@agent-action-runner/core';
import { instrumentRunner } from '@agent-action-runner/opentelemetry';

const runner = instrumentRunner(createRunner(), {
  attributes: {
    service: 'admin-api',
  },
});
```

The wrapper records:

- spans: `agent_action.execute`, `agent_workflow.execute`
- counters: `agent_action_started_total`, `agent_action_succeeded_total`, `agent_action_failed_total`, `agent_workflow_started_total`, `agent_workflow_succeeded_total`, `agent_workflow_failed_total`
- histogram: `agent_action_duration_ms`

Action input and output payloads are not written to telemetry attributes.
