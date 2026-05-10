import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPrismaAdminOpsExampleApp } from './app.js';

describe('nestjs prisma approval ops example', () => {
  it('runs read, dry-run, approval, mutate, idempotency replay, and durable audit flow', async () => {
    const { app, prisma } = await createPrismaAdminOpsExampleApp();

    try {
      const server = app.getHttpServer();

      const searchResponse = await request(server)
        .post('/agent-runner/actions/admin.searchUsers/execute')
        .set('x-user-id', 'operator_1')
        .send({
          input: {
            query: 'casey',
            status: 'active',
          },
        })
        .expect(200);

      expect(searchResponse.body.result.output.users).toHaveLength(1);
      expect(searchResponse.body.result.output.users[0].id).toBe('user_2');

      const dryRunResponse = await request(server)
        .post('/agent-runner/actions/admin.dryRunDisableUser/execute')
        .set('x-user-id', 'operator_1')
        .send({
          input: {
            userId: 'user_2',
            reason: 'Repeated policy violations.',
          },
        })
        .expect(200);

      const dryRun = dryRunResponse.body.result.output;
      expect(dryRun.resourceIds).toEqual(['user_2']);
      expect(typeof dryRun.dryRunHash).toBe('string');

      await request(server)
        .post('/agent-runner/actions/admin.disableUser/execute')
        .set('x-user-id', 'operator_1')
        .send({
          input: {
            userId: 'user_2',
            reason: 'Repeated policy violations.',
            dryRunHash: dryRun.dryRunHash,
          },
        })
        .expect(403)
        .expect(({ body }) => {
          expect(body.error.code).toBe('APPROVAL_REQUIRED');
        });

      const approvalResponse = await request(server)
        .post('/approvals/disable-user')
        .set('x-user-id', 'operator_1')
        .send({
          targetUserId: 'user_2',
          reason: 'Repeated policy violations.',
          dryRunHash: dryRun.dryRunHash,
        })
        .expect(200);

      const idempotencyKey = `disable-user:user_2:${dryRun.dryRunHash}`;

      const mutateResponse = await request(server)
        .post('/agent-runner/actions/admin.disableUser/execute')
        .set('x-user-id', 'operator_1')
        .set('x-approval-token', approvalResponse.body.approvalToken)
        .set('x-idempotency-key', idempotencyKey)
        .send({
          input: approvalResponse.body.mutateInput,
        })
        .expect(200);

      expect(mutateResponse.body.result.output).toEqual({
        userId: 'user_2',
        status: 'disabled',
        reason: 'Repeated policy violations.',
      });

      const replayResponse = await request(server)
        .post('/agent-runner/actions/admin.disableUser/execute')
        .set('x-user-id', 'operator_1')
        .set('x-approval-token', approvalResponse.body.approvalToken)
        .set('x-idempotency-key', idempotencyKey)
        .send({
          input: approvalResponse.body.mutateInput,
        })
        .expect(200);

      expect(replayResponse.body.result.output).toEqual(mutateResponse.body.result.output);

      const usersResponse = await request(server)
        .get('/users')
        .expect(200);
      expect(usersResponse.body.users.find((user: { id: string }) => user.id === 'user_2').status).toBe('disabled');

      const auditResponse = await request(server)
        .get('/audit')
        .expect(200);
      const statuses = auditResponse.body.audit.map((entry: { status: string }) => entry.status);
      expect(statuses).toContain('started');
      expect(statuses).toContain('succeeded');
      expect(statuses).toContain('failed');
      expect(JSON.stringify(auditResponse.body.audit)).not.toContain(approvalResponse.body.approvalToken);

      const approval = await prisma.agentApproval.findFirstOrThrow();
      expect(approval.consumedAt).toBeTruthy();
      const idempotency = await prisma.agentIdempotencyKey.findUniqueOrThrow({
        where: { key: idempotencyKey },
      });
      expect(idempotency.status).toBe('succeeded');
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });
});
