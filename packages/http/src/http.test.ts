import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ActionNotFoundError,
  ActionTimeoutError,
  ModeNotAllowedError,
  SchemaValidationError,
  WorkflowExecutionError,
  WorkflowValidationError,
  createRunner,
} from '@agent-action-runner/core';
import {
  createActionListResponse,
  executeHttpAction,
  executeHttpWorkflow,
  mapAgentRunnerError,
} from './index.js';

describe('@agent-action-runner/http', () => {
  it('lists actions without serializing schemas or handlers', () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.searchJobs',
      mode: 'read',
      description: 'Search delivery jobs.',
      tags: ['delivery'],
      resourceType: 'deliveryJob',
      riskLevel: 'low',
      examples: [
        {
          title: 'Search failed jobs',
          input: { status: ['FAILED'] },
        },
      ],
      inputSchema: z.object({ status: z.array(z.string()) }),
      handler: () => ({ jobIds: [] }),
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      inputSchema: z.object({ jobIds: z.array(z.string()) }),
      handler: () => ({ ok: true }),
    });

    expect(createActionListResponse(runner)).toEqual({
      ok: true,
      actions: [
        {
          name: 'delivery.searchJobs',
          mode: 'read',
          description: 'Search delivery jobs.',
          approvalRequired: false,
          tags: ['delivery'],
          resourceType: 'deliveryJob',
          riskLevel: 'low',
          deprecated: undefined,
          examples: [
            {
              title: 'Search failed jobs',
              input: { status: ['FAILED'] },
            },
          ],
        },
        {
          name: 'delivery.executeRetry',
          mode: 'mutate',
          description: undefined,
          approvalRequired: true,
        },
      ],
    });
  });

  it('executes actions with server-resolved context', async () => {
    const seen: unknown[] = [];
    const runner = createRunner({
      approval: ({ approvalToken, approvalContext }) => {
        seen.push({ approvalToken, approvalContext });
        return approvalToken === 'server-token'
          && approvalContext.resourceIds?.[0] === 'job_1'
          ? { approved: true, approvalId: 'approval_1' }
          : { approved: false };
      },
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      inputSchema: z.object({ jobIds: z.array(z.string()) }),
      handler: (input, context) => ({
        retried: input.jobIds.length,
        userId: context.userId,
        metadata: context.metadata,
      }),
    });

    const response = await executeHttpAction(
      runner,
      'delivery.executeRetry',
      {
        input: { jobIds: ['job_1'] },
        allowedModes: ['read'],
        approvalToken: 'client-token',
      },
      {
        userId: 'user_1',
        allowedModes: ['mutate'],
        approvalToken: 'server-token',
        approvalContext: { resourceIds: ['job_1'] },
        metadata: { requestId: 'req_1' },
      },
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      actionName: 'delivery.executeRetry',
      output: {
        retried: 1,
        userId: 'user_1',
        metadata: { requestId: 'req_1' },
      },
      approvalId: 'approval_1',
    });
    expect(seen).toHaveLength(1);
  });

  it('ignores client execution options by default', async () => {
    const runner = createRunner({
      approval: ({ approvalToken }) => (
        approvalToken === 'client-token'
          ? { approved: true }
          : { approved: false }
      ),
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      handler: () => ({ ok: true }),
    });

    await expect(executeHttpAction(
      runner,
      'delivery.executeRetry',
      {
        input: {},
        allowedModes: ['mutate'],
        approvalToken: 'client-token',
      },
      {
        userId: 'user_1',
      },
    )).rejects.toBeInstanceOf(ModeNotAllowedError);
  });

  it('passes client execution options only when explicitly enabled', async () => {
    const runner = createRunner({
      approval: ({ approvalToken }) => (
        approvalToken === 'client-token'
          ? { approved: true }
          : { approved: false }
      ),
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      handler: () => ({ ok: true }),
    });

    const response = await executeHttpAction(
      runner,
      'delivery.executeRetry',
      {
        input: {},
        allowedModes: ['mutate'],
        approvalToken: 'client-token',
      },
      {
        userId: 'user_1',
        allowClientExecutionOptions: true,
      },
    );

    expect(response.result).toMatchObject({
      actionName: 'delivery.executeRetry',
      output: { ok: true },
    });
  });

  it('uses server-resolved idempotency keys for direct action execution', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      handler: (_input, context) => ({
        idempotencyKey: context.idempotencyKey ?? null,
      }),
    });

    const response = await executeHttpAction(
      runner,
      'delivery.dryRunRetry',
      {
        input: {},
        idempotencyKey: 'client-key',
      },
      {
        userId: 'user_1',
        idempotencyKey: 'server-key',
      },
    );

    expect(response.result).toMatchObject({
      output: {
        idempotencyKey: 'server-key',
      },
    });
  });

  it('ignores client-provided idempotency keys by default for direct action execution', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      handler: (_input, context) => ({
        idempotencyKey: context.idempotencyKey ?? null,
      }),
    });

    const response = await executeHttpAction(
      runner,
      'delivery.dryRunRetry',
      {
        input: {},
        idempotencyKey: 'client-key',
      },
      {
        userId: 'user_1',
      },
    );

    expect(response.result).toMatchObject({
      output: {
        idempotencyKey: null,
      },
    });
  });

  it('passes client idempotency keys only when client execution options are enabled', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      handler: (_input, context) => ({
        idempotencyKey: context.idempotencyKey ?? null,
      }),
    });

    const response = await executeHttpAction(
      runner,
      'delivery.dryRunRetry',
      {
        input: {},
        idempotencyKey: 'client-key',
      },
      {
        userId: 'user_1',
        allowClientExecutionOptions: true,
      },
    );

    expect(response.result).toMatchObject({
      output: {
        idempotencyKey: 'client-key',
      },
    });
  });

  it('strips workflow step execution options unless client options are enabled', async () => {
    const runner = createRunner({
      approval: ({ approvalToken }) => (
        approvalToken === 'client-token'
          ? { approved: true }
          : { approved: false }
      ),
    });

    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      handler: () => ({ ok: true }),
    });

    await expect(executeHttpWorkflow(
      runner,
      {
        workflow: {
          workflowName: 'unsafe-client-workflow',
          steps: [
            {
              id: 'retry',
              action: 'delivery.executeRetry',
              input: {},
              allowedModes: ['mutate'],
              approvalToken: 'client-token',
            },
          ],
        },
      },
      {
        userId: 'user_1',
      },
    )).rejects.toBeInstanceOf(WorkflowExecutionError);
  });

  it('strips client workflow step idempotency keys by default', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      handler: (_input, context) => ({
        idempotencyKey: context.idempotencyKey ?? null,
      }),
    });

    const response = await executeHttpWorkflow(
      runner,
      {
        workflow: {
          workflowName: 'client-workflow',
          steps: [
            {
              id: 'dryRun',
              action: 'delivery.dryRunRetry',
              input: {},
              idempotencyKey: 'client-step-key',
            },
          ],
        },
      },
      {
        userId: 'user_1',
      },
    );

    expect(response.result).toMatchObject({
      outputByStep: {
        dryRun: {
          idempotencyKey: null,
        },
      },
    });
  });

  it('applies server-derived workflow step idempotency keys', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      handler: (_input, context) => ({
        idempotencyKey: context.idempotencyKey ?? null,
      }),
    });

    const response = await executeHttpWorkflow(
      runner,
      {
        workflow: {
          workflowName: 'server-workflow',
          steps: [
            {
              id: 'dryRun',
              action: 'delivery.dryRunRetry',
              input: {},
              idempotencyKey: 'client-step-key',
            },
          ],
        },
      },
      {
        userId: 'user_1',
        getWorkflowStepIdempotencyKey: (step) => `server:${step.id}`,
      },
    );

    expect(response.result).toMatchObject({
      outputByStep: {
        dryRun: {
          idempotencyKey: 'server:dryRun',
        },
      },
    });
  });

  it('preserves client workflow step idempotency keys only when client options are enabled', async () => {
    const runner = createRunner();

    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      handler: (_input, context) => ({
        idempotencyKey: context.idempotencyKey ?? null,
      }),
    });

    const response = await executeHttpWorkflow(
      runner,
      {
        workflow: {
          workflowName: 'trusted-workflow',
          steps: [
            {
              id: 'dryRun',
              action: 'delivery.dryRunRetry',
              input: {},
              idempotencyKey: 'client-step-key',
            },
          ],
        },
      },
      {
        userId: 'user_1',
        allowClientExecutionOptions: true,
      },
    );

    expect(response.result).toMatchObject({
      outputByStep: {
        dryRun: {
          idempotencyKey: 'client-step-key',
        },
      },
    });
  });

  it('maps invalid workflow definitions to workflow validation failures', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'read.one',
      mode: 'read',
      handler: () => ({ ok: true }),
    });

    let mapped;
    try {
      await executeHttpWorkflow(
        runner,
        {
          workflow: {
            workflowName: 'invalid-workflow',
            steps: [
              {
                id: 'bad',
                action: 'missing.action',
                input: {},
                retry: {
                  maxAttempts: 0,
                },
              },
            ],
          },
        },
        {
          userId: 'user_1',
        },
      );
      throw new Error('Expected workflow validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowValidationError);
      mapped = mapAgentRunnerError(error);
    }

    expect(mapped).toMatchObject({
      statusCode: 400,
      response: {
        error: {
          code: 'WORKFLOW_VALIDATION_FAILED',
          issues: [
            expect.objectContaining({ code: 'unknownAction' }),
            expect.objectContaining({ code: 'invalidRetry' }),
          ],
        },
      },
    });
  });

  it('rejects workflows that exceed configured HTTP limits', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'read.one',
      mode: 'read',
      handler: () => ({ ok: true }),
    });

    const cases = [
      {
        workflow: {
          workflowName: 'too-many-steps',
          steps: [
            { id: 'one', action: 'read.one', input: {} },
            { id: 'two', action: 'read.one', input: {} },
          ],
        },
        workflowLimits: { maxSteps: 1 },
      },
      {
        workflow: {
          workflowName: 'too-much-timeout',
          steps: [
            { id: 'one', action: 'read.one', input: {}, timeoutMs: 10 },
          ],
        },
        workflowLimits: { maxStepTimeoutMs: 5 },
      },
      {
        workflow: {
          workflowName: 'too-many-attempts',
          steps: [
            { id: 'one', action: 'read.one', input: {}, retry: { maxAttempts: 4 } },
          ],
        },
        workflowLimits: { maxRetryAttempts: 3 },
      },
      {
        workflow: {
          workflowName: 'too-much-delay',
          steps: [
            { id: 'one', action: 'read.one', input: {}, retry: { maxAttempts: 2, delayMs: 10 } },
          ],
        },
        workflowLimits: { maxRetryDelayMs: 5 },
      },
    ];

    for (const testCase of cases) {
      try {
        await executeHttpWorkflow(
          runner,
          { workflow: testCase.workflow },
          {
            userId: 'user_1',
            workflowLimits: testCase.workflowLimits,
          },
        );
        throw new Error('Expected workflow limit to fail.');
      } catch (error) {
        expect(mapAgentRunnerError(error)).toMatchObject({
          statusCode: 400,
          response: {
            error: {
              code: 'WORKFLOW_LIMIT_EXCEEDED',
            },
          },
        });
      }
    }
  });

  it('allows trusted callers to disable HTTP workflow caps explicitly', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'read.one',
      mode: 'read',
      handler: () => ({ ok: true }),
    });

    const response = await executeHttpWorkflow(
      runner,
      {
        workflow: {
          workflowName: 'trusted-workflow',
          steps: [
            {
              id: 'one',
              action: 'read.one',
              input: {},
              timeoutMs: 60_000,
              retry: {
                maxAttempts: 10,
                delayMs: 10_000,
              },
            },
            {
              id: 'two',
              action: 'read.one',
              input: {},
            },
          ],
        },
      },
      {
        userId: 'user_1',
        workflowLimits: false,
      },
    );

    expect(response.result).toMatchObject({
      workflowName: 'trusted-workflow',
      steps: [
        expect.objectContaining({ id: 'one', status: 'succeeded' }),
        expect.objectContaining({ id: 'two', status: 'succeeded' }),
      ],
    });
  });

  it('keeps invalid workflow values mapped as validation failures instead of limit failures', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'read.one',
      mode: 'read',
      handler: () => ({ ok: true }),
    });

    try {
      await executeHttpWorkflow(
        runner,
        {
          workflow: {
            workflowName: 'invalid-values',
            steps: [
              {
                id: 'one',
                action: 'read.one',
                input: {},
                timeoutMs: 0,
                retry: {
                  maxAttempts: 0,
                },
                continueOnError: 'yes',
              },
            ],
          },
        },
        {
          userId: 'user_1',
        },
      );
      throw new Error('Expected workflow validation to fail.');
    } catch (error) {
      expect(mapAgentRunnerError(error)).toMatchObject({
        statusCode: 400,
        response: {
          error: {
            code: 'WORKFLOW_VALIDATION_FAILED',
            issues: [
              expect.objectContaining({ code: 'invalidTimeout' }),
              expect.objectContaining({ code: 'invalidRetry' }),
              expect.objectContaining({ code: 'invalidContinueOnError' }),
            ],
          },
        },
      });
    }
  });

  it('maps runner errors to HTTP responses', () => {
    expect(mapAgentRunnerError(new ActionNotFoundError('missing'))).toMatchObject({
      statusCode: 404,
      response: { error: { code: 'ACTION_NOT_FOUND' } },
    });

    expect(mapAgentRunnerError(new SchemaValidationError('bad', 'input', new Error('bad')))).toMatchObject({
      statusCode: 400,
      response: { error: { code: 'SCHEMA_VALIDATION_FAILED' } },
    });

    expect(mapAgentRunnerError(new ActionTimeoutError('slow', 100))).toMatchObject({
      statusCode: 408,
      response: { error: { code: 'ACTION_TIMEOUT' } },
    });

    expect(mapAgentRunnerError(new WorkflowExecutionError(
      'step_1',
      'missing',
      new ActionNotFoundError('missing'),
    ))).toMatchObject({
      statusCode: 404,
      response: { error: { code: 'ACTION_NOT_FOUND' } },
    });

    expect(mapAgentRunnerError(new WorkflowValidationError([]))).toMatchObject({
      statusCode: 400,
      response: { error: { code: 'WORKFLOW_VALIDATION_FAILED', issues: [] } },
    });

    expect(mapAgentRunnerError(new Error('unknown'))).toMatchObject({
      statusCode: 500,
      response: { error: { code: 'INTERNAL_ERROR' } },
    });
  });
});
