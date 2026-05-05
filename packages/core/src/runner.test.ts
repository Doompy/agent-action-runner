import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApprovalRequiredError,
  ModeNotAllowedError,
  SchemaValidationError,
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
    const runner = createRunner({
      audit: (event) => {
        events.push(`${event.actionName}:${event.status}`);
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
