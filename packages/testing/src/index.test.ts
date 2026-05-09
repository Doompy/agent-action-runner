import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApprovalRequiredError,
  PolicyRejectedError,
  type ActionExecutionEvent,
} from '@agent-action-runner/core';
import {
  allowAll,
  approveAll,
  auditEventsContainText,
  createRunnerHarness,
  findAuditEvents,
  rejectApproval,
  rejectPolicy,
} from './index.js';

describe('@agent-action-runner/testing', () => {
  it('executes actions and captures audit events', async () => {
    const harness = createRunnerHarness({
      actions: [
        {
          name: 'math.double',
          mode: 'read',
          inputSchema: z.object({ value: z.number() }),
          handler: (input) => ({ value: (input as { value: number }).value * 2 }),
        },
      ],
    });

    const result = await harness.executeAction({
      userId: 'user_1',
      action: 'math.double',
      input: { value: 2 },
    });

    expect(result.output).toEqual({ value: 4 });
    expect(findAuditEvents(harness.getAuditEvents(), {
      actionName: 'math.double',
      status: 'succeeded',
    })).toHaveLength(1);
  });

  it('provides approval and policy helpers', async () => {
    const approved = createRunnerHarness({
      runnerOptions: {
        approval: approveAll('approval_test'),
        policy: allowAll(),
      },
      actions: [
        {
          name: 'admin.disableUser',
          mode: 'mutate',
          approvalRequired: true,
          handler: () => ({ ok: true }),
        },
      ],
    });

    await expect(approved.executeAction({
      userId: 'user_1',
      action: 'admin.disableUser',
      input: {},
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
    })).resolves.toMatchObject({
      approvalId: 'approval_test',
    });

    const rejectedApproval = createRunnerHarness({
      runnerOptions: {
        approval: rejectApproval('no'),
      },
      actions: [
        {
          name: 'admin.disableUser',
          mode: 'mutate',
          approvalRequired: true,
          handler: () => ({ ok: true }),
        },
      ],
    });

    await expect(rejectedApproval.executeAction({
      userId: 'user_1',
      action: 'admin.disableUser',
      input: {},
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
    })).rejects.toBeInstanceOf(ApprovalRequiredError);

    const rejectedPolicy = createRunnerHarness({
      runnerOptions: {
        policy: rejectPolicy('blocked'),
      },
      actions: [
        {
          name: 'math.double',
          mode: 'read',
          handler: () => ({ ok: true }),
        },
      ],
    });

    await expect(rejectedPolicy.executeAction({
      userId: 'user_1',
      action: 'math.double',
      input: {},
    })).rejects.toBeInstanceOf(PolicyRejectedError);
  });

  it('helps check serialized audit contents', async () => {
    const harness = createRunnerHarness({
      runnerOptions: {
        auditDefaults: {
          input: 'hash',
        },
      },
      actions: [
        {
          name: 'admin.searchUsers',
          mode: 'read',
          handler: () => ({ ok: true }),
        },
      ],
    });

    await harness.executeAction({
      userId: 'user_1',
      action: 'admin.searchUsers',
      input: {
        password: 'secret-password',
      },
    });

    expect(auditEventsContainText(harness.getAuditEvents(), 'secret-password')).toBe(false);
    expect(auditEventsContainText(harness.getAuditEvents(), 'admin.searchUsers')).toBe(true);

    harness.clearAuditEvents();
    expect(harness.getAuditEvents()).toHaveLength(0);
  });

  it('checks audit text with circular-safe serialization', () => {
    const payload: Record<string, unknown> = {
      note: 'visible-marker',
      error: new Error('safe-error-message'),
    };
    payload.self = payload;

    const events: ActionExecutionEvent[] = [
      {
        executionId: 'exec_1',
        userId: 'user_1',
        actionName: 'admin.searchUsers',
        mode: 'read',
        status: 'started',
        input: payload,
        createdAt: new Date(),
      },
    ];

    expect(auditEventsContainText(events, 'visible-marker')).toBe(true);
    expect(auditEventsContainText(events, 'safe-error-message')).toBe(true);
    expect(auditEventsContainText(events, 'missing-secret')).toBe(false);
  });
});
