import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunner, fromStep } from '@agent-action-runner/core';
import { createExpressAdapter } from './index.js';

describe('@agent-action-runner/express', () => {
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

    const app = express();
    app.use('/agent-runner', createExpressAdapter(runner, {
      getUserId: (req) => req.header('x-user-id') ?? 'user_1',
    }));

    await request(app)
      .get('/agent-runner/actions')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
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
      });

    await request(app)
      .post('/agent-runner/actions/math.double/execute')
      .set('x-user-id', 'user_2')
      .send({ input: { value: 21 } })
      .expect(200)
      .expect(({ body }) => {
        expect(body.ok).toBe(true);
        expect(body.result.output).toEqual({
          value: 42,
          userId: 'user_2',
        });
      });
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

    const app = express();
    app.use('/agent-runner', createExpressAdapter(runner, {
      getUserId: () => 'user_1',
    }));

    await request(app)
      .post('/agent-runner/workflows/execute')
      .send({
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
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.result.outputByStep.dryRun).toEqual({
          retryable: ['job_1'],
        });
      });
  });

  it('allows the host app to provide the JSON parser', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      inputSchema: z.object({ value: z.number() }),
      handler: (input) => ({ value: input.value * 2 }),
    });

    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/agent-runner', createExpressAdapter(runner, {
      getUserId: () => 'user_1',
      jsonParser: false,
    }));

    await request(app)
      .post('/agent-runner/actions/math.double/execute')
      .send({ input: { value: 21 } })
      .expect(200)
      .expect(({ body }) => {
        expect(body.result.output).toEqual({ value: 42 });
      });
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

    const app = express();
    app.use('/agent-runner', createExpressAdapter(runner, {
      getUserId: () => 'user_1',
      getAllowedModes: () => ['mutate'],
      getApprovalToken: (req) => req.header('x-approval-token'),
    }));

    await request(app)
      .post('/agent-runner/actions/delivery.executeRetry/execute')
      .send({ input: {}, approvalToken: 'approved' })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('APPROVAL_REQUIRED');
      });

    await request(app)
      .post('/agent-runner/actions/delivery.executeRetry/execute')
      .set('x-approval-token', 'approved')
      .send({ input: {} })
      .expect(200)
      .expect(({ body }) => {
        expect(body.result.output).toEqual({ retried: 1 });
      });
  });
});
