import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ActionNotFoundError,
  ModeNotAllowedError,
  SchemaValidationError,
  WorkflowExecutionError,
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

  it('maps runner errors to HTTP responses', () => {
    expect(mapAgentRunnerError(new ActionNotFoundError('missing'))).toMatchObject({
      statusCode: 404,
      response: { error: { code: 'ACTION_NOT_FOUND' } },
    });

    expect(mapAgentRunnerError(new SchemaValidationError('bad', 'input', new Error('bad')))).toMatchObject({
      statusCode: 400,
      response: { error: { code: 'SCHEMA_VALIDATION_FAILED' } },
    });

    expect(mapAgentRunnerError(new WorkflowExecutionError(
      'step_1',
      'missing',
      new ActionNotFoundError('missing'),
    ))).toMatchObject({
      statusCode: 404,
      response: { error: { code: 'ACTION_NOT_FOUND' } },
    });

    expect(mapAgentRunnerError(new Error('unknown'))).toMatchObject({
      statusCode: 500,
      response: { error: { code: 'INTERNAL_ERROR' } },
    });
  });
});
