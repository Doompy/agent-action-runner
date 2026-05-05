import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunner, fromStep } from '@agent-action-runner/core';
import { agentRunnerFastifyPlugin } from './index.js';

describe('@agent-action-runner/fastify', () => {
  it('serves action list and executes actions', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      description: 'Double a number.',
      inputSchema: z.object({ value: z.number() }),
      handler: (input, context) => ({
        value: input.value * 2,
        userId: context.userId,
      }),
    });

    const app = Fastify();
    await app.register(agentRunnerFastifyPlugin, {
      prefix: '/agent-runner',
      runner,
      getUserId: async (request) => request.headers['x-user-id']?.toString() ?? 'user_1',
    });

    const actions = await app.inject({
      method: 'GET',
      url: '/agent-runner/actions',
    });
    expect(actions.statusCode).toBe(200);
    expect(actions.json()).toEqual({
      ok: true,
      actions: [
        {
          name: 'math.double',
          mode: 'read',
          description: 'Double a number.',
          approvalRequired: false,
        },
      ],
    });

    const executed = await app.inject({
      method: 'POST',
      url: '/agent-runner/actions/math.double/execute',
      headers: { 'x-user-id': 'user_2' },
      payload: { input: { value: 21 } },
    });
    expect(executed.statusCode).toBe(200);
    expect(executed.json().result.output).toEqual({
      value: 42,
      userId: 'user_2',
    });

    await app.close();
  });

  it('executes workflows', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'delivery.searchJobs',
      mode: 'read',
      handler: () => ({ jobIds: ['job_1'] }),
    });
    runner.registerAction({
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      handler: (input: { jobIds: string[] }) => ({ retryable: input.jobIds }),
    });

    const app = Fastify();
    await app.register(agentRunnerFastifyPlugin, {
      prefix: '/agent-runner',
      runner,
      getUserId: async () => 'user_1',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/agent-runner/workflows/execute',
      payload: {
        workflow: {
          workflowName: 'retry',
          steps: [
            {
              id: 'jobs',
              action: 'delivery.searchJobs',
              input: {},
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
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.outputByStep.dryRun).toEqual({
      retryable: ['job_1'],
    });

    await app.close();
  });

  it('requires server-provided mutate mode and approval token', async () => {
    const runner = createRunner({
      approval: ({ approvalToken }) => (
        approvalToken === 'approved'
          ? { approved: true }
          : { approved: false }
      ),
    });
    runner.registerAction({
      name: 'delivery.executeRetry',
      mode: 'mutate',
      handler: () => ({ retried: 1 }),
    });

    const app = Fastify();
    await app.register(agentRunnerFastifyPlugin, {
      prefix: '/agent-runner',
      runner,
      getUserId: async () => 'user_1',
      getAllowedModes: async () => ['mutate'],
      getApprovalToken: async (request) => request.headers['x-approval-token']?.toString(),
    });

    const rejected = await app.inject({
      method: 'POST',
      url: '/agent-runner/actions/delivery.executeRetry/execute',
      payload: { input: {}, approvalToken: 'approved' },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('APPROVAL_REQUIRED');

    const approved = await app.inject({
      method: 'POST',
      url: '/agent-runner/actions/delivery.executeRetry/execute',
      headers: { 'x-approval-token': 'approved' },
      payload: { input: {} },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().result.output).toEqual({ retried: 1 });

    await app.close();
  });
});
