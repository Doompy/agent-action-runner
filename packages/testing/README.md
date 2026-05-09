# @agent-action-runner/testing

Framework-neutral test helpers for Agent Action Runner.

Use this package to exercise registered actions, approval hooks, policy hooks, and audit redaction without coupling your tests to Jest, Vitest, or a web framework.

```ts
import {
  approveAll,
  createRunnerHarness,
  findAuditEvents,
} from '@agent-action-runner/testing';

const harness = createRunnerHarness({
  runnerOptions: {
    approval: approveAll(),
    auditDefaults: {
      input: 'hash',
      output: 'summary',
      error: 'summary',
    },
  },
  actions: [disableUserAction],
});

await harness.executeAction({
  userId: 'operator_1',
  action: 'admin.disableUser',
  input: { userId: 'user_1' },
  allowedModes: ['mutate'],
  approvalToken: 'test_token',
});

expect(findAuditEvents(harness.getAuditEvents(), {
  actionName: 'admin.disableUser',
  status: 'succeeded',
})).toHaveLength(1);
```

The package intentionally does not provide Jest/Vitest matchers yet. It exposes plain functions so it can work with any test runner.
