import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStableHash, type ApprovalContext } from '@agent-action-runner/core';
import { describe, expect, it } from 'vitest';
import { FileApprovalStore } from './approval-store.js';

describe('FileApprovalStore', () => {
  it('persists approval records without storing the raw token', async () => {
    const filePath = await createTempFilePath('approvals.json');
    const store = new FileApprovalStore(filePath);
    const now = new Date('2026-05-07T00:00:00.000Z');
    const approval = await store.createDisableUserApproval({
      operatorUserId: 'operator_1',
      targetUserId: 'user_2',
      reason: 'Repeated policy violations.',
      dryRunHash: 'dry_run_hash',
      now,
    });

    const persisted = await readFile(filePath, 'utf8');
    expect(persisted).toContain(approval.approvalId);
    expect(persisted).not.toContain(approval.approvalToken);

    const reloaded = new FileApprovalStore(filePath);
    await expect(reloaded.readAll()).resolves.toHaveLength(1);
    await expect(reloaded.verifyApprovalToken({
      token: approval.approvalToken,
      approvalContext: createApprovalContext(approval.mutateInput),
      now: new Date('2026-05-07T00:01:00.000Z'),
    })).resolves.toEqual({
      approved: true,
      approvalId: approval.approvalId,
    });
  });

  it('rejects expired and mismatched approval tokens', async () => {
    const filePath = await createTempFilePath('approvals.json');
    const store = new FileApprovalStore(filePath);
    const approval = await store.createDisableUserApproval({
      operatorUserId: 'operator_1',
      targetUserId: 'user_2',
      reason: 'Repeated policy violations.',
      dryRunHash: 'dry_run_hash',
      now: new Date('2026-05-07T00:00:00.000Z'),
    });

    await expect(store.verifyApprovalToken({
      token: approval.approvalToken,
      approvalContext: createApprovalContext(approval.mutateInput),
      now: new Date('2026-05-07T00:06:00.000Z'),
    })).resolves.toMatchObject({ approved: false });

    await expect(store.verifyApprovalToken({
      token: approval.approvalToken,
      approvalContext: {
        ...createApprovalContext(approval.mutateInput),
        userId: 'operator_2',
      },
      now: new Date('2026-05-07T00:01:00.000Z'),
    })).resolves.toMatchObject({ approved: false });

    await expect(store.verifyApprovalToken({
      token: approval.approvalToken,
      approvalContext: createApprovalContext({
        ...approval.mutateInput,
        reason: 'Different reason breaks inputHash binding.',
      }),
      now: new Date('2026-05-07T00:01:00.000Z'),
    })).resolves.toMatchObject({ approved: false });

    await expect(store.verifyApprovalToken({
      token: approval.approvalToken,
      approvalContext: {
        ...createApprovalContext(approval.mutateInput),
        resourceIds: ['user_3'],
      },
      now: new Date('2026-05-07T00:01:00.000Z'),
    })).resolves.toMatchObject({ approved: false });

    await expect(store.verifyApprovalToken({
      token: approval.approvalToken,
      approvalContext: {
        ...createApprovalContext(approval.mutateInput),
        dryRunHash: 'different_dry_run_hash',
      },
      now: new Date('2026-05-07T00:01:00.000Z'),
    })).resolves.toMatchObject({ approved: false });
  });
});

function createApprovalContext(input: {
  readonly userId: string;
  readonly reason: string;
  readonly dryRunHash: string;
}): ApprovalContext {
  return {
    userId: 'operator_1',
    actionName: 'admin.disableUser',
    mode: 'mutate',
    inputHash: createStableHash(input),
    resourceIds: [input.userId],
    dryRunHash: input.dryRunHash,
  };
}

async function createTempFilePath(fileName: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aar-approval-'));
  return join(directory, fileName);
}
