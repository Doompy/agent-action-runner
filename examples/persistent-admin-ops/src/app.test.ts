import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FileAuditStore } from './audit-store.js';
import { createPersistentAdminOpsExampleApp } from './app.js';

describe('persistent admin ops example', () => {
  it('runs read, dry-run, approval, mutate, and persisted audit flow', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'aar-persistent-admin-ops-'));
    const { app } = createPersistentAdminOpsExampleApp({ dataDir });

    const searchResponse = await request(app)
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

    const dryRunResponse = await request(app)
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

    await request(app)
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

    const approvalResponse = await request(app)
      .post('/approvals/disable-user')
      .set('x-user-id', 'operator_1')
      .send({
        targetUserId: 'user_2',
        reason: 'Repeated policy violations.',
        dryRunHash: dryRun.dryRunHash,
      })
      .expect(200);

    await request(app)
      .post('/agent-runner/actions/admin.disableUser/execute')
      .set('x-user-id', 'operator_1')
      .set('x-approval-token', approvalResponse.body.approvalToken)
      .send({
        input: {
          userId: 'user_2',
          reason: 'Different reason breaks inputHash binding.',
          dryRunHash: dryRun.dryRunHash,
        },
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('APPROVAL_REQUIRED');
      });

    const mutateResponse = await request(app)
      .post('/agent-runner/actions/admin.disableUser/execute')
      .set('x-user-id', 'operator_1')
      .set('x-approval-token', approvalResponse.body.approvalToken)
      .send({
        input: approvalResponse.body.mutateInput,
      })
      .expect(200);

    expect(mutateResponse.body.result.output).toEqual({
      userId: 'user_2',
      status: 'disabled',
      reason: 'Repeated policy violations.',
    });
    expect(mutateResponse.body.result.approvalId).toBe(approvalResponse.body.approvalId);

    const auditResponse = await request(app)
      .get('/audit')
      .expect(200);
    const statuses = auditResponse.body.audit.map((entry: { status: string }) => entry.status);
    expect(statuses).toContain('started');
    expect(statuses).toContain('succeeded');
    expect(statuses).toContain('failed');

    const reloadedAuditStore = new FileAuditStore(join(dataDir, 'audit.jsonl'));
    const persistedAudit = await reloadedAuditStore.readAll();
    expect(persistedAudit.map((entry) => entry.status)).toEqual(statuses);
  });
});
