import { describe, expect, it } from 'vitest';
import { createFastifyAdminOpsExampleApp } from './app.js';

describe('fastify admin ops example', () => {
  it('runs read, dry-run, approval, mutate, and audit flow', async () => {
    const { app } = await createFastifyAdminOpsExampleApp();

    try {
      const searchResponse = await app.inject({
        method: 'POST',
        url: '/agent-runner/actions/admin.searchUsers/execute',
        headers: { 'x-user-id': 'operator_1' },
        payload: {
          input: {
            query: 'casey',
            status: 'active',
          },
        },
      });

      expect(searchResponse.statusCode).toBe(200);
      expect(searchResponse.json().result.output.users).toHaveLength(1);
      expect(searchResponse.json().result.output.users[0].id).toBe('user_2');

      const dryRunResponse = await app.inject({
        method: 'POST',
        url: '/agent-runner/actions/admin.dryRunDisableUser/execute',
        headers: { 'x-user-id': 'operator_1' },
        payload: {
          input: {
            userId: 'user_2',
            reason: 'Repeated policy violations.',
          },
        },
      });

      expect(dryRunResponse.statusCode).toBe(200);
      const dryRun = dryRunResponse.json().result.output;
      expect(dryRun.resourceIds).toEqual(['user_2']);
      expect(typeof dryRun.dryRunHash).toBe('string');
      expect(dryRun.affectedSessions).toBe(3);

      const missingTokenResponse = await app.inject({
        method: 'POST',
        url: '/agent-runner/actions/admin.disableUser/execute',
        headers: { 'x-user-id': 'operator_1' },
        payload: {
          input: {
            userId: 'user_2',
            reason: 'Repeated policy violations.',
            dryRunHash: dryRun.dryRunHash,
          },
        },
      });

      expect(missingTokenResponse.statusCode).toBe(403);
      expect(missingTokenResponse.json().error.code).toBe('APPROVAL_REQUIRED');

      const approvalResponse = await app.inject({
        method: 'POST',
        url: '/approvals/disable-user',
        headers: { 'x-user-id': 'operator_1' },
        payload: {
          targetUserId: 'user_2',
          reason: 'Repeated policy violations.',
          dryRunHash: dryRun.dryRunHash,
        },
      });

      expect(approvalResponse.statusCode).toBe(200);
      const approval = approvalResponse.json();

      const mismatchResponse = await app.inject({
        method: 'POST',
        url: '/agent-runner/actions/admin.disableUser/execute',
        headers: {
          'x-user-id': 'operator_1',
          'x-approval-token': approval.approvalToken,
        },
        payload: {
          input: {
            userId: 'user_2',
            reason: 'Different reason breaks inputHash binding.',
            dryRunHash: dryRun.dryRunHash,
          },
        },
      });

      expect(mismatchResponse.statusCode).toBe(403);
      expect(mismatchResponse.json().error.code).toBe('APPROVAL_REQUIRED');

      const mutateResponse = await app.inject({
        method: 'POST',
        url: '/agent-runner/actions/admin.disableUser/execute',
        headers: {
          'x-user-id': 'operator_1',
          'x-approval-token': approval.approvalToken,
        },
        payload: {
          input: approval.mutateInput,
        },
      });

      expect(mutateResponse.statusCode).toBe(200);
      expect(mutateResponse.json().result.output).toEqual({
        userId: 'user_2',
        status: 'disabled',
        reason: 'Repeated policy violations.',
      });
      expect(mutateResponse.json().result.approvalId).toBe(approval.approvalId);

      const usersResponse = await app.inject({
        method: 'GET',
        url: '/users',
      });
      expect(usersResponse.statusCode).toBe(200);
      expect(usersResponse.json().users.find((user: { id: string }) => user.id === 'user_2').status).toBe('disabled');

      const auditResponse = await app.inject({
        method: 'GET',
        url: '/audit',
      });
      expect(auditResponse.statusCode).toBe(200);
      const statuses = auditResponse.json().audit.map((entry: { status: string }) => entry.status);
      expect(statuses).toContain('started');
      expect(statuses).toContain('succeeded');
      expect(statuses).toContain('failed');
    } finally {
      await app.close();
    }
  });
});
