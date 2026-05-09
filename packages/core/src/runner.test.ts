import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ActionTimeoutError,
  ApprovalRequiredError,
  ModeNotAllowedError,
  SchemaValidationError,
  WorkflowExecutionError,
  WorkflowValidationError,
  createRunner,
  fromStep,
} from './index.js';

describe('AgentActionRunner', () => {
  it('registers and executes an action with schema validation', async () => {
    const runner = createRunner({
      createExecutionId: () => 'exec_1',
    });

    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      handler: ({ value }) => ({ value: value * 2 }),
    });

    const result = await runner.executeAction({
      userId: 'user_1',
      action: 'math.double',
      input: { value: 21 },
    });

    expect(result).toEqual({
      executionId: 'exec_1',
      actionName: 'math.double',
      mode: 'read',
      output: { value: 42 },
      approvalId: undefined,
    });
  });

  it('keeps action metadata on registered actions', () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      description: 'Retry approved jobs.',
      tags: ['delivery', 'retry'],
      resourceType: 'deliveryJob',
      riskLevel: 'high',
      deprecated: 'Use delivery.queueRetry for new workflows.',
      examples: [
        {
          title: 'Retry two jobs',
          input: { jobIds: ['job_1', 'job_2'] },
        },
      ],
      handler: () => ({ ok: true }),
    });

    expect(runner.listActions()[0]).toMatchObject({
      name: 'delivery.executeRetry',
      tags: ['delivery', 'retry'],
      resourceType: 'deliveryJob',
      riskLevel: 'high',
      deprecated: 'Use delivery.queueRetry for new workflows.',
      examples: [
        expect.objectContaining({
          title: 'Retry two jobs',
        }),
      ],
    });
  });

  it('executes sequential workflows with restricted step references', async () => {
    let id = 0;
    const runner = createRunner({
      createExecutionId: () => `exec_${++id}`,
    });

    runner.registerAction({
      name: 'delivery.searchJobs',
      mode: 'read',
      inputSchema: z.object({ status: z.array(z.string()) }),
      outputSchema: z.object({ jobIds: z.array(z.string()) }),
      handler: () => ({ jobIds: ['job_1', 'job_2'] }),
    });

    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      inputSchema: z.object({ jobIds: z.array(z.string()) }),
      handler: ({ jobIds }) => ({ retryable: jobIds, blocked: [] }),
    });

    const result = await runner.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'retry-failed-jobs',
        steps: [
          {
            id: 'jobs',
            action: 'delivery.searchJobs',
            input: { status: ['FAILED'] },
          },
          {
            id: 'dryRun',
            action: 'delivery.dryRunRetry',
            input: {
              jobIds: fromStep('jobs', '/jobIds'),
            },
          },
        ],
      },
    });

    expect(result.workflowId).toBe('exec_1');
    expect(result.outputByStep.dryRun).toEqual({
      retryable: ['job_1', 'job_2'],
      blocked: [],
    });
  });

  it('blocks mutate actions unless explicitly allowed', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      handler: () => ({ ok: true }),
    });

    await expect(runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: {},
    })).rejects.toBeInstanceOf(ModeNotAllowedError);
  });

  it('requires approval for mutate actions', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      handler: () => ({ ok: true }),
    });

    await expect(runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: {},
      allowedModes: ['mutate'],
    })).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it('passes approval when the approval hook approves', async () => {
    const runner = createRunner({
      approval: ({ approvalToken }) => (
        approvalToken === 'token_1'
          ? { approved: true, approvalId: 'approval_1' }
          : { approved: false }
      ),
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      approvalRequired: true,
      handler: () => ({ ok: true }),
    });

    const result = await runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: {},
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
    });

    expect(result.approvalId).toBe('approval_1');
  });

  it('passes approval context with a deterministic input hash', async () => {
    const inputHashes: string[] = [];
    const runner = createRunner({
      approval: ({ approvalContext }) => {
        inputHashes.push(approvalContext.inputHash);
        return { approved: true };
      },
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      inputSchema: z.object({
        jobIds: z.array(z.string()),
      }),
      handler: () => ({ ok: true }),
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: { jobIds: ['job_1', 'job_2'] },
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: { jobIds: ['job_1', 'job_2'] },
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: { jobIds: ['job_2'] },
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
    });

    expect(inputHashes[0]).toBe(inputHashes[1]);
    expect(inputHashes[0]).not.toBe(inputHashes[2]);
  });

  it('passes approval context overrides to the approval hook', async () => {
    const runner = createRunner({
      approval: ({ approvalContext }) => (
        approvalContext.resourceIds?.[0] === 'job_1'
        && approvalContext.dryRunHash === 'dry_run_hash'
        && approvalContext.expiresAt === '2026-05-06T00:00:00.000Z'
          ? { approved: true, approvalId: 'approval_1' }
          : { approved: false }
      ),
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      handler: () => ({ ok: true }),
    });

    const result = await runner.executeAction({
      userId: 'user_1',
      action: 'delivery.executeRetry',
      input: { jobIds: ['job_1'] },
      allowedModes: ['mutate'],
      approvalToken: 'token_1',
      approvalContext: {
        resourceIds: ['job_1'],
        dryRunHash: 'dry_run_hash',
        expiresAt: '2026-05-06T00:00:00.000Z',
      },
    });

    expect(result.approvalId).toBe('approval_1');
  });

  it('emits audit events for action execution', async () => {
    const events: string[] = [];
    const fullEvents: unknown[] = [];
    const runner = createRunner({
      audit: (event) => {
        events.push(`${event.actionName}:${event.status}`);
        fullEvents.push(event);
      },
    });

    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      handler: () => ({ value: 2 }),
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'math.double',
      input: {},
    });

    expect(events).toEqual(['math.double:started', 'math.double:succeeded']);
    expect(Object.prototype.hasOwnProperty.call(fullEvents[0] as object, 'approvalTokenHash')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fullEvents[1] as object, 'approvalTokenHash')).toBe(false);
  });

  it('redacts approval tokens from all audit event statuses', async () => {
    const events: Array<Record<string, unknown>> = [];
    const runner = createRunner({
      approval: ({ approvalToken }) => (
        approvalToken === 'raw-secret-token'
          ? { approved: true, approvalId: 'approval_1' }
          : { approved: false }
      ),
      audit: (event) => {
        events.push(event);
      },
    });

    runner.registerAction({
      name: 'admin.disableUser',
      mode: 'mutate',
      approvalRequired: true,
      handler: (input) => {
        if ((input as { fail?: boolean }).fail) {
          throw new Error('mutation failed');
        }

        return { ok: true };
      },
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'admin.disableUser',
      input: { userId: 'target_1' },
      allowedModes: ['mutate'],
      approvalToken: 'raw-secret-token',
    });

    await expect(runner.executeAction({
      userId: 'user_1',
      action: 'admin.disableUser',
      input: { userId: 'target_2', fail: true },
      allowedModes: ['mutate'],
      approvalToken: 'raw-secret-token',
    })).rejects.toThrow('mutation failed');

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('raw-secret-token');
    expect(events.map((event) => event.status)).toEqual(['started', 'succeeded', 'started', 'failed']);
    for (const event of events) {
      expect(event.approvalTokenHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
      expect(Object.prototype.hasOwnProperty.call(event, 'approvalToken')).toBe(false);
    }
    expect(events[1]).toEqual(expect.objectContaining({ approvalId: 'approval_1' }));
    expect(events[3]).toEqual(expect.objectContaining({ error: expect.any(Error) }));
  });

  it('keeps audit input, output, and error payloads full by default', async () => {
    const events: Array<Record<string, unknown>> = [];
    const expectedError = new Error('full failure');
    const runner = createRunner({
      audit: (event) => {
        events.push(event as unknown as Record<string, unknown>);
      },
    });

    runner.registerAction({
      name: 'audit.success',
      mode: 'read',
      handler: (input) => ({
        ok: true,
        input,
      }),
    });
    runner.registerAction({
      name: 'audit.failure',
      mode: 'read',
      handler: () => {
        throw expectedError;
      },
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'audit.success',
      input: {
        email: 'user@example.com',
      },
    });
    await expect(runner.executeAction({
      userId: 'user_1',
      action: 'audit.failure',
      input: {
        reason: 'keep full input',
      },
    })).rejects.toBe(expectedError);

    expect(events[0].input).toEqual({ email: 'user@example.com' });
    expect(events[1].output).toEqual({
      ok: true,
      input: {
        email: 'user@example.com',
      },
    });
    expect(events[2].input).toEqual({ reason: 'keep full input' });
    expect(events[3].error).toBe(expectedError);
  });

  it('applies runner audit defaults for hash input, summary output, and summary error', async () => {
    const events: Array<Record<string, unknown>> = [];
    const runner = createRunner({
      auditDefaults: {
        input: 'hash',
        output: 'summary',
        error: 'summary',
        redactPaths: ['/password', '/items/0/token'],
      },
      audit: (event) => {
        events.push(event as unknown as Record<string, unknown>);
      },
      summarizeOutput: () => 'custom output summary',
    });

    runner.registerAction({
      name: 'audit.safeSuccess',
      mode: 'read',
      handler: () => ({
        email: 'user@example.com',
        token: 'output-token',
      }),
    });
    runner.registerAction({
      name: 'audit.safeFailure',
      mode: 'read',
      handler: () => {
        throw Object.assign(new Error('database password leaked'), {
          detail: {
            password: 'error-secret',
          },
        });
      },
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'audit.safeSuccess',
      input: {
        password: 'input-secret',
        items: [
          {
            token: 'array-token',
          },
        ],
      },
    });
    await expect(runner.executeAction({
      userId: 'user_1',
      action: 'audit.safeFailure',
      input: {
        password: 'input-secret',
      },
    })).rejects.toThrow('database password leaked');

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('input-secret');
    expect(serialized).not.toContain('array-token');
    expect(serialized).not.toContain('output-token');
    expect(serialized).not.toContain('error-secret');
    expect(events[0].input).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.prototype.hasOwnProperty.call(events[1], 'output')).toBe(false);
    expect(events[1].outputSummary).toBe('custom output summary');
    expect(events[3].error).toEqual({
      name: 'Error',
      message: 'database password leaked',
    });
  });

  it('does not serialize full output when summary fallback is used', async () => {
    const events: Array<Record<string, unknown>> = [];
    const runner = createRunner({
      auditDefaults: {
        output: 'summary',
      },
      audit: (event) => {
        events.push(event as unknown as Record<string, unknown>);
      },
    });

    runner.registerAction({
      name: 'audit.defaultSummary',
      mode: 'read',
      handler: () => ({
        token: 'secret-output-token',
        nested: {
          password: 'secret-output-password',
        },
      }),
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'audit.defaultSummary',
      input: {},
    });

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('secret-output-token');
    expect(serialized).not.toContain('secret-output-password');
    expect(events[1].outputSummary).toBe('object');
    expect(Object.prototype.hasOwnProperty.call(events[1], 'output')).toBe(false);
  });

  it('lets action audit policies override defaults and merge redact paths', async () => {
    const events: Array<Record<string, unknown>> = [];
    const runner = createRunner({
      auditDefaults: {
        input: 'hash',
        output: 'full',
        error: 'summary',
        redactPaths: ['/globalSecret'],
      },
      audit: (event) => {
        events.push(event as unknown as Record<string, unknown>);
      },
    });

    runner.registerAction({
      name: 'audit.override',
      mode: 'read',
      auditPolicy: {
        input: 'full',
        output: 'hash',
        error: 'omit',
        redactPaths: ['/localSecret', '/items/0/token'],
      },
      handler: () => ({
        outputSecret: 'do not store',
      }),
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'audit.override',
      input: {
        globalSecret: 'global',
        localSecret: 'local',
        visible: 'kept',
        items: [
          {
            token: 'array-token',
          },
        ],
      },
    });

    expect(events[0].input).toEqual({
      globalSecret: '[REDACTED]',
      localSecret: '[REDACTED]',
      visible: 'kept',
      items: [
        {
          token: '[REDACTED]',
        },
      ],
    });
    expect(events[1].output).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(events)).not.toContain('do not store');
  });

  it('omits audit payload fields when configured', async () => {
    const events: Array<Record<string, unknown>> = [];
    const runner = createRunner({
      auditDefaults: {
        input: 'omit',
        output: 'omit',
        error: 'omit',
      },
      audit: (event) => {
        events.push(event as unknown as Record<string, unknown>);
      },
    });

    runner.registerAction({
      name: 'audit.omitSuccess',
      mode: 'read',
      handler: () => ({
        secret: 'output-secret',
      }),
    });
    runner.registerAction({
      name: 'audit.omitFailure',
      mode: 'read',
      handler: () => {
        throw new Error('secret error');
      },
    });

    await runner.executeAction({
      userId: 'user_1',
      action: 'audit.omitSuccess',
      input: {
        secret: 'input-secret',
      },
    });
    await expect(runner.executeAction({
      userId: 'user_1',
      action: 'audit.omitFailure',
      input: {
        secret: 'failure-input',
      },
    })).rejects.toThrow('secret error');

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('input-secret');
    expect(serialized).not.toContain('output-secret');
    expect(serialized).not.toContain('failure-input');
    expect(serialized).not.toContain('secret error');
    expect(serialized).not.toContain('"input"');
    expect(serialized).not.toContain('"output"');
    expect(serialized).not.toContain('"outputSummary"');
    expect(serialized).not.toContain('"error"');
  });

  it('retries workflow steps until they succeed', async () => {
    let attempts = 0;
    const runner = createRunner({
      createExecutionId: () => `exec_${attempts + 1}`,
    });

    runner.registerAction({
      name: 'unstable.read',
      mode: 'read',
      handler: () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('temporary failure');
        }

        return { ok: true, attempts };
      },
    });

    const result = await runner.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'retry-read',
        steps: [
          {
            id: 'read',
            action: 'unstable.read',
            input: {},
            retry: {
              maxAttempts: 2,
            },
          },
        ],
      },
    });

    expect(result.steps[0]).toMatchObject({
      status: 'succeeded',
      attempts: 2,
      output: { ok: true, attempts: 2 },
    });
  });

  it('fails workflows when retry attempts are exhausted', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'unstable.read',
      mode: 'read',
      handler: () => {
        throw new Error('still failing');
      },
    });

    await expect(runner.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'retry-fails',
        steps: [
          {
            id: 'read',
            action: 'unstable.read',
            input: {},
            retry: {
              maxAttempts: 2,
            },
          },
        ],
      },
    })).rejects.toBeInstanceOf(WorkflowExecutionError);
  });

  it('validates workflow reliability values before executing steps', async () => {
    let calls = 0;
    const runner = createRunner();

    runner.registerAction({
      name: 'unstable.read',
      mode: 'read',
      handler: () => {
        calls += 1;
        return { ok: true };
      },
    });

    await expect(runner.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'invalid-retry',
        steps: [
          {
            id: 'read',
            action: 'unstable.read',
            input: {},
            retry: {
              maxAttempts: 0,
            },
          },
        ],
      },
    })).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: 'invalidRetry',
          path: '/steps/0/retry/maxAttempts',
        }),
      ],
    });
    await expect(runner.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'invalid-timeout',
        steps: [
          {
            id: 'read',
            action: 'unstable.read',
            input: {},
            timeoutMs: -1,
          },
        ],
      },
    })).rejects.toBeInstanceOf(WorkflowValidationError);
    expect(calls).toBe(0);
  });

  it('continues after failed steps when continueOnError is enabled', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'unstable.read',
      mode: 'read',
      handler: () => {
        throw new Error('expected failure');
      },
    });
    runner.registerAction({
      name: 'stable.read',
      mode: 'read',
      handler: () => ({ ok: true }),
    });

    const result = await runner.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'continue-after-error',
        steps: [
          {
            id: 'unstable',
            action: 'unstable.read',
            input: {},
            continueOnError: true,
          },
          {
            id: 'stable',
            action: 'stable.read',
            input: {},
          },
        ],
      },
    });

    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      continued: true,
      error: {
        message: 'expected failure',
      },
    });
    expect(result.outputByStep.stable).toEqual({ ok: true });
  });

  it('times out workflow attempts and emits failed audit attempts', async () => {
    const events: Array<{ attempt?: number; maxAttempts?: number; status: string; error?: unknown }> = [];
    const runner = createRunner({
      audit: (event) => {
        events.push({
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          status: event.status,
          error: event.error,
        });
      },
    });

    runner.registerAction({
      name: 'slow.read',
      mode: 'read',
      handler: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 25);
        });
        return { ok: true };
      },
    });

    try {
      await runner.executeWorkflow({
        userId: 'user_1',
        workflow: {
          workflowName: 'timeout',
          steps: [
            {
              id: 'slow',
              action: 'slow.read',
              input: {},
              timeoutMs: 1,
            },
          ],
        },
      });
      throw new Error('Expected workflow to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowExecutionError);
      expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(ActionTimeoutError);
    }

    expect(events).toEqual([
      expect.objectContaining({ attempt: 1, maxAttempts: 1, status: 'started' }),
      expect.objectContaining({ attempt: 1, maxAttempts: 1, status: 'failed' }),
    ]);
  });

  it('wraps invalid input in a schema validation error', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      inputSchema: z.object({ value: z.number() }),
      handler: ({ value }) => ({ value: value * 2 }),
    });

    await expect(runner.executeAction({
      userId: 'user_1',
      action: 'math.double',
      input: { value: '21' },
    })).rejects.toBeInstanceOf(SchemaValidationError);
  });
});
